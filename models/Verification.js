const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const VerificationSchema = new mongoose.Schema({
  id:        { type: String, default: () => uuidv4(), unique: true },
  storeId:   { type: String, required: true },
  storeName: { type: String, default: '' },
  storeEmoji:{ type: String, default: '🏪' },
  ownerName: { type: String, default: '' },
  ownerEmail:{ type: String, default: '' },
  wa:        { type: String, default: '' },
  products:  { type: Number, default: 0 },
  visits:    { type: Number, default: 0 },
  desc:      { type: String, default: '' },
  status:    { type: String, enum: ['pending','approved','rejected'], default: 'pending' },
  reason:    { type: String, default: '' },      // rejection reason
  reviewedBy:{ type: String, default: null },
  reviewedAt:{ type: Date, default: null },
}, { timestamps: true });

VerificationSchema.index({ status: 1 });
module.exports = mongoose.model('Verification', VerificationSchema);