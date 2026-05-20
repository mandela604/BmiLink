const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const PromoBannerSchema = new mongoose.Schema({
  id:          { type: String, default: () => uuidv4(), unique: true },
  pushedBy:    { type: String, default: '' },
  ic:          { type: String, default: '🔥' },
  label:       { type: String, default: '' },
  title:       { type: String, required: true },
  sub:         { type: String, default: '' },
  cta:         { type: String, default: 'Shop now' },
  target:      { type: String, default: 'all' },
  location:    { type: String, default: 'store_page' },
  duration:    { type: String, default: '7d' },
  dismissable: { type: Boolean, default: true },
  status:      { type: String, enum: ['active','removed'], default: 'active' },
}, { timestamps: true });

module.exports = mongoose.model('PromoBanner', PromoBannerSchema);