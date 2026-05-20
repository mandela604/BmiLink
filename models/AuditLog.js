const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const AuditLogSchema = new mongoose.Schema({
  id:        { type: String, default: () => uuidv4(), unique: true },
  adminId:   { type: String, default: 'system' },
  adminName: { type: String, default: 'System' },
  action:    { type: String, required: true },
  target:    { type: String, default: '' },
  detail:    { type: String, default: '' },
  ip:        { type: String, default: '' },
}, { timestamps: true });

AuditLogSchema.index({ createdAt: -1 });
module.exports = mongoose.model('AuditLog', AuditLogSchema);