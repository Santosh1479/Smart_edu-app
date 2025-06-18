import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useSocket } from "../context/SocketContext";
import { FaDownload } from "react-icons/fa";

const EMOTION_MAP = {
  Angry: "confused",
  Disgust: "confused",
  Fear: "confused",
  Sad: "bored",
  Surprise: "bored",
  Happy: "attentive",
  Neutral: "attentive",
  // Add "looking away" if you have a way to detect it
};

export default function StreamPage() {
  const location = useLocation();
  const { classroomId } = useParams();
  const { streamTitle } = location.state || {};
  const localStreamRef = useRef(null);
  const videoRef = useRef(null);
  const pcRef = useRef(null);
  const negotiatingRef = useRef(false);
  const [isTeacher, setIsTeacher] = useState(false);
  const [userId, setUserId] = useState(null);
  const [userName, setUserName] = useState(""); // For sending to teacher
  const [messages, setMessages] = useState([]);
  const [studentEmotion, setStudentEmotion] = useState(null);
  const [emotionHistory, setEmotionHistory] = useState([]);
  const [confirmedEmotion, setConfirmedEmotion] = useState(null);
  const [selectedClassroom, setSelectedClassroom] = useState(null);
  const [attendanceClass, setAttendanceClass] = useState(null);
  const [attendanceDate, setAttendanceDate] = useState(null);
  const [showAttendancePopup, setShowAttendancePopup] = useState(false);
  const [showStreamModal, setShowStreamModal] = useState(false);
  const socket = useSocket();
  const navigate = useNavigate();

  const handleStopStream = () => {
    socket.emit("stopStream", selectedClassroom?._id || classroomId);
    setAttendanceClass(selectedClassroom || { _id: classroomId, name: streamTitle || "Class" });
    setAttendanceDate(new Date().toISOString().slice(0, 10));
    setShowAttendancePopup(true);
    setShowStreamModal(false);
    setSelectedClassroom(null);
    // Do NOT navigate here!
  };

  const handleExitClassroom = () => {
    navigate("/user-home");
  };

  // Set role, userId, and userName from localStorage
  useEffect(() => {
    setIsTeacher(localStorage.getItem("role") === "teacher");
    setUserId(localStorage.getItem("userId"));
    setUserName(localStorage.getItem("name") || "Unknown");
  }, []);

  useEffect(() => {
    if (!userId) return;

    // --- TEACHER LOGIC ---
    if (isTeacher) {
      const peerConnections = {}; // key: watcherId
      let localStream;

      // Get teacher's media stream
      navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((stream) => {
        localStreamRef.current.srcObject = stream;
        localStream = stream;

        // When a student joins, create a new peer connection for them
        const watcherHandler = ({ watcherId }) => {
          const pc = new RTCPeerConnection({
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
          });
          peerConnections[watcherId] = pc;

          // Add tracks to this connection
          localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

          // ICE candidates to student
          pc.onicecandidate = event => {
            if (event.candidate) {
              socket.emit("ice-candidate", {
                candidate: event.candidate,
                classroomId,
                to: watcherId,
                userId
              });
            }
          };

          // Create and send offer
          pc.createOffer()
            .then(offer => pc.setLocalDescription(offer))
            .then(() => {
              socket.emit("offer", {
                offer: pc.localDescription,
                classroomId,
                to: watcherId
              });
            });
        };

        // Receive answer from student
        const answerHandler = ({ answer, from }) => {
          const pc = peerConnections[from];
          if (pc) {
            pc.setRemoteDescription(new RTCSessionDescription(answer));
          }
        };

        // ICE from student
        const iceHandler = ({ candidate, from }) => {
          const pc = peerConnections[from];
          if (pc && candidate) {
            pc.addIceCandidate(new RTCIceCandidate(candidate));
          }
        };

        socket.on("watcher", watcherHandler);
        socket.on("answer", answerHandler);
        socket.on("ice-candidate", iceHandler);

        socket.emit("broadcaster", { classroomId, userId });

        // Cleanup
        return () => {
          Object.values(peerConnections).forEach(pc => pc.close());
          socket.off("watcher", watcherHandler);
          socket.off("answer", answerHandler);
          socket.off("ice-candidate", iceHandler);
        };
      });
    }
    // --- STUDENT LOGIC ---
    else {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
      });
      pcRef.current = pc;

      // ICE candidates to teacher
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("ice-candidate", {
            candidate: event.candidate,
            classroomId,
            userId
          });
        }
      };

      // When receiving offer from teacher
      const offerHandler = ({ offer, from }) => {
        pc.setRemoteDescription(new RTCSessionDescription(offer))
          .then(() => pc.createAnswer())
          .then(answer => pc.setLocalDescription(answer))
          .then(() => {
            socket.emit("answer", {
              answer: pc.localDescription,
              classroomId,
              to: from
            });
          });
      };

      // When receiving ICE candidate from teacher
      const iceHandler = ({ candidate }) => {
        if (candidate) {
          pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
      };

      // When stream is received
      pc.ontrack = (event) => {
        if (videoRef.current) {
          videoRef.current.srcObject = event.streams[0];
        }
      };

      socket.on("offer", offerHandler);
      socket.on("ice-candidate", iceHandler);

      // Announce as watcher
      socket.emit("watcher", { classroomId, watcherId: userId });

      // Cleanup
      return () => {
        pc.close();
        socket.off("offer", offerHandler);
        socket.off("ice-candidate", iceHandler);
      };
    }
  }, [isTeacher, classroomId, socket, userId]);

  // Student: Capture and send frame every 2 seconds, classify, and send to teacher if needed
  useEffect(() => {
    if (isTeacher) return;

    let intervalId;
    const captureAndSend = async () => {
      if (!videoRef.current || videoRef.current.readyState < 2) return;
      const canvas = document.createElement("canvas");
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        const formData = new FormData();
        formData.append("image", blob, "frame.jpg");
        try {
          const res = await fetch(`${import.meta.env.VITE_ML_URI}/predict-state`, {
            method: "POST",
            body: formData,
          });
          const data = await res.json();
          if (data.state) {
            setStudentEmotion(data.state);
          } else if (data.error) {
            setStudentEmotion("Error: " + data.error);
          } else {
            setStudentEmotion("Unknown error");
          }
        } catch (e) {
          setStudentEmotion("Network error");
        }
      }, "image/jpeg");
    };

    intervalId = setInterval(captureAndSend, 2000);

    return () => clearInterval(intervalId);
    // eslint-disable-next-line
  }, [isTeacher, confirmedEmotion, userName, classroomId, socket, userId]);

  // Teacher: Listen for student emotion events
  useEffect(() => {
    if (!isTeacher) return;
    const handler = ({ name, emotion }) => {
      setMessages((prev) => [
        ...prev,
        `${name} is ${emotion}`,
      ]);
    };
    socket.on("student-emotion", handler);
    return () => socket.off("student-emotion", handler);
  }, [isTeacher, socket]);

  return (
    <div style={{ paddingTop: "64px", display: "flex", flexDirection: "column", alignItems: "center" }}>
      {/* Video Section */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        {isTeacher ? (
          <video
            ref={localStreamRef}
            autoPlay
            muted
            controls
            style={{ width: "80vw", maxWidth: "800px", borderRadius: "12px", background: "#000" }}
          />
        ) : (
          <video
            ref={videoRef}
            autoPlay
            controls
            style={{ width: "80vw", maxWidth: "800px", borderRadius: "12px", background: "#000" }}
          />
        )}
      </div>

      {/* Monitor Section */}
      <div style={{ marginTop: "32px", width: "80vw", maxWidth: "800px" }}>
        <h2>Emotion Monitoring</h2>
        {isTeacher ? (
          <div style={{ background: "#222", color: "#fff", borderRadius: "8px", padding: "12px", minHeight: "60px" }}>
            {messages.length === 0
              ? <span>No emotion data yet.</span>
              : messages.map((msg, idx) => <div key={idx}>{msg}</div>)
            }
          </div>
        ) : (
          <div style={{ background: "#222", color: "#fff", borderRadius: "8px", padding: "12px", minHeight: "60px" }}>
            {studentEmotion ? `Detected Emotion: ${studentEmotion}` : "Detecting..."}
          </div>
        )}
      </div>

      {/* Stream control buttons */}
      <div style={{ margin: "24px 0" }}>
        {isTeacher ? (
          <button
            onClick={handleStopStream}
            className="bg-red-600 text-white px-6 py-2 rounded-lg hover:bg-red-700 transition font-bold"
          >
            Stop Stream ;
          </button>
        ) : (
          <button
            onClick={handleExitClassroom}
            className="bg-gray-700 text-white px-6 py-2 rounded-lg hover:bg-gray-900 transition font-bold"
          >
            Exit Classroom
          </button>
        )}
      </div>

      {/* Attendance Download Popup */}
      {showAttendancePopup && attendanceClass && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
          <div className="bg-white/90 text-black rounded-2xl shadow-2xl p-8 flex flex-col items-center">
            <h2 className="text-xl font-bold mb-2">Attendance Download</h2>
            <p className="mb-4">
              <span className="font-semibold">Class:</span> {attendanceClass.name}<br />
              <span className="font-semibold">Date:</span> {attendanceDate}
            </p>
            <a
              href={`http://localhost:3000/classrooms/${attendanceClass._id}/attendance`}
              className="flex items-center gap-2 bg-violet-600 text-white px-4 py-2 rounded-lg hover:bg-violet-700 transition mb-4"
            >
              <FaDownload /> Download CSV
            </a>
            <button
              onClick={() => {
                setShowAttendancePopup(false);
                navigate("/teacher-home");
              }}
              className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
