// models/Store.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const PromoSchema = new mongoose.Schema({
  visible:       { type: Boolean, default: false },
  ic:            { type: String,  default: '🔥', maxlength: 8 },
  label:         { type: String,  default: 'Limited Offer', trim: true, maxlength: 60 },
  title:         { type: String,  default: '', trim: true, maxlength: 120 },
  sub:           { type: String,  default: '', trim: true, maxlength: 200 },
  cta:           { type: String,  default: 'Shop now', trim: true, maxlength: 40 },
  filterOnClick: { type: Number,  default: null },
}, { _id: false });

const WAGroupSchema = new mongoose.Schema({
  visible:  { type: Boolean, default: false },
  link:     { type: String,  default: '', trim: true },
  title:    { type: String,  default: '', trim: true, maxlength: 100 },
  sub:      { type: String,  default: '', trim: true, maxlength: 200 },
  count:    { type: String,  default: '', maxlength: 60 },
  btnLabel: { type: String,  default: 'Join Group', trim: true, maxlength: 40 },
}, { _id: false });

const PixelsSchema = new mongoose.Schema({
  metaPixId:   { type: String, default: '', trim: true },
  tiktokPixId: { type: String, default: '', trim: true },
  gaId:        { type: String, default: '', trim: true },
}, { _id: false });

const PreferencesSchema = new mongoose.Schema({
  showPrices:  { type: Boolean, default: true },
  enableCart:  { type: Boolean, default: true },
  showSoldout: { type: Boolean, default: true },
  isLive:      { type: Boolean, default: false },
}, { _id: false });

const StoreSchema = new mongoose.Schema({
  id:      { type: String, default: () => uuidv4(), unique: true },
  ownerId: { type: String, required: true, ref: 'User' },

  // ── Identity ────────────────────────────────────────────────
  name:  { type: String, required: true, trim: true, maxlength: 100 },
  emoji: { type: String, default: '🛍️', maxlength: 8 },

  // Subdomain slug — powers yourstore.bmilink.com
  // Must be lowercase alphanumeric + hyphens only, 3–50 chars
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    minlength: 3,
    maxlength: 50,
    match: [/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, numbers and hyphens'],
  },

  type: {
    type: String,
    required: true,
    // Validated against StoreType.key at the service layer, not hardcoded here
    // so admin can add new types without a schema change
    trim: true,
    lowercase: true,
    default: 'ecommerce',
  },

  // ── Store page content ───────────────────────────────────────
  heroTitle:   { type: String, default: '', trim: true, maxlength: 200 },
  heroSub:     { type: String, default: '', trim: true, maxlength: 500 },
  description: { type: String, default: '', trim: true, maxlength: 1000 },

  // ── Contact ─────────────────────────────────────────────────
  waNumber: { type: String, default: '', trim: true, maxlength: 20 },
  city:     { type: String, default: '', trim: true, maxlength: 80 },
  orderMsg: { type: String, default: '', maxlength: 1000 },

  // ── Custom domain (Pro/Business) ─────────────────────────────
  // e.g. "shop.mybrand.com" — set after DNS is verified
  customDomain:       { type: String, default: '', trim: true, lowercase: true, maxlength: 200 },
  customDomainActive: { type: Boolean, default: false },

  // ── Plan (denormalised for fast reads on every store-page request) ──
  // Updated whenever the owner's plan changes
  plan:         { type: String, enum: ['free', 'pro', 'business'], default: 'free' },
  planOverride: { type: String, enum: ['free', 'pro', 'business', ''], default: '' },
  planExpiry:   { type: Date, default: null },

  // ── Status & Verification ───────────────────────────────────
  status:     { type: String, enum: ['live', 'suspended', 'draft'], default: 'draft' },
  isVerified: { type: Boolean, default: false },
  verifiedAt: { type: Date, default: null },

  // ── Features (all nested — one document read serves the whole store page) ─
  promo:       { type: PromoSchema,       default: () => ({}) },
  waGroup:     { type: WAGroupSchema,     default: () => ({}) },
  pixels:      { type: PixelsSchema,      default: () => ({}) },
  preferences: { type: PreferencesSchema, default: () => ({}) },

  // ── Lightweight counters (heavy analytics live in a separate collection) ──
  totalVisits: { type: Number, default: 0, min: 0 },
  totalOrders: { type: Number, default: 0, min: 0 },

}, { timestamps: true, versionKey: false });

// ── Indexes ─────────────────────────────────────────────────────────────────
StoreSchema.index({ id: 1 });
StoreSchema.index({ slug: 1 }, { unique: true });           // subdomain lookup
StoreSchema.index({ customDomain: 1 }, { sparse: true });   // custom domain lookup
StoreSchema.index({ ownerId: 1, status: 1 });
StoreSchema.index({ status: 1, isVerified: 1 });
StoreSchema.index({ plan: 1, status: 1 });

// ── Auto-generate slug from name on first save ───────────────────────────────
StoreSchema.pre('validate', function (next) {
  if (this.isNew && !this.slug && this.name) {
    this.slug = this.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')   // strip special chars
      .replace(/\s+/g, '-')            // spaces → hyphens
      .replace(/-{2,}/g, '-')          // collapse double hyphens
      .replace(/^-|-$/g, '')           // trim leading/trailing hyphens
      .slice(0, 50);
  }
  next();
});

// ── Virtual: effective plan (override beats subscription) ────────────────────
StoreSchema.virtual('effectivePlan').get(function () {
  return this.planOverride || this.plan;
});

// ── Virtual: public URL (used by API responses) ───────────────────────────────
// Call with a baseDomain string from PlatformSettings
StoreSchema.methods.publicUrl = function (baseDomain = 'bmilink.com') {
  if (this.customDomainActive && this.customDomain) {
    return `https://${this.customDomain}`;
  }
  return `https://${this.slug}.${baseDomain}`;
};

module.exports = mongoose.model('Store', StoreSchema);