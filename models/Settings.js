
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const SettingsSchema = new mongoose.Schema({
  id:      { type: String, default: () => uuidv4(), unique: true },
  storeId: { type: String, required: true, unique: true, ref: 'Store' },

  storeName:   { type: String, default: '', trim: true, maxlength: 100 },
  storeEmoji:  { type: String, default: '🛍️', maxlength: 8 },
  heroTitle:   { type: String, default: '', trim: true, maxlength: 200 },
  heroSub:     { type: String, default: '', trim: true, maxlength: 500 },
  description: { type: String, default: '', trim: true, maxlength: 1000 },
  waNumber:    { type: String, default: '', trim: true, maxlength: 20 },
  city:        { type: String, default: '', trim: true, maxlength: 80 },
  orderMsg:    { type: String, default: '', maxlength: 1000 },

  promo: {
    visible:       { type: Boolean, default: false },
    ic:            { type: String, default: '🔥', maxlength: 8 },
    label:         { type: String, default: 'Limited Offer', maxlength: 60 },
    title:         { type: String, default: '', maxlength: 120 },
    sub:           { type: String, default: '', maxlength: 200 },
    cta:           { type: String, default: 'Shop now', maxlength: 40 },
    filterOnClick: { type: Number, default: null },
  },

  waGroup: {
    visible:  { type: Boolean, default: false },
    link:     { type: String, default: '' },
    title:    { type: String, default: '', maxlength: 100 },
    sub:      { type: String, default: '', maxlength: 200 },
    count:    { type: String, default: '', maxlength: 60 },
    btnLabel: { type: String, default: 'Join Group', maxlength: 40 },
  },

  metaPixId:   { type: String, default: '', trim: true },
  tiktokPixId: { type: String, default: '', trim: true },
  gaId:        { type: String, default: '', trim: true },

  // Custom domain lives on Store, not here — only one source of truth
  prefPrices:  { type: Boolean, default: true },
  prefCart:    { type: Boolean, default: true },
  prefSoldout: { type: Boolean, default: true },
  prefLive:    { type: Boolean, default: false },
  domain:      { type: String, default: '', trim: true, lowercase: true, maxlength: 200 },

}, { timestamps: true, versionKey: false });

SettingsSchema.index({ id: 1 });
SettingsSchema.index({ storeId: 1 }, { unique: true });

module.exports = mongoose.model('Settings', SettingsSchema);