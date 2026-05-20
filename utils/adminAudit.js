// utils/adminAudit.js
const AuditLog = require('../models/AuditLog');

async function logAction(admin, action, target, detail = '', ip = '') {
  try {
    await AuditLog.create({
      adminId:   admin?.id  || 'system',
      adminName: admin?.name || 'System',
      action,
      target,
      detail,
      ip,
    });
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

module.exports = { logAction };