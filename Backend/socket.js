const Classroom = require("./models/Classroom.model")
const joinTimes = {};


const setupSocketIO = (io) => {
  io.on("connection", (socket) => {
    socket.on("broadcaster", ({ classroomId, userId }) => {
      socket.join(classroomId);
      socket.classroomId = classroomId;
      socket.userId = userId;
    });

    socket.on("watcher", async ({ classroomId, watcherId }) => {
      const classroom = await Classroom.findById(classroomId);
      if (!classroom || !classroom.students.includes(watcherId)) {
        socket.emit("not-allowed", { message: "You are not a member of this classroom." });
        return socket.disconnect();
      }
      if (!classroom.credits) classroom.credits = {};
      // Only set to 0 if not already present (so reconnect doesn't reset)
      if (classroom.credits[watcherId] === undefined) classroom.credits[watcherId] = 0;
      await classroom.save();

      if (!joinTimes[classroomId]) joinTimes[classroomId] = {};
      if (!joinTimes[classroomId][watcherId]) joinTimes[classroomId][watcherId] = Date.now();

      socket.join(classroomId);
      socket.classroomId = classroomId;
      socket.userId = watcherId;
      socket.to(classroomId).emit("watcher", { watcherId });
    });

    socket.on("offer", ({ offer, classroomId, to }) => {
      // Send offer to specific watcher
      for (const [id, s] of io.of("/").sockets) {
        if (s.userId === to && s.classroomId === classroomId) {
          s.emit("offer", { offer, from: socket.userId });
        }
      }
    });

    socket.on("answer", ({ answer, classroomId, to }) => {
      // Send answer to teacher
      for (const [id, s] of io.of("/").sockets) {
        if (s.userId === to && s.classroomId === classroomId) {
          s.emit("answer", { answer, from: socket.userId });
        }
      }
    });

    socket.on("ice-candidate", ({ candidate, classroomId, userId }) => {
      // Relay ICE to everyone else in the room
      socket.to(classroomId).emit("ice-candidate", { candidate, from: userId });
    });

    socket.on("student-emotion", async ({ classroomId, name, emotion, userId }) => {
      if (["confused", "bored", "looking away"].includes(emotion)) {
        const classroom = await Classroom.findById(classroomId);
        if (classroom && classroom.credits && classroom.credits[userId] !== undefined) {
          classroom.credits[userId] = classroom.credits[userId] - 1;
          await classroom.save();
        }
      }
      socket.to(classroomId).emit("student-emotion", { name, emotion });
    });
  });
};


// This interval will check every minute if a student has reached 30 minutes, and if so, set their credits to 100 + current (negative) credits, only once
setInterval(async () => {
  const now = Date.now();
  const Classroom = require("./models/Classroom.model");
  const classrooms = await Classroom.find();
  for (const classroom of classrooms) {
    const cid = classroom._id.toString();
    if (!classroom.credits) continue;
    for (const [userId, credits] of Object.entries(classroom.credits)) {
      if (
        joinTimes[cid] &&
        joinTimes[cid][userId] &&
        now - joinTimes[cid][userId] >= 30 * 60 * 1000 && // 30 minutes
        // Only apply this boost once: check if credits <= 100 (so we don't keep adding)
        credits <= 100
      ) {
        classroom.credits[userId] = 100 + credits;
        // Optionally, set joinTimes[cid][userId] = null to avoid repeating
        joinTimes[cid][userId] = null;
      }
    }
    await classroom.save();
  }
}, 60 * 1000); // Check every minute

module.exports = setupSocketIO;