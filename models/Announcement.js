const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const AnnouncementSchema = new mongoose.Schema({
  id:         { type: String, default: () => uuidv4(), unique: true },
  title:      { type: String, required: true },
  msg:        { type: String, required: true },
  type:       { type: String, default: 'info' },
  target:     { type: String, default: 'all' },
  sendWA:     { type: Boolean, default: false },
  showBanner: { type: Boolean, default: true },
  reach:      { type: Number, default: 0 },
  sentBy:     { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('Announcement', AnnouncementSchema);