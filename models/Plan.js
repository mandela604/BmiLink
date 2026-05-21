const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const PlanSchema = new mongoose.Schema({
  id:    { 
    type: String, 
    default: () => uuidv4(), 
    unique: true 
  },

  key: { 
    type: String, 
    required: true, 
    enum: ['free', 'pro', 'business'], 
    unique: true 
  },

  name:  { type: String, required: true },
  price: { type: Number, required: true, min: 0 },
  color: { type: String, default: '#9499a8' },
  desc:  { type: String, default: '' },

  limits: {
    stores:               { type: Number, default: 1 },
    products:             { type: Number, default: 10 },
    categories:           { type: Number, default: 5 },
    maxImagesPerProduct:  { type: Number, default: 2 },
    maxSpecsPerProduct:   { type: Number, default: 6 },
    maxOrderLogs:         { type: Number, default: 25 },
    maxContacts:          { type: Number, default: 25 },
    maxTeamMembers:       { type: Number, default: 0 },
  },

  canExportCSV:      { type: Boolean, default: false },
  canBroadcast:      { type: Boolean, default: false },
  canActivity:       { type: Boolean, default: false },
  canCartTracker:    { type: Boolean, default: false },
  canCreateStore:    { type: Boolean, default: false },
  canCustomDomain:   { type: Boolean, default: false },
  canPromoBanner:    { type: Boolean, default: false },
  canWAGroupCTA:     { type: Boolean, default: false },
  canTrackingPixels: { type: Boolean, default: false },

  allowedPixels: [{ type: String }],

  feats: [{ type: String }],
  no:    [{ type: String }],

}, { 
  timestamps: true,
  versionKey: false 
});

module.exports = mongoose.model('Plan', PlanSchema);