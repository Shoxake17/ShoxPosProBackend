
let io;
let activeUsers = []; // [{ login, deviceId, deviceType, deviceOS, lastActive, active }]
const userSockets = {}; // { login: [socketId, ...] }

/**
 * Socket.io ni ishga tushirish
 * @param {Server} socketIO
 */
function initIO(socketIO) {
  io = socketIO;

  io.on('connection', (socket) => {
    console.log(`🔌 Yangi socket ulandi: ${socket.id}`);

    // 📌 Foydalanuvchini ro'yxatga olish
    socket.on('registerUser', ({ login }) => {
      if (!login) return;

      if (!userSockets[login]) userSockets[login] = [];
      if (!userSockets[login].includes(socket.id)) {
        userSockets[login].push(socket.id);
      }

      console.log(`📲 ${login} socket ro'yxatga olindi: ${socket.id}`);
    });

    // 📌 Foydalanuvchi tizimga kirganida
    socket.on('userLogged', (user) => {
      if (!user || !user.login || !user.deviceId) return;

      const updatedUser = {
        login: user.login,
        deviceId: user.deviceId,
        deviceType: user.deviceType || "Noma'lum",
        deviceOS: user.deviceOS || "Noma'lum",
        lastActive: new Date().toLocaleString(),
        active: true
      };

      const index = activeUsers.findIndex(u => u.deviceId === user.deviceId);
      if (index !== -1) {
        activeUsers[index] = updatedUser;
      } else {
        activeUsers.push(updatedUser);
      }

      io.emit('userLogged', updatedUser);
    });

    // 📌 Socket uzilganda
    socket.on('disconnect', () => {
      console.log(`❌ Socket uzildi: ${socket.id}`);

      // userSockets dan o'chirish
      for (const login in userSockets) {
        userSockets[login] = userSockets[login].filter(id => id !== socket.id);
        if (userSockets[login].length === 0) {
          delete userSockets[login];
        }
      }

      // activeUsers statusini yangilash
      activeUsers = activeUsers.map(u => {
        if (userSockets[u.login] && userSockets[u.login].length > 0) {
          return u; // hali boshqa socketlari bor
        }
        return { ...u, active: false, lastActive: new Date().toLocaleString() };
      });

      io.emit('userDisconnected', { socketId: socket.id, activeUsers });
    });
  });
}

/**
 * Socket.io instance qaytaradi
 */
function getIO() {
  if (!io) {
    throw new Error('Socket.io hali ishga tushirilmagan!');
  }
  return io;
}

/**
 * Faol foydalanuvchilar ro'yxatini qaytaradi
 */
function getActiveUsers() {
  return activeUsers;
}

/**
 * Foydalanuvchi socketlarini qaytaradi
 */
function getUserSockets() {
  return userSockets;
}

module.exports = {
  initIO,
  getIO,
  getActiveUsers,
  getUserSockets
};
