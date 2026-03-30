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
      io.emit('userStatusChange', { login: authLogin, status: 'online' });
    }

    socket.on('registerUser', ({ login, deviceId }) => {
      if (!login) return;

      // ✅ deviceId yo'q bo'lsa handshake dan ol
      const resolvedDeviceId = deviceId || socket.handshake.auth?.deviceId || null;

      if (userSockets[login]) {
        userSockets[login] = userSockets[login].filter(
          s => s.deviceId !== resolvedDeviceId
        );
      }

      _registerSocket(socket.id, login, resolvedDeviceId);
      console.log(`${login} | deviceId: ${resolvedDeviceId} | socket: ${socket.id}`);
      io.emit('userStatusChange', { login, status: 'online' });
    });

    socket.on('getOnlineUsers', () => {
      const onlineLogins = Object.keys(userSockets);
      socket.emit('onlineUsersList', onlineLogins);
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
      const disconnectedLogin = Object.keys(userSockets).find(login => 
        userSockets[login].some(s => s.socketId === socket.id)
      );
      
      _removeSocket(socket.id);
      
      if (disconnectedLogin && !userSockets[disconnectedLogin]) {
        io.emit('userStatusChange', { login: disconnectedLogin, status: 'offline' });
      }

      activeUsers = activeUsers.map(u => {
        const hasActiveSockets =
          userSockets[u.login] && userSockets[u.login].length > 0;
        if (hasActiveSockets) return u;
        return { ...u, active: false, lastActive: new Date().toLocaleString() };
      });
      io.emit('userDisconnected', { socketId: socket.id, activeUsers });
    });

    // 💬 Foydalanuvchilar orasidagi chat xabarlari
    socket.on('privateMessage', async ({ receiver, content }) => {
      const sender = socket.handshake.auth?.login;
      if (!sender || !receiver || !content) return;

      console.log(`💬 Xabar: ${sender} -> ${receiver}`);

      // 1. Xabarni MongoDB ga saqlash (Backend route'dan save funksiyasini chaqiramiz)
      // ES6 import bo'lmagani uchun require orqali chaqirish yoki shunchaki saqlash
      // Shunchaki saqlashni shu yerda ham qilish mumkin lekin userChatRoutes da bor
      try {
        const UserChatHistory = require('./models/UserChatHistory');
        const { encryptAndCompress } = require('./utils/chatCrypto');
        const roomId = [sender, receiver].sort().join('_');
        
        let bucket = await UserChatHistory.findOne({ roomId, isFull: false }).sort({ bucketId: -1 });
        let messages = [];
        if (bucket) {
          const { decryptAndDecompress } = require('./utils/chatCrypto');
          try { messages = JSON.parse(decryptAndDecompress(bucket.encryptedMessages)); } catch(e) {}
        } else {
          const lastBucket = await UserChatHistory.findOne({ roomId }).sort({ bucketId: -1 });
          bucket = new UserChatHistory({ roomId, bucketId: lastBucket ? lastBucket.bucketId + 1 : 0, encryptedMessages: '' });
        }
        messages.push({ sender, content, timestamp: new Date() });
        bucket.encryptedMessages = encryptAndCompress(JSON.stringify(messages));
        bucket.count = messages.length;
        if (bucket.count >= 200) bucket.isFull = true;
        await bucket.save();
      } catch (err) {
        console.error('Socket chat saqlashda xato:', err.message);
      }

      // 2. Qabul qiluvchiga yuborish
      const receiverSockets = userSockets[receiver] || [];
      receiverSockets.forEach(s => {
        io.to(s.socketId).emit('privateMessage', { sender, content, timestamp: new Date() });
      });

      // 3. Yuboruvchiga tasdiqlash (o'zining boshqa qurilmalari uchun ham)
      const senderSockets = userSockets[sender] || [];
      senderSockets.forEach(s => {
        if (s.socketId !== socket.id) {
          io.to(s.socketId).emit('privateMessage', { sender, content, timestamp: new Date() });
        }
      });
    });

    // ✏️ Xabarni tahrirlash
    socket.on('editMessage', async ({ receiver, timestamp, newContent }) => {
      const sender = socket.handshake.auth?.login;
      if (!sender || !receiver || !timestamp || !newContent) return;

      console.log(`✏️ Tahrir: ${sender} -> ${receiver}`);

      try {
        const UserChatHistory = require('./models/UserChatHistory');
        const { encryptAndCompress, decryptAndDecompress } = require('./utils/chatCrypto');
        const roomId = [sender, receiver].sort().join('_');
        const searchDate = new Date(timestamp);
        
        const buckets = await UserChatHistory.find({ roomId }).sort({ bucketId: -1 });
        let found = false;
        for (const bucket of buckets) {
          let messages = JSON.parse(decryptAndDecompress(bucket.encryptedMessages));
          const msgIdx = messages.findIndex(m => 
            m.sender === sender && 
            new Date(m.timestamp).getTime() === searchDate.getTime()
          );

          if (msgIdx !== -1) {
            messages[msgIdx].content = newContent;
            messages[msgIdx].isEdited = true;
            messages[msgIdx].editedAt = new Date();
            bucket.encryptedMessages = encryptAndCompress(JSON.stringify(messages));
            await bucket.save();
            found = true;
            break;
          }
        }

        if (found) {
          // Qabul qiluvchiga yuborish
          const receiverSockets = userSockets[receiver] || [];
          receiverSockets.forEach(s => {
            io.to(s.socketId).emit('messageEdited', { sender, receiver, timestamp, newContent });
          });
          // Yuboruvchining boshqa qurilmalariga
          const senderSockets = userSockets[sender] || [];
          senderSockets.forEach(s => {
            if (s.socketId !== socket.id) {
              io.to(s.socketId).emit('messageEdited', { sender, receiver, timestamp, newContent });
            }
          });
        }
      } catch (err) {
        console.error('Socket chat tahrirlashda xato:', err.message);
      }
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

function sendToUser(login, event, data) {
  if (!io || !userSockets[login]) return;
  userSockets[login].forEach(s => {
    io.to(s.socketId).emit(event, data);
  });
}

function getIO() {
  return io;
}

function getActiveUsers() {
  return activeUsers;
}

module.exports = {
  initIO,
  getUserSockets,
  getSocketByDevice,
  sendToUser,
  getIO,
  getActiveUsers
};