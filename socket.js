// socket.js

let io;
let activeUsers = [];
const userSockets = {};

function _registerSocket(socketId, login, deviceId = null) {
  if (!login) return;
  if (!userSockets[login]) userSockets[login] = [];
  const exists = userSockets[login].some(s => s.socketId === socketId);
  if (!exists) {
    userSockets[login].push({ socketId, deviceId });
  }
}

function _removeSocket(socketId) {
  for (const login in userSockets) {
    userSockets[login] = userSockets[login].filter(s => s.socketId !== socketId);
    if (userSockets[login].length === 0) {
      delete userSockets[login];
    }
  }
}

function initIO(socketIO) {
  io = socketIO;

  io.on('connection', (socket) => {
    console.log(`Socket ulandi: ${socket.id}`);

    const authLogin = socket.handshake.auth?.login;
    const authDeviceId = socket.handshake.auth?.deviceId;
    if (authLogin) {
      _registerSocket(socket.id, authLogin, authDeviceId || null);
      console.log(`${authLogin} handshake orqali royxatga olindi`);
    }

    socket.on('registerUser', ({ login, deviceId }) => {
      if (!login) return;
      if (userSockets[login]) {
        userSockets[login] = userSockets[login].filter(s => s.deviceId !== deviceId);
      }
      _registerSocket(socket.id, login, deviceId || null);
      console.log(`${login} | deviceId: ${deviceId} | socket: ${socket.id}`);
    });

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

    socket.on('disconnect', () => {
      console.log(`Socket uzildi: ${socket.id}`);
      _removeSocket(socket.id);
      activeUsers = activeUsers.map(u => {
        const hasActiveSockets = userSockets[u.login] && userSockets[u.login].length > 0;
        if (hasActiveSockets) return u;
        return { ...u, active: false, lastActive: new Date().toLocaleString() };
      });
      io.emit('userDisconnected', { socketId: socket.id, activeUsers });
    });
  });
}

function getUserSockets() {
  const result = {};
  for (const login in userSockets) {
    result[login] = userSockets[login].map(s => s.socketId);
  }
  return result;
}

function getSocketByDevice(login, deviceId) {
  const sockets = userSockets[login] || [];
  return sockets.filter(s => s.deviceId === deviceId).map(s => s.socketId);
}

function getIO() {
  if (!io) throw new Error('Socket.io hali ishga tushirilmagan!');
  return io;
}

function getActiveUsers() {
  return activeUsers;
}

module.exports = { initIO, getIO, getActiveUsers, getUserSockets, getSocketByDevice };