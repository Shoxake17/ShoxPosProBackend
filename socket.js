// socket.js — OnDex Merchant web paneli uchun jonli kanal.
//
// Faqat SERVER -> foydalanuvchi xabarlari (buyurtma, kuryer, qurilmani chiqarish).
// OLIB TASHLANDI: ichki chat (privateMessage/editMessage — OnDex support/chat
// servisiga o'tdi) va "kim onlayn" kuzatuvi. Ikkinchisi xavfsizlik nosozligi edi:
// `userStatusChange`/`userLogged` HAR kirishni BARCHA ulangan foydalanuvchilarga
// tarqatardi — bir do'kon boshqa do'konlarning loginlari va onlayn vaqtini ko'rardi.
'use strict';

const bff = require('./services/bffSession');

/**
 * Socket egasi — HttpOnly BFF sessiya cookie'sidan (A4c.4). Mijoz yuborgan
 * login'ga ISHONILMAYDI. Sessiyasiz/yopilgan sessiyali socket ro'yxatga olinmaydi.
 */
async function socketClaims(socket) {
  const raw = socket.request && socket.request.headers && socket.request.headers.cookie;
  if (!raw) return null;
  const name = `${bff.cookieName()}=`;
  const m = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(name));
  if (!m) return null;
  try {
    const s = await bff.find(decodeURIComponent(m.slice(name.length)));
    if (!s || s.role === 'admin') return null; // admin roli yo'q
    return { login: s.login, deviceId: s.ondexSid };
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

  io.on('connection', async (socket) => {
    // disconnect ishlovchisi `await` dan OLDIN — tez uzilgan socket ro'yxatda qolib ketmasin.
    socket.on('disconnect', () => removeSocket(socket.id));
    const claims = await socketClaims(socket);
    // Qurilma = OnDex sessiyasi: back-channel/chiqishda aynan shu socket uziladi.
    // Sessiyasiz socket (avvalgidek) ulanib turadi, lekin hech qanday xabar olmaydi.
    if (claims && socket.connected) registerSocket(socket.id, claims.login, claims.deviceId);

    // Qurilma identifikatori bilan qayta ro'yxatdan o'tish (login TOKENDAN).
    socket.on('registerUser', ({ deviceId } = {}) => {
      if (!claims) return;
      const resolved = claims.deviceId || deviceId || null;
      if (userSockets[claims.login]) {
        userSockets[claims.login] = userSockets[claims.login].filter(
          (s) => s.deviceId !== resolved || s.socketId === socket.id
        );
      }
      registerSocket(socket.id, claims.login, resolved);
    });
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

/** Sessiya yopildi: shu qurilma (OnDex sid) socketlariga forceLogout va uzish. */
function kickDevice(login, deviceId) {
  if (!io) return;
  for (const sid of getSocketByDevice(login, deviceId)) {
    io.to(sid).emit('forceLogout', { reason: 'Sessiya tugatildi. Qaytadan kiring.' });
    const sock = io.sockets && io.sockets.sockets && io.sockets.sockets.get(sid);
    if (sock) sock.disconnect(true);
  }
}

module.exports = { initIO, getUserSockets, getSocketByDevice, sendToUser, getIO, kickDevice };
