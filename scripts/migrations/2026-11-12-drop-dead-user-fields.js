// scripts/migrations/2026-11-12-drop-dead-user-fields.js
//
// O'lik maydonlarni BAZADAN o'chiradi (sxemadan olib tashlash ularni
// o'chirmaydi). Ular orasida xavflilari bor: `googleAuthSecret` (TOTP siri
// OCHIQ matnda), `devices[].token` (JWT), `devices[].biometric.publicKey`,
// `password` (bcrypt xesh).
//
// Ishga tushirish (standart — faqat HISOBOT, hech narsa o'zgarmaydi):
//   npx dotenvx run -- node scripts/migrations/2026-11-12-drop-dead-user-fields.js
//   ... --apply      # haqiqatan o'zgartirish (OLDIN zaxira oling!)
//
// Tartib (fail-closed):
//   1) eski `role: 'admin'` yozuvlari AVVAL bloklanadi (blocked: true) — rol
//      o'chgach ular oddiy hisobga aylanib qolmasin;
//   2) o'lik maydonlar $unset;
//   3) ularning noyob indekslari (email_1, uniqueChatId_1) o'chiriladi;
//   4) BFF sessiyalaridan `role`.
// Takroran ishga tushirish xavfsiz (idempotent). Qiymatlar logga CHIQMAYDI.
'use strict';

const mongoose = require('mongoose');

const DEAD_USER_FIELDS = [
  'password', 'role', 'subscription', 'email', 'activeDevice', 'devices',
  'googleAuthSecret', 'googleAuthEnabled', 'loginAttempts', 'blockedDevices',
  'isSecret', 'uniqueChatId', 'telegramId', 'pushSubscriptions',
];
const DEAD_USER_INDEXES = ['email_1', 'uniqueChatId_1'];

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI berilmagan');
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const users = db.collection('users');
  const sessions = db.collection('bffsessions');

  const anyDead = { $or: DEAD_USER_FIELDS.map((f) => ({ [f]: { $exists: true } })) };
  const report = {
    rejim: apply ? 'APPLY' : 'DRY-RUN (hech narsa o\'zgarmadi)',
    admin_hisoblar: await users.countDocuments({ role: 'admin' }),
    olik_maydonli_hisoblar: await users.countDocuments(anyDead),
    totp_siri_bor: await users.countDocuments({ googleAuthSecret: { $nin: [null, ''] } }),
    jwt_token_bor: await users.countDocuments({ 'devices.token': { $nin: [null, ''] } }),
    parol_xeshi_bor: await users.countDocuments({ password: { $nin: [null, ''] } }),
    rolli_sessiyalar: await sessions.countDocuments({ role: { $exists: true } }),
  };
  const existing = (await users.indexes()).map((i) => i.name);
  report.olik_indekslar = DEAD_USER_INDEXES.filter((n) => existing.includes(n));

  if (apply) {
    const blocked = await users.updateMany({ role: 'admin' }, { $set: { blocked: true } });
    const unset = Object.fromEntries(DEAD_USER_FIELDS.map((f) => [f, '']));
    const cleaned = await users.updateMany(anyDead, { $unset: unset });
    for (const name of report.olik_indekslar) await users.dropIndex(name);
    const sess = await sessions.updateMany({ role: { $exists: true } }, { $unset: { role: '' } });
    report.natija = {
      bloklangan_admin: blocked.modifiedCount,
      tozalangan_hisob: cleaned.modifiedCount,
      tozalangan_sessiya: sess.modifiedCount,
      qolgan_olik: await users.countDocuments(anyDead),
    };
  }
  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('Migratsiya xatosi:', err && err.message);
  try { await mongoose.disconnect(); } catch { /* yopiq */ }
  process.exit(1);
});
