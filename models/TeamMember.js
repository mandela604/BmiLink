const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const TeamMemberSchema = new mongoose.Schema({
  id: { type: String, default: () => uuidv4(), required: true, unique: true },
  storeId: { type: String, required: true, ref: 'Store' },
  ownerId: { type: String, required: true, ref: 'User' },
  name: { type: String, required: true, trim: true },
  wa: { type: String, required: true, trim: true },
  passHash: { type: String, required: true },
  role: { type: String, enum: ['full', 'limited'], default: 'limited' },
  assignedStoreId: { type: String, default: null, ref: 'Store' },
}, { timestamps: true });

TeamMemberSchema.index({ id: 1 });

module.exports = mongoose.model('TeamMember', TeamMemberSchema);