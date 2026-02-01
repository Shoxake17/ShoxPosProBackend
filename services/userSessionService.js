const UserSession = require('../models/UserSession');

exports.createSession = async ({ userId, deviceId, ip, userAgent, refreshTokenId, refreshToken }) => {
  try {
    // Yangi session yaratish yoki mavjudini yangilash
    let session = await UserSession.findOne({ userId, deviceId });
    if (!session) {
      session = new UserSession({ userId, deviceId, ip, userAgent, refreshTokens: [] });
    }
    // Refresh token qo'shish
    if (refreshTokenId && refreshToken) {
      session.refreshTokens.push({ tokenId: refreshTokenId, token: refreshToken });
    }
    session.updatedAt = new Date();
    await session.save();
  } catch (err) {
    console.error('❌ createSession xatosi:', err);
    throw err;
  }
};

exports.endSession = async ({ userId, deviceId, reason }) => {
  try {
    // Device bo'yicha sessionni o'chirish
    await UserSession.findOneAndDelete({ userId, deviceId });
    console.log(`🔴 SESSION ENDED: user ${userId}, device ${deviceId}, reason: ${reason}`);
  } catch (err) {
    console.error('❌ endSession xatosi:', err);
    throw err;
  }
};

exports.getSession = async (userId, deviceId) => {
  try {
    const session = await UserSession.findOne({ userId, deviceId });
    if (!session) return null;
    return session;
  } catch (err) {
    console.error('❌ getSession xatosi:', err);
    throw err;
  }
};
