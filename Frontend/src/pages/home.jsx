import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

const Home = () => {
  const navigate = useNavigate();
  const [classLink, setClassLink] = useState("");
  const [classrooms, setClassrooms] = useState([]);
  const [subjects, setSubjects] = useState([]); // State to store subjects
  const [topics, setTopics] = useState([]); // State to store topics
  const [showSubjects, setShowSubjects] = useState(false); // Toggle subjects display
  const [showTopics, setShowTopics] = useState(false); // Toggle topics display
  const [quizScore, setQuizScore] = useState(null); // State to store quiz score

  // Handle logout
  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("userId");
    localStorage.removeItem("name");
    localStorage.removeItem("role");
    localStorage.removeItem("branch");
    localStorage.removeItem("semester");
    localStorage.removeItem("user");
    alert("Logged out successfully!");
    navigate("/login");
  };

  // Fetch subjects based on user's semester and branch
  const handleStudy = async () => {
    const token = localStorage.getItem("token");
    const semester = localStorage.getItem("semester"); // Assuming semester is stored in localStorage
    const branch = localStorage.getItem("branch"); // Assuming branch is stored in localStorage

    if (!token || !semester || !branch) {
      alert("User information is missing. Please log in again.");
      navigate("/login");
      return;
    }

    try {
      const res = await axios.get(
        `${import.meta.env.VITE_BASE_URL}/study/subjects/${semester}/${branch}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      setSubjects(res.data);
      setShowSubjects(true);
      setShowTopics(false);
    } catch (err) {
      console.error("Error fetching subjects:", err);
      alert("Failed to fetch subjects.");
    }
  };

  const handleJoinClass = async () => {
    const token = localStorage.getItem("token");
    const userId = localStorage.getItem("userId");
    if (!token || !userId) {
      alert("User information is missing. Please log in again.");
      navigate("/login");
      return;
    }

    try {
      const res = await axios.post(
        `${import.meta.env.VITE_BASE_URL}/classrooms/join`,
        { link: classLink, userId },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.status === 200) {
        alert("Joined classroom successfully!");
        setClassLink("");
      } else {
        alert("Failed to join classroom. Please check the link.");
      }
    } catch (err) {
      console.error("Error joining classroom:", err);
      alert("Failed to join classroom. Please check the link.");
    }
  };

  // Fetch topics for a selected subject
  const handleSubjectClick = (syllabus) => {
    setTopics(syllabus);
    setShowSubjects(false); // Hide the subjects section
    setShowTopics(true); // Show the topics section
  };

  // Conduct quiz for a selected topic
  const handleTopicClick = async (topic) => {
    const choice = prompt(
      "Enter 'quiz' to generate a quiz or 'content' to view content:"
    );

    if (
      !choice ||
      (choice.toLowerCase() !== "quiz" && choice.toLowerCase() !== "content")
    ) {
      alert("Invalid choice. Please enter 'quiz' or 'content'.");
      return;
    }

    try {
      const res = await axios.post(
        `http://127.0.0.1:5000/generate/${topic}`,
        { choice },
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
      if (choice.toLowerCase() === "quiz") {
        const quiz = res.data.quiz;
        let score = 0;
        for (const question of quiz) {
          const userAnswer = prompt(
            `${question.question}\n${question.options?.join("\n") || ""}`
          );
          if (userAnswer && userAnswer.trim() === question.correct) {
            score++;
          }
        }
        alert(`Quiz completed! Your score: ${score}/${quiz.length}`);
      } else if (choice.toLowerCase() === "content") {
        const content = res.data.content;
        alert(`Content for topic "${topic}":\n\n${content}`);
      }
    } catch (err) {
      console.error("Error handling topic click:", err);
      alert("Failed to fetch data. Please try again later.");
    }
  };

  // Fetch classrooms where the student is enrolled
  useEffect(() => {
    const fetchClassrooms = async () => {
      try {
        const token = localStorage.getItem("token");
        const userId = localStorage.getItem("userId");
        const res = await axios.get(
          `${import.meta.env.VITE_BASE_URL}/classrooms/student/${userId}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        setClassrooms(res.data);
      } catch (err) {
        console.error("Error fetching classrooms:", err);
        alert("Failed to fetch classrooms.");
      }
    };

    fetchClassrooms();
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-[#1d0036] to-[#6A29FF] text-white px-4">
      {/* Header Section */}
      <div className="p-4 mt-20 backdrop-blur-lg shadow-md rounded-lg w-full max-w-4xl text-center">
        <h1 className="text-4xl font-bold drop-shadow-lg">
          Welcome to Your Dashboard
        </h1>
      </div>

      {/* Top Section: Join Class */}
      <div className="p-4 mt-6 bg-white/10 backdrop-blur-lg border border-white/20 shadow-md rounded-lg w-full max-w-4xl text-center">
        <div className="flex flex-col items-center gap-4">
          <input
            type="text"
            placeholder="Enter Class Link"
            value={classLink}
            onChange={(e) => setClassLink(e.target.value)}
            className="px-4 py-2 w-full max-w-md bg-white/20 border border-white/30 rounded-lg placeholder-gray-200 text-white focus:outline-none focus:ring-2 focus:ring-violet-400"
          />
          <button
            onClick={handleJoinClass}
            className="bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg font-semibold transition-all duration-300 shadow-lg"
          >
            Join Class
          </button>
        </div>
      </div>

      {/* Bottom Section: Your Classrooms */}
      <div className="p-8 mt-6 bg-white/10 backdrop-blur-lg border border-white/20 shadow-md rounded-lg w-full max-w-4xl text-center">
        <h2 className="text-2xl font-semibold mb-6 drop-shadow-lg">
          Your Classrooms:
        </h2>
        {classrooms.length > 0 ? (
          <div className="flex flex-col gap-4">
            {classrooms.map((classroom) => (
              <div
                key={classroom._id}
                onClick={() => navigate(`/classroom/${classroom._id}`)}
                className="p-4 bg-white/20 border border-white/30 rounded-lg cursor-pointer hover:bg-white/30 transition text-center"
              >
                <h3 className="text-lg font-bold">{classroom.name}</h3>
                <p className="text-sm">Subject: {classroom.subject}</p>
                <p className="text-sm">
                  Teacher: {classroom.teacher?.name || "Unknown"}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-300">
            You are not enrolled in any classrooms.
          </p>
        )}
      </div>
      <div className="p-4 mt-6 pb-8 bg-white/10 backdrop-blur-lg border border-white/20 shadow-md rounded-lg w-full max-w-4xl flex justify-center items-center"> 
        <button
          onClick={handleStudy}
          className="bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg font-semibold transition-all duration-300 shadow-lg mt-6"
        >
          Study
        </button>
      </div>

      {/* Subjects Section */}
      {showSubjects && (
        <div className="p-8">
          <h2 className="text-2xl font-semibold text-white mb-6">Subjects:</h2>
          <div className="gap-4">
            {subjects.map((subject) => (
              <div
                key={subject._id}
                className="p-4 bg-white shadow-md w-full rounded-lg cursor-pointer hover:bg-gray-100"
                onClick={() => handleSubjectClick(subject.syllabus)}
              >
                <h3 className="text-lg font-bold text-gray-800">
                  {subject.name}
                </h3>
                <p className="text-sm text-gray-600">
                  Semester: {subject.semester}
                </p>
                <p className="text-sm text-gray-600">
                  Branch: {subject.branch}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Topics Section */}
      {showTopics && (
        <div className="p-8">
          <h2 className="text-xl font-semibold text-gray-700 mb-6">Topics:</h2>
          <div className="grid grid-cols-2 gap-4">
            {topics.map((topic) => (
              <div
                key={topic.order}
                className="p-4 bg-white shadow-md rounded-lg cursor-pointer hover:bg-gray-100"
                onClick={() => handleTopicClick(topic.topic)}
              >
                <h4 className="text-md font-semibold text-gray-800">
                  {topic.order}. {topic.topic}
                </h4>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Home;
