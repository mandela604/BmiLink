// models/Product.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const SpecSchema = new mongoose.Schema({
  k: { type: String, trim: true, maxlength: 80 },
  v: { type: String, trim: true, maxlength: 200 },
}, { _id: false });

const ProductSchema = new mongoose.Schema({
  id:      { type: String, default: () => uuidv4(), unique: true },
  storeId: { type: String, required: true, ref: 'Store' },
  ownerId: { type: String, required: true, ref: 'User' },
  catId:   { type: String, default: null, ref: 'Category' },

  name:  { type: String, required: true, trim: true, maxlength: 200 },
  emoji: { type: String, default: '📦', maxlength: 8 },

  // Max 5 image URLs (enforced in service layer)
  images: { type: [String], default: [], validate: [v => v.length <= 5, 'Max 5 images'] },

  price:         { type: Number, required: true, min: 0 },
  originalPrice: { type: Number, default: null, min: 0 },

  desc:  { type: String, default: '', trim: true, maxlength: 2000 },
  promo: { type: String, default: null, trim: true, maxlength: 300 },

  status: { type: String, enum: ['active', 'soldout', 'hidden'], default: 'active' },
  isNew:  { type: Boolean, default: false },
  isHot:  { type: Boolean, default: false },
  stock:  { type: Number, default: 0, min: 0 },

  specs: { type: [SpecSchema], default: [] },

  // Click counter — incremented on store page tap, never decremented
  clicks: { type: Number, default: 0, min: 0 },

}, { timestamps: true, versionKey: false });

ProductSchema.index({ id: 1 });
ProductSchema.index({ storeId: 1, status: 1, createdAt: -1 });
ProductSchema.index({ storeId: 1, catId: 1, status: 1 });
ProductSchema.index({ storeId: 1, isHot: 1 });
ProductSchema.index({ storeId: 1, clicks: -1 });   // top products by taps

module.exports = mongoose.model('Product', ProductSchema);