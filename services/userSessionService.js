const UserSession = require('../models/UserSession');

/**
 * Yangi sessiya yaratish yoki mavjudini yangilash.
 * refreshTokenId / refreshToken kelsa, ularni refreshTokens massiviga to'liq
 * ma'lumot (tokenId, token, deviceId, deviceType, deviceOS, createdAt) bilan qo'shadi.
 */
exports.createSession = async ({
  userId,
  deviceId,
  ip,
  userAgent,
  refreshTokenId,
  refreshToken,
  deviceType,
  deviceOS,
}) => {
  try {
    let session = await UserSession.findOne({ userId, deviceId });
    if (!session) {
      session = new UserSession({
        userId,
        deviceId,
        ip: ip || null,
        userAgent: userAgent || null,
        refreshTokens: [],
      });
    }

    if (refreshTokenId && refreshToken) {
      session.refreshTokens.push({
        tokenId: refreshTokenId,
        token: refreshToken,
        deviceId,
        deviceType: deviceType || 'Unknown',
        deviceOS: deviceOS || 'Unknown',
        createdAt: new Date(),
      });
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

/**
 * Eski refreshToken ni yangisiga almashtirish.
 * Agar sessiya topilmasa, yangi sessiya yaratadi.
 */
exports.rotateRefreshToken = async ({
  userId,
  deviceId,
  oldTokenId,
  newToken,
}) => {
  try {
    let session = await UserSession.findOne({ userId, deviceId });

    if (!session) {
      if (!newToken) return;
      session = new UserSession({
        userId,
        deviceId,
        refreshTokens: [newToken],
      });
      await session.save();
      return;
    }

    if (oldTokenId) {
      session.refreshTokens = (session.refreshTokens || []).filter(
        (rt) => rt.tokenId !== oldTokenId,
      );
    }

    if (newToken) {
      session.refreshTokens.push(newToken);
    }

    session.updatedAt = new Date();
    await session.save();
  } catch (err) {
    console.error('❌ rotateRefreshToken xatosi:', err);
    throw err;
  }
};
