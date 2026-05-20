// models/PlatformSettings.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const FeatureFlagSchema = new mongoose.Schema({
  id:      { type: String, required: true },
  label:   { type: String, required: true },
  desc:    { type: String, default: '' },
  enabled: { type: Boolean, default: false },
}, { _id: false });

const VerificationRequirementsSchema = new mongoose.Schema({
  requireWA:        { type: Boolean, default: true },
  requireMinProducts: { type: Number, default: 3 },
  requireDescription: { type: Boolean, default: true },
  requireMinVisits:   { type: Number, default: 0 },  // 0 = not required
  requireManualReview: { type: Boolean, default: true },
}, { _id: false });

const PlatformSettingsSchema = new mongoose.Schema({
  id:        { type: String, default: () => uuidv4(), unique: true },
  singleton: { type: Boolean, default: true, unique: true }, // only one doc ever

  // ── Branding ────────────────────────────────────────────────
  platformName: { type: String, default: 'BMILink',     maxlength: 80 },
  // This is what makes yourstore.bmilink.com work
  // Admin sets this once; all store public URLs derive from it
  baseDomain:   { type: String, default: 'bmilink.com', maxlength: 120, trim: true, lowercase: true },
  logoUrl:      { type: String, default: null },
  faviconUrl:   { type: String, default: null },

  // ── Support ─────────────────────────────────────────────────
  supportEmail: { type: String, default: null, trim: true },
  supportWA:    { type: String, default: null, trim: true },  // digits only

  // ── Registration & Auth ──────────────────────────────────────
  allowRegistrations: { type: Boolean, default: true },
  requireEmailVerify: { type: Boolean, default: false },
  trialDays:          { type: Number,  default: 90, min: 0 },

  // ── Maintenance ──────────────────────────────────────────────
  maintenanceMode:    { type: Boolean, default: false },
  maintenanceMessage: { type: String,  default: "We're upgrading. Back soon!", maxlength: 500 },

  // ── Plan Pricing (NGN) ───────────────────────────────────────
  proPriceNGN:      { type: Number, default: 5000,  min: 0 },
  businessPriceNGN: { type: Number, default: 12000, min: 0 },

  // ── Plan Limits ──────────────────────────────────────────────
  freePlanMaxProducts:  { type: Number, default: 15 },
  proPlanMaxProducts:   { type: Number, default: 50 },
  freePlanMaxContacts:  { type: Number, default: 25 },
  proPlanMaxContacts:   { type: Number, default: 150 },

  // ── Feature Flags ────────────────────────────────────────────
  featureFlags: { type: [FeatureFlagSchema], default: [] },

  // ── Verification ─────────────────────────────────────────────
  verificationRequirements: {
    type: VerificationRequirementsSchema,
    default: () => ({}),
  },

  // ── Default Templates ────────────────────────────────────────
  defaultOrderMsg: {
    type: String,
    default: "Hello! I'd like to order:\n\n📦 *[Product Name]*\n💰 Price: [Price]\n\nPlease confirm availability. Thank you! 🙏",
    maxlength: 2000,
  },

}, { timestamps: true, versionKey: false });

PlatformSettingsSchema.index({ singleton: 1 }, { unique: true });
PlatformSettingsSchema.index({ id: 1 });

module.exports = mongoose.model('PlatformSettings', PlatformSettingsSchema);