// models/StoreType.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const StoreTypeSchema = new mongoose.Schema({
  id:        { type: String, default: () => uuidv4(), unique: true },
  key:       { type: String, required: true, unique: true, lowercase: true, trim: true },
  label:     { type: String, required: true, trim: true, maxlength: 80 },
  desc:      { type: String, default: '', trim: true, maxlength: 200 },
  enabled:   { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },
}, { timestamps: true, versionKey: false });

StoreTypeSchema.index({ id: 1 });
StoreTypeSchema.index({ key: 1 }, { unique: true });
StoreTypeSchema.index({ enabled: 1, sortOrder: 1 });

module.exports = mongoose.model('StoreType', StoreTypeSchema);