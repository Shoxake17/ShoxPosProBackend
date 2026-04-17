'use strict';

const CACHE_TTL = {
  SHORT: 30000,
  MEDIUM: 180000,
  LONG: 600000
};

const cacheMiddleware = (ttl) => (req, res, next) => {
  next();
};

const invalidateCache = async (pattern) => {};
const invalidateUserCache = async (login) => {};

module.exports = {
  cacheMiddleware,
  invalidateCache,
  invalidateUserCache,
  CACHE_TTL
};
