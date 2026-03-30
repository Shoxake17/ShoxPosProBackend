const { cleanEnv, str, num, bool } = require('envalid');

const env = cleanEnv(process.env, {
  JWT_SECRET:        str(),
  JWT_REFRESH_SECRET:str(),
  JWT_EXPIRES_IN:    str({ default: '15m' }),
  JWT_REFRESH_EXPIRES_IN: str({ default: '7d' }),
  JWT_ALGORITHM:     str({ choices: ['HS256', 'RS256'] }),
  PORT:              num({ default: 3000 }), 
  ADMIN_DEVICE_ID:   str(),
  MONGO_URI:         str(),
  LOG_LEVEL:         str({ choices: ['info', 'debug', 'warn', 'error'], default: 'info' }),
  AUDIT_ENABLED:     bool({ default: true }),
  SOCKET_IO_ENABLED: bool({ default: false }),
  SOCKET_IO_PORT:    num({ default: 3000 }),
  NODE_ENV:          str({ choices: ['development', 'production', 'test'], default: 'development' }),
});

module.exports = env;
