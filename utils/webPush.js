// utils/webPush.js
const webpush = require('web-push');
const { normalizeSubscription } = require('./pushSubscription');

webpush.setVapidDetails(
  process.env.VAPID_EMAIL || 'mailto:admin@shoxpospro.uz',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const sendPushToUser = async (stored, payload) => {
  // Bazadagi eski (tekshirilmagan) yozuv ham ichki manzilga yuborilmasin (SSRF).
  const subscription = normalizeSubscription(stored);
  if (!subscription) return;
  try {
    await webpush.sendNotification(
      subscription,
      JSON.stringify(payload)
    );
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      console.log('Push subscription eskirgan');
      return 'expired';
    }
    console.error('Push yuborishda xato:', err.message);
  }
};

module.exports = { sendPushToUser };