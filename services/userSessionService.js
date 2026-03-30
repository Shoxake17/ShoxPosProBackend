const UserSession = require('../models/UserSession');

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
    const updateData = {
      $set: {
        ip: ip || null,
        userAgent: userAgent || null,
        updatedAt: new Date(),
      },
    };

    if (refreshTokenId && refreshToken) {
      updateData.$push = {
        refreshTokens: {
          tokenId: refreshTokenId,
          token: refreshToken,
          deviceId,
          deviceType: deviceType || 'Unknown',
          deviceOS: deviceOS || 'Unknown',
          createdAt: new Date(),
        },
      };
    }

    await UserSession.findOneAndUpdate(
      { userId, deviceId },
      updateData,
      { upsert: true, returnDocument: 'after' }
    );
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

exports.rotateRefreshToken = async ({
  userId,
  deviceId,
  oldTokenId,
  newToken,
}) => {
  try {
    // 1) Sessiya mavjudligini tekshir
    const session = await UserSession.findOne({ userId, deviceId });

    if (!session) {
      // Sessiya yo'q — yangi yarat
      if (!newToken) return;
      await UserSession.create({
        userId,
        deviceId,
        refreshTokens: [newToken],
        updatedAt: new Date(),
      });
      return;
    }

    // 2) Eski tokenni atomic o'chir
    if (oldTokenId) {
      await UserSession.findOneAndUpdate(
        { userId, deviceId },
        { $pull: { refreshTokens: { tokenId: oldTokenId } } }
      );
    }

    // 3) Yangi tokenni atomic qo'sh
    if (newToken) {
      await UserSession.findOneAndUpdate(
        { userId, deviceId },
        {
          $push: { refreshTokens: newToken },
          $set: { updatedAt: new Date() },
        }
      );
    }
  } catch (err) {
    console.error('❌ rotateRefreshToken xatosi:', err);
    throw err;
  }
};