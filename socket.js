// socket.js

let io;
let activeUsers = []; // [{ login, deviceId, deviceType, deviceOS, lastActive, active }]
const userSockets = {}; // { login: [{ socketId, deviceId }] }

// ====================================
// 🔧 ICHKI YORDAMCHI
// ====================================
function _registerSocket(socketId, login, deviceId = null) {
  if (!login) return;
  if (!userSockets[login]) userSockets[login] = [];

  // Bir xil socketId ikki marta qo'shilmasin
  const exists = userSockets[login].some(s => s.socketId === socketId);
  if (!exists) {
    userSockets[login].push({ socketId, deviceId });
  }
}

// ====================================
// 🚀 ASOSIY INIT
// ====================================
function initIO(socketIO) {
  io = socketIO;

  io.on('connection', (socket) => {
    console.log(`🔌 Yangi socket ulandi: ${socket.id}`);

    // ✅ Handshake auth dan oldindan login/deviceId olish (ixtiyoriy)
    const authLogin = socket.handshake.auth?.login;
    const authDeviceId = socket.handshake.auth?.deviceId;
    if (authLogin) {
      _registerSocket(socket.id, authLogin, authDeviceId);
      console.log(`📲 ${authLogin} handshake orqali ro'yxatga olindi`);
    }

    // ✅ registerUser event — deviceId ham qabul qilinadi
    socket.on('registerUser', ({ login, deviceId }) => {
      if (!login) return;
      _registerSocket(socket.id, login, deviceId || null);
      console.log(`📲 ${login} | deviceId: ${deviceId} | socket: ${socket.id}`);
    });

    // ✅ Foydalanuvchi tizimga kirganida
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

    // ✅ Socket uzilganda
    socket.on('disconnect', () => {
      console.log(`❌ Socket uzildi: ${socket.id}`);

      // ✅ TO'G'RILANDI: object array ni to'g'ri filter qilish
      for (const login in userSockets) {
        userSockets[login] = userSockets[login].filter(
          s => s.socketId !== socket.id  // ← s.socketId, s emas!
        );
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

// ====================================
// 📡 Login bo'yicha barcha socketId lar
// ✅ Eski server.js kodi bilan TO'LIQ MOS
// ====================================
function getUserSockets() {
  const result = {};
  for (const login in userSockets) {
    result[login] = userSockets[login].map(s => s.socketId);
  }
  return result;
}

// ====================================
// 🎯 DeviceId bo'yicha socketId lar — KICK uchun
// ====================================
function getSocketByDevice(login, deviceId) {
  const sockets = userSockets[login] || [];
  return sockets
    .filter(s => s.deviceId === deviceId)
    .map(s => s.socketId);
}

// ====================================
// 🔌 IO instance
// ====================================
function getIO() {
  if (!io) throw new Error('Socket.io hali ishga tushirilmagan!');
  return io;
}

// ====================================
// 👥 Faol foydalanuvchilar
// ====================================
function getActiveUsers() {
  return activeUsers;
}

module.exports = {
  initIO,
  getIO,
  getActiveUsers,
  getUserSockets,
  getSocketByDevice  // ✅ YANGI — server.js kick-device uchun
};