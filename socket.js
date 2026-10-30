// socket.js
const { sendPushToUser } = require('./utils/webPush');
const User = require('./models/User');
const jwt = require('jsonwebtoken');
const config = require('./config');
const storeAccess = require('./services/storeAccess');

/**
 * Socket egasi - HttpOnly ccessToken cookie'sidan (imzolangan JWT). Mijoz
 * uth.login da yuborgan qiymatga ISHONILMAYDI: aks holda istalgan odam
 * boshqaning loginini yozib, uning xabarlarini olar va uning nomidan yozardi.
 * Yaroqsiz/tokensiz socket - 
ull (ro'yxatga olinmaydi, xabar yubora olmaydi).
 */
function socketClaims(socket) {
  const raw = socket.request && socket.request.headers && socket.request.headers.cookie;
  if (!raw) return null;
  const m = raw.split(';').map(s => s.trim()).find(s => s.startsWith('accessToken='));
  if (!m) return null;
  try {
    const decoded = jwt.verify(decodeURIComponent(m.slice('accessToken='.length)), config.JWT_SECRET);
    return decoded && decoded.login ? { login: decoded.login, sc: decoded.sc || '' } : null;
  } catch {
    return null;
  }
}

/** Chat - do'kon kategoriyasi bo'yicha ruxsat (REST /api/chat/* bilan bir xil qoida). */
function canChat(claims) {
  return Boolean(claims) && storeAccess.isAllowed(claims.sc, '/chat/send');
}

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

    // ✅ 1. Ulanishda auth orqali royxatga olish
    const claims = socketClaims(socket);
    const authLogin = claims ? claims.login : null; // cookie'dagi token bo'yicha
    const authDeviceId = socket.handshake.auth?.deviceId;

    if (authLogin) {
      _registerSocket(socket.id, authLogin, authDeviceId || null);
      console.log(`[Socket] ${authLogin} handshake orqali ulandi. Socket: ${socket.id}`);
      io.emit('userStatusChange', { login: authLogin, status: 'online' });
    }

    // ✅ 2. Qo'lda ro'yxatdan o'tish
    socket.on('registerUser', ({ deviceId }) => {
      const login = claims ? claims.login : null; // mijoz yuborgan login e'tiborsiz
      if (!login) return;

      const resolvedDeviceId = deviceId || socket.handshake.auth?.deviceId || null;

      if (userSockets[login]) {
        userSockets[login] = userSockets[login].filter(
          s => s.deviceId !== resolvedDeviceId || s.socketId === socket.id
        );
      }

      _registerSocket(socket.id, login, resolvedDeviceId);
      console.log(`[Socket] ${login} qo'lda ro'yxatga olindi. Socket: ${socket.id}`);
      io.emit('userStatusChange', { login, status: 'online' });
    });

    // ✅ 3. Onlayn foydalanuvchilar ro'yxatini olish
    socket.on('getOnlineUsers', () => {
      const onlineLogins = Object.keys(userSockets).filter(login => userSockets[login].length > 0);
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

    // 💬 Private Message
    socket.on('privateMessage', async ({ receiver, content }) => {
      const sender = claims ? claims.login : null;
      if (!sender || !receiver || !content) return;
      if (!canChat(claims)) return; // do'kon kategoriyasi chatni yopgan

      console.log(`💬 Xabar: ${sender} -> ${receiver}`);

      // 1. MongoDB ga saqlash
      try {
        const UserChatHistory = require('./models/UserChatHistory');
        const { encryptAndCompress } = require('./utils/chatCrypto');
        const roomId = [sender, receiver].sort().join('_');

        let bucket = await UserChatHistory.findOne({ roomId, isFull: false }).sort({ bucketId: -1 });
        let messages = [];
        if (bucket) {
          const { decryptAndDecompress } = require('./utils/chatCrypto');
          try { messages = JSON.parse(decryptAndDecompress(bucket.encryptedMessages)); } catch (e) {}
        } else {
          const lastBucket = await UserChatHistory.findOne({ roomId }).sort({ bucketId: -1 });
          bucket = new UserChatHistory({
            roomId,
            bucketId: lastBucket ? lastBucket.bucketId + 1 : 0,
            encryptedMessages: ''
          });
        }
        messages.push({ sender, content, timestamp: new Date() });
        bucket.encryptedMessages = encryptAndCompress(JSON.stringify(messages));
        bucket.count = messages.length;
        if (bucket.count >= 200) bucket.isFull = true;
        await bucket.save();
      } catch (err) {
        console.error('Socket chat saqlashda xato:', err.message);
      }

      // 2. Qabul qiluvchiga socket yuborish
      const receiverSockets = userSockets[receiver] || [];
      receiverSockets.forEach(s => {
        io.to(s.socketId).emit('privateMessage', { sender, content, timestamp: new Date() });
      });

      // 3. Yuboruvchining boshqa qurilmalariga
      const senderSockets = userSockets[sender] || [];
      senderSockets.forEach(s => {
        if (s.socketId !== socket.id) {
          io.to(s.socketId).emit('privateMessage', { sender, content, timestamp: new Date() });
        }
      });

      // ✅ 4. Receiver offline bo'lsa Push Notification yuborish
      const isReceiverOnline = receiverSockets.length > 0;
      if (!isReceiverOnline) {
        try {
          const receiverUser = await User.findOne({ login: receiver }).select('pushSubscription firstName name login');
          if (receiverUser?.pushSubscription) {
            const senderUser = await User.findOne({ login: sender }).select('firstName name login');
            const senderName = senderUser?.firstName || senderUser?.name || sender;

            const result = await sendPushToUser(receiverUser.pushSubscription, {
              title: `📩 ${senderName} dan yangi xabar`,
              body: content.length > 80 ? content.substring(0, 80) + '...' : content,
              icon: '/shoxpospro.png',
              badge: '/shoxpospro.png',
              url: '/chat',
            });

            // Subscription eskirgan bo'lsa o'chirish
            if (result === 'expired') {
              await User.findOneAndUpdate(
                { login: receiver },
                { pushSubscription: null }
              );
              console.log(`[Push] ${receiver} subscription eskirgan, o'chirildi`);
            }
          }
        } catch (err) {
          console.error('Push notification xatosi:', err.message);
        }
      }
    });

    // ✏️ Xabarni tahrirlash
    socket.on('editMessage', async ({ receiver, timestamp, newContent }) => {
      const sender = claims ? claims.login : null;
      if (!sender || !receiver || !timestamp || !newContent) return;
      if (!canChat(claims)) return; // do'kon kategoriyasi chatni yopgan

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
          const receiverSockets = userSockets[receiver] || [];
          receiverSockets.forEach(s => {
            io.to(s.socketId).emit('messageEdited', { sender, receiver, timestamp, newContent });
          });
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