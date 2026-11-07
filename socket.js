// socket.js — OnDex Merchant web paneli uchun jonli kanal.
//
// Faqat SERVER -> foydalanuvchi xabarlari (buyurtma, kuryer, qurilmani chiqarish).
// OLIB TASHLANDI: ichki chat (privateMessage/editMessage — OnDex support/chat
// servisiga o'tdi) va "kim onlayn" kuzatuvi. Ikkinchisi xavfsizlik nosozligi edi:
// `userStatusChange`/`userLogged` HAR kirishni BARCHA ulangan foydalanuvchilarga
// tarqatardi — bir do'kon boshqa do'konlarning loginlari va onlayn vaqtini ko'rardi.
'use strict';

const jwt = require('jsonwebtoken');
const config = require('./config');

/**
 * Socket egasi — HttpOnly `accessToken` cookie'sidan (imzolangan JWT). Mijoz
 * yuborgan login'ga ISHONILMAYDI. Yaroqsiz/tokensiz socket ro'yxatga olinmaydi.
 */
function socketClaims(socket) {
  const raw = socket.request && socket.request.headers && socket.request.headers.cookie;
  if (!raw) return null;
  const m = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith('accessToken='));
  if (!m) return null;
  try {
    const decoded = jwt.verify(decodeURIComponent(m.slice('accessToken='.length)), config.JWT_SECRET);
    if (!decoded || !decoded.login || decoded.role === 'admin') return null; // admin roli yo'q
    return { login: decoded.login };
  } catch {
    return null;
  }
}

let io;
const userSockets = {};

function registerSocket(socketId, login, deviceId = null) {
  if (!login) return;
  if (!userSockets[login]) userSockets[login] = [];
  if (!userSockets[login].some((s) => s.socketId === socketId)) {
    userSockets[login].push({ socketId, deviceId });
  }
}

function removeSocket(socketId) {
  for (const login in userSockets) {
    userSockets[login] = userSockets[login].filter((s) => s.socketId !== socketId);
    if (userSockets[login].length === 0) delete userSockets[login];
  }
}

function initIO(socketIO) {
  io = socketIO;

  io.on('connection', (socket) => {
    const claims = socketClaims(socket);
    if (claims) {
      registerSocket(socket.id, claims.login, socket.handshake.auth?.deviceId || null);
    }

    // Qurilma identifikatori bilan qayta ro'yxatdan o'tish (login TOKENDAN).
    socket.on('registerUser', ({ deviceId } = {}) => {
      if (!claims) return;
      const resolved = deviceId || socket.handshake.auth?.deviceId || null;
      if (userSockets[claims.login]) {
        userSockets[claims.login] = userSockets[claims.login].filter(
          (s) => s.deviceId !== resolved || s.socketId === socket.id
        );
      }
      registerSocket(socket.id, claims.login, resolved);
    });

    socket.on('disconnect', () => removeSocket(socket.id));
  });
}

function getUserSockets() {
  const result = {};
  for (const login in userSockets) result[login] = userSockets[login].map((s) => s.socketId);
  return result;
}

function getSocketByDevice(login, deviceId) {
  return (userSockets[login] || []).filter((s) => s.deviceId === deviceId).map((s) => s.socketId);
}

function sendToUser(login, event, data) {
  if (!io || !userSockets[login]) return;
  userSockets[login].forEach((s) => io.to(s.socketId).emit(event, data));
}

function getIO() {
  return io;
}

module.exports = { initIO, getUserSockets, getSocketByDevice, sendToUser, getIO };
