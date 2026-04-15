const redisClient = require('../config/redis');

/**
 * 🚀 Senior Level Professional Redis Cache Middleware
 * Request deduplication + caching + stampede protection + FALLBACK!
 */

// Redis ishlayotganligini tekshirish uchun flag
let redisAvailable = true;

// Redis connection status'ni kuzatish
redisClient.on('error', () => {
  redisAvailable = false;
  console.warn('⚠️ Redis ulanmadi, cache o\'chirildi');
});

redisClient.on('connect', () => {
  redisAvailable = true;
  console.log('✅ Redis ulandi, cache faol');
});

// Cache vaqtlarini ( sekundlarda) saqlash uchun konfiguratsiya
const CACHE_TTL = {
  SHORT: 30,       // 30 soniya - qidiruv va tez o'zgaruvchi ma'lumotlar
  MEDIUM: 180,     // 3 daqiqa - user products, sales
  LONG: 600,       // 10 daqiqa - count, subscription
  VERY_LONG: 3600, // 1 soat - tashqi API lar
  DAY: 86400       // 1 kun - statik ma'lumotlar
};

/**
 * Cache key generator - unique key yaratadi
 */
const generateCacheKey = (req) => {
  const keyParts = [
    'cache',
    req.method,
    req.originalUrl
  ];
  
  return keyParts.join(':');
};

/**
 * 🚀 Professional Cache Middleware
 */
const cacheMiddleware = (ttlInSeconds, customKeyGenerator = null) => {
  return async (req, res, next) => {
    // Faqat GET so'rovlarini keshlaymiz
    if (req.method !== 'GET') {
      return next();
    }

    // 🚩 1. Redis ishlayotganligini tekshirish - FALLBACK!
    if (!redisAvailable) {
      return next();
    }

    try {
      const cacheKey = customKeyGenerator 
        ? customKeyGenerator(req) 
        : generateCacheKey(req);

      // 2. Keshda mavjudligini tekshirish
      const cachedData = await redisClient.get(cacheKey);

      if (cachedData) {
        try {
          const parsedData = JSON.parse(cachedData);
          return res.json(parsedData);
        } catch (parseErr) {
          console.warn('⚠️ Cache parse xatosi:', parseErr.message);
        }
      }

      // 2. Original response ni override qilish - cache'ga saqlash uchun
      const originalJson = res.json;
      res.json = function(data) {
        // Faqat muvaffaqiyatli javoblarni keshlaymiz
        if (res.statusCode >= 200 && res.statusCode < 300) {
          redisClient.setex(cacheKey, ttlInSeconds, JSON.stringify(data))
            .catch(err => console.warn('⚠️ Cache saqlash xatosi:', err.message));
        }
        return originalJson.call(this, data);
      };

      next();
    } catch (err) {
      console.warn('⚠️ Cache middleware xatosi:', err.message);
      // Cache xatosi bo'lsa ham davom ettiramiz
      next();
    }
  };
};

/**
 * 🗑️ Cache invalidatsiya - pattern bo'yicha cache'larni o'chirish
 */
const invalidateCache = async (pattern) => {
  // 🚩 Redis ishlayotganligini tekshirish - FALLBACK!
  if (!redisAvailable) {
    return;
  }
  
  try {
    const keys = await redisClient.keys(`cache:${pattern}*`);
    if (keys.length > 0) {
      await redisClient.del(keys);
      console.log(`🗑️ ${keys.length} ta cache tozalandi: ${pattern}`);
    }
  } catch (err) {
    console.warn('⚠️ Cache invalidate xatosi:', err.message);
  }
};

/**
 * 🗑️ User-specific cache'ni tozalash
 */
const invalidateUserCache = async (userLogin) => {
  await invalidateCache(`GET:/api/products/user-products`);
  await invalidateCache(`GET:/api/sales`);
  await invalidateCache(`GET:/api/debts`);
  await invalidateCache(`GET:/api/sold-buckets`);
  await invalidateCache(`GET:/api/verify-session`);
  await invalidateCache(`GET:/api/me`);
};

/**
 * 🔄 Barcha cache'ni tozalash
 */
const clearAllCache = async () => {
  // 🚩 Redis ishlayotganligini tekshirish - FALLBACK!
  if (!redisAvailable) {
    return;
  }
  
  try {
    const keys = await redisClient.keys('cache:*');
    if (keys.length > 0) {
      await redisClient.del(keys);
      console.log(`🗑️ Barcha cache lar tozalandi: ${keys.length} ta`);
    }
  } catch (err) {
    console.warn('⚠️ Barcha cache ni tozalash xatosi:', err.message);
  }
};

module.exports = {
  cacheMiddleware,
  invalidateCache,
  invalidateUserCache,
  clearAllCache,
  CACHE_TTL
};
