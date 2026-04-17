'use strict';

const redisClient = {
  connect: async () => {},
  on: () => {},
  get: async () => null,
  set: async () => {},
  del: async () => {},
  keys: async () => [],
  quit: async () => {}
};

console.log('✅ Redis ulanishi (emulyatsiya) tayyor');

module.exports = redisClient;
