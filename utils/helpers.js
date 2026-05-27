// utils/helpers.js
const crypto = require('crypto');

const hashIP = (ip) => {
  if (!ip) return null;
  
  try {
    return crypto.createHash('sha256')
      .update(ip + (process.env.IP_SALT || 'storelink'))
      .digest('hex')
      .slice(0, 16);
  } catch (e) {
    console.error('hashIP failed:', e);
    return null;
  }
};

module.exports = {
  hashIP
};