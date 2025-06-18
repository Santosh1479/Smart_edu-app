import cv2
import mediapipe as mp
import torch
import torch.nn as nn
from torchvision import models, transforms
from PIL import Image
import numpy as np
from collections import deque

EMOTION_LABELS = ['Attentive', 'Bored', 'Confused']
GAZE_LABELS = ['Attentive', 'Looking Away']
DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

# EfficientNet
efficientnet = models.efficientnet_b0(weights="IMAGENET1K_V1")
efficientnet.classifier[1] = nn.Linear(efficientnet.classifier[1].in_features, 3)
efficientnet = efficientnet.to(DEVICE)
efficientnet_checkpoint_path = r'C:\Users\Santosh\OneDrive\Desktop\CBC_F-05\AI\best_attention_model_efficientnet.pth'
efficientnet.load_state_dict(torch.load(efficientnet_checkpoint_path, map_location=DEVICE)['model_state_dict'])
efficientnet.eval()

# MobileNet
mobilenet = models.mobilenet_v2(weights=models.MobileNet_V2_Weights.IMAGENET1K_V1)
mobilenet.classifier = nn.Sequential(
    nn.Dropout(0.4),
    nn.Linear(mobilenet.last_channel, 3)
)
mobilenet = mobilenet.to(DEVICE)
mobilenet_checkpoint_path = r'C:\Users\Santosh\OneDrive\Desktop\CBC_F-05\AI\best_attention_modelmobilenet.pth'
mobilenet.load_state_dict(torch.load(mobilenet_checkpoint_path, map_location=DEVICE)['model_state_dict'])
mobilenet.eval()

# Gaze/Headpose Model (MobileNetV2)
gaze_model = models.mobilenet_v2(pretrained=True)
gaze_model.classifier[1] = nn.Linear(gaze_model.last_channel, 3)
gaze_model = gaze_model.to(DEVICE)
gaze_model_checkpoint_path = r'C:\Users\Santosh\OneDrive\Desktop\CBC_F-05\AI\head_pose_best_model.pt'
gaze_model.load_state_dict(torch.load(gaze_model_checkpoint_path, map_location=DEVICE))
gaze_model.eval()

# Transforms
emotion_transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.Grayscale(num_output_channels=3),
    transforms.ToTensor(),
    transforms.Normalize([0.5], [0.5])
])
gaze_transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
])

mp_face_mesh = mp.solutions.face_mesh
face_mesh = mp_face_mesh.FaceMesh(static_image_mode=False, max_num_faces=1, refine_landmarks=True)

cap = cv2.VideoCapture(0)
emotion_history = deque(maxlen=5)

# Eye landmark indices for left and right eye (mediapipe)
LEFT_EYE = [33, 160, 158, 133, 153, 144, 163, 7, 246]
RIGHT_EYE = [362, 385, 387, 263, 373, 380, 390, 249, 466]

def draw_landmarks(image, face_landmarks):
    # Eyes and mouth indices (Mediapipe FaceMesh)
    eye_indices = list(range(33, 134)) + list(range(362, 384))
    mouth_indices = list(range(61, 88)) + list(range(291, 318))
    h, w, _ = image.shape
    for idx in eye_indices + mouth_indices:
        if idx < len(face_landmarks.landmark):
            pt = face_landmarks.landmark[idx]
            x, y = int(pt.x * w), int(pt.y * h)
            cv2.circle(image, (x, y), 2, (0, 255, 0), -1)

def eye_aspect_ratio(landmarks, eye_indices, w, h):
    # Use 6 points for EAR calculation (vertical/horizontal)
    # [p1, p2, p3, p4, p5, p6] = [left, top1, top2, right, bottom1, bottom2]
    p = [landmarks[idx] for idx in eye_indices]
    # For mediapipe, use: left(0), top1(1), top2(2), right(3), bottom1(4), bottom2(5)
    # We'll use: vertical = mean of (top1-bottom1, top2-bottom2), horizontal = left-right
    left = np.array([p[0].x * w, p[0].y * h])
    right = np.array([p[3].x * w, p[3].y * h])
    top1 = np.array([p[1].x * w, p[1].y * h])
    top2 = np.array([p[2].x * w, p[2].y * h])
    bottom1 = np.array([p[4].x * w, p[4].y * h])
    bottom2 = np.array([p[5].x * w, p[5].y * h])
    # EAR formula
    vertical = (np.linalg.norm(top1 - bottom1) + np.linalg.norm(top2 - bottom2)) / 2.0
    horizontal = np.linalg.norm(left - right)
    ear = vertical / (horizontal + 1e-6)
    return ear

