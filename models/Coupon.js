// models/Coupon.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const CouponSchema = new mongoose.Schema({
  id:   { type: String, default: () => uuidv4(), unique: true },
  code: {
    type: String, required: true, unique: true,
    uppercase: true, trim: true, maxlength: 30,
  },
  type:  { type: String, enum: ['percent', 'fixed', 'months'], default: 'percent' },
  value: { type: Number, required: true, min: 1 },

  // Which plan this coupon can be applied to
  plan:     { type: String, enum: ['all', 'free', 'pro', 'business', 'pro,business'], default: 'all' },
  // Which users (by current plan) can redeem
  eligible: { type: String, enum: ['all', 'free', 'pro', 'new'], default: 'all' },

  maxUses: { type: Number, default: null, min: 1 },  // null = unlimited
  used:    { type: Number, default: 0, min: 0 },
  perUser: { type: String, enum: ['1', '3', 'unlimited'], default: '1' },

  start:  { type: Date, default: null },
  expiry: { type: Date, default: null },

  desc:      { type: String, default: '', trim: true, maxlength: 200 },
  active:    { type: Boolean, default: true },
  firstTime: { type: Boolean, default: false },  // reject if user has any prior sub

  createdBy: { type: String, ref: 'Admin', default: null },

}, { timestamps: true, versionKey: false });

CouponSchema.index({ id: 1 });
CouponSchema.index({ code: 1 }, { unique: true });
CouponSchema.index({ active: 1, expiry: 1 });

module.exports = mongoose.model('Coupon', CouponSchema);