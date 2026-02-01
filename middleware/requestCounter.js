const jwt = require('jsonwebtoken');
const { io, requestCounts } = require('../socket');

module.exports = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const login = decoded.login;

      requestCounts[login] = (requestCounts[login] || 0) + 1;
      io.to('admin-room').emit('requestUpdate', requestCounts);
    } catch (err) {
      
    }
  }

  next();
};
