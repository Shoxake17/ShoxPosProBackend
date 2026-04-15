const Redis = require('ioredis');

/**
 * 🚀 Professional Redis Konfiguratsiyasi
 */
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB || '0', 10),
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
};

const redisClient = new Redis(redisConfig);

redisClient.on('connect', () => {
  console.log('✅ Redis serveriga ulanish muvaffaqiyatli');
});

redisClient.on('ready', () => {
  console.log('🚀 Redis server tayyor');
});

redisClient.on('error', (err) => {
  console.error('❌ Redis xatosi:', err.message);
});

redisClient.on('close', () => {
  console.warn('⚠️ Redis ulanishi yopildi');
});

module.exports = redisClient;
