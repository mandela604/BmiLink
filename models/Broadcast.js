const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const BroadcastSchema = new mongoose.Schema({
  id:             { type: String, default: () => uuidv4(), unique: true },
  storeId:        { type: String, required: true },
  recipientCount: { type: Number, default: 0 },
  messagePreview: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('Broadcast', BroadcastSchema);