def classify_attention(pitch, yaw, roll):
    if abs(pitch) < 20 and abs(yaw) < 29 and abs(roll) < 25:
        return GAZE_LABELS[0]
    else:
        return GAZE_LABELS[1]

def predict_emotion_and_gaze(face_img):
    # Emotion prediction (ensemble)
    img_pil = Image.fromarray(cv2.cvtColor(face_img, cv2.COLOR_BGR2RGB))
    img_tensor_emotion = emotion_transform(img_pil).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        efficientnet_output = efficientnet(img_tensor_emotion)
        mobilenet_output = mobilenet(img_tensor_emotion)
        avg_output = (0.005 * efficientnet_output + 0.995 * mobilenet_output)
        emotion_predicted_idx = torch.argmax(avg_output, dim=1).item()
        emotion_predicted_label = EMOTION_LABELS[emotion_predicted_idx]

    # Gaze/headpose prediction
    img_tensor_gaze = gaze_transform(img_pil).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        gaze_output = gaze_model(img_tensor_gaze)
        pitch, yaw, roll = gaze_output[0].tolist()
    gaze_attention = classify_attention(pitch, yaw, roll)

    return emotion_predicted_label, gaze_attention, pitch, yaw, roll

while True:
    ret, frame = cap.read()
    if not ret:
        break

    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    results = face_mesh.process(rgb)

    emotion = "No face"
    eye_state = "Open"
    if results.multi_face_landmarks:
        for face_landmarks in results.multi_face_landmarks:
            draw_landmarks(frame, face_landmarks)

            # Get bounding box for face crop (for model)
            h, w, _ = frame.shape
            xs = [lm.x for lm in face_landmarks.landmark]
            ys = [lm.y for lm in face_landmarks.landmark]
            margin = 20
            min_x = max(min(xs) * w - margin, 0)
            max_x = min(max(xs) * w + margin, w)
            min_y = max(min(ys) * h - margin, 0)
            max_y = min(max(ys) * h + margin, h)
            face_crop = frame[int(min_y):int(max_y), int(min_x):int(max_x)]
            if face_crop.size > 0:
                # Eye state detection
                left_ear = eye_aspect_ratio(face_landmarks.landmark, [33, 160, 158, 133, 153, 144], w, h)
                right_ear = eye_aspect_ratio(face_landmarks.landmark, [362, 385, 387, 263, 373, 380], w, h)
                avg_ear = (left_ear + right_ear) / 2.0
                # Threshold for closed eyes (bored): typical EAR < 0.21
                if avg_ear < 0.21:
                    eye_state = "Closed"
                else:
                    eye_state = "Open"

                emotion_predicted_label, gaze_attention, pitch, yaw, roll = predict_emotion_and_gaze(face_crop)

                # If eyes closed, override to "Bored"
                if eye_state == "Closed":
                    final_output = "Bored"
                elif gaze_attention == 'Looking Away':
                    final_output = 'Looking Away'
                elif emotion_predicted_label == 'Attentive':
                    final_output = 'Attentive'
                else:
                    final_output = emotion_predicted_label

                emotion_history.append(final_output)
                most_common = max(set(emotion_history), key=emotion_history.count)
                # Show eye state beside G:
                emotion = f"{most_common} (E:{emotion_predicted_label}, G:{gaze_attention}, Eye:{eye_state})"
            else:
                emotion = "Face crop error"

    # Draw detected emotion
    cv2.putText(frame, f"Detected Emotion: {emotion}", (30, 40), cv2.FONT_HERSHEY_SIMPLEX, 1, (0,0,255), 2)

    cv2.imshow("Webcam - Emotion & Landmarks", frame)
    if cv2.waitKey(1) & 0xFF == 27:  # ESC to quit
        break

cap.release()
cv2.destroyAllWindows()