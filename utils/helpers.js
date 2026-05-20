const crypto = require('crypto');

const hashIP = (ip) => {
  return crypto.createHash('sha256')
    .update(ip + (process.env.IP_SALT || 'storelink'))
    .digest('hex')
    .slice(0, 16);
};