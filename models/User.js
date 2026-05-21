// models/User.js
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const UserSchema = new mongoose.Schema({
  // UUID primary key
  id: {
    type: String,
    default: () => uuidv4(),
  },

  name:     { type: String, required: true, trim: true, maxlength: 100 },
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 6 },
  waNumber: { type: String, default: '' },
  city:     { type: String, default: '' },

  // Plan: free | pro | business
  plan:     { type: String, enum: ['free', 'pro', 'business'], default: 'free' },

  // Billing
  planExpiresAt: { type: Date, default: null },
  planRenewsAt:  { type: Date, default: null },

  // Account status
  status:   { type: String, enum: ['active', 'suspended', 'banned'], default: 'active' },
  role:     { type: String, enum: ['seller', 'admin'], default: 'seller' },

  // Initials for avatar (auto-computed)
  initials: { type: String, default: 'SL' },

  // Active store (UUID ref)
  activeStoreId:   { type: String, default: null },
pendingPlan:     { type: String, default: null },
lastPaystackRef: { type: String, default: null },

}, { timestamps: true, versionKey: false,  _id: false });

// Hash password before save
// Hash password before save
UserSchema.pre('save', async function(next) {
  try {
    if (!this.isModified('password')) return next();
    this.password = await bcrypt.hash(this.password, 12);
    // Compute initials
    this.initials = this.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password
UserSchema.methods.comparePassword = async function(candidate) {
  return bcrypt.compare(candidate, this.password);
};

// Strip password from JSON
UserSchema.methods.toSafeJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model('User', UserSchema);