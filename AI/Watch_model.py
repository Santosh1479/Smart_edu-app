from flask import Flask, request, jsonify
from flask_cors import CORS
import torch
import torch.nn as nn
from torchvision import models, transforms
from PIL import Image
import io

app = Flask(__name__)
CORS(app)

# Labels
EMOTION_LABELS = ['Attentive', 'Bored', 'Confused']
GAZE_LABELS = ['Attentive', 'Looking Away']

DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

# Load EfficientNet
efficientnet = models.efficientnet_b0(weights="IMAGENET1K_V1")
efficientnet.classifier[1] = nn.Linear(efficientnet.classifier[1].in_features, 3)
efficientnet = efficientnet.to(DEVICE)
efficientnet_checkpoint_path = r'C:\Users\Santosh\OneDrive\Desktop\CBC_F-05\AI\best_attention_model_efficientnet.pth'
if torch.cuda.is_available():
    efficientnet_checkpoint = torch.load(efficientnet_checkpoint_path)
else:
    efficientnet_checkpoint = torch.load(efficientnet_checkpoint_path, map_location=DEVICE)
efficientnet.load_state_dict(efficientnet_checkpoint['model_state_dict'])
efficientnet.eval()

# Load MobileNet
mobilenet = models.mobilenet_v2(weights=models.MobileNet_V2_Weights.IMAGENET1K_V1)
mobilenet.classifier = nn.Sequential(
    nn.Dropout(0.4),
    nn.Linear(mobilenet.last_channel, 3)
)
mobilenet = mobilenet.to(DEVICE)
mobilenet_checkpoint_path = r'C:\Users\Santosh\OneDrive\Desktop\CBC_F-05\AI\best_attention_modelmobilenet.pth'
if torch.cuda.is_available():
    mobilenet_checkpoint = torch.load(mobilenet_checkpoint_path)
else:
    mobilenet_checkpoint = torch.load(mobilenet_checkpoint_path, map_location=DEVICE)
mobilenet.load_state_dict(mobilenet_checkpoint['model_state_dict'])
mobilenet.eval()

# Load Gaze Model (MobileNetV2)
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

def classify_attention(pitch, yaw, roll):
    if abs(pitch) < 20 and abs(yaw) < 29 and abs(roll) < 25:
        return GAZE_LABELS[0]
    else:
        return GAZE_LABELS[1]

@app.route('/predict-state', methods=['POST'])
def predict_state():
    if 'image' not in request.files:
        return jsonify({'error': 'No image uploaded'}), 400

    file = request.files['image']
    img_bytes = file.read()
    img = Image.open(io.BytesIO(img_bytes)).convert('RGB')

    # Emotion prediction (ensemble)
    gray_img = img.convert('L')
    img_tensor_emotion = emotion_transform(gray_img).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        efficientnet_output = efficientnet(img_tensor_emotion)
        mobilenet_output = mobilenet(img_tensor_emotion)
        avg_output = (0.005 * efficientnet_output + 0.995 * mobilenet_output)
        emotion_predicted_idx = torch.argmax(avg_output, dim=1).item()
        emotion_predicted_label = EMOTION_LABELS[emotion_predicted_idx]

    # Gaze/headpose prediction
    img_tensor_gaze = gaze_transform(img).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        gaze_output = gaze_model(img_tensor_gaze)
        pitch, yaw, roll = gaze_output[0].tolist()
    gaze_attention = classify_attention(pitch, yaw, roll)

    # Final logic
    if gaze_attention == 'Looking Away':
        final_output = 'Looking Away'
    elif emotion_predicted_label == 'Attentive':
        final_output = 'Attentive'
    else:
        final_output = emotion_predicted_label

    return jsonify({
        'emotion': emotion_predicted_label,
        'attention': gaze_attention,
        'pitch': pitch,
        'yaw': yaw,
        'roll': roll,
        'state': final_output
    })

if __name__ == '__main__':
    app.run(debug=True)
