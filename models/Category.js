// models/Category.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const CategorySchema = new mongoose.Schema({
  id:      { type: String, default: () => uuidv4(), unique: true },
  storeId: { type: String, required: true, ref: 'Store' },
  name:    { type: String, required: true, trim: true, maxlength: 80 },
  emoji:   { type: String, default: '📁', maxlength: 8 },
  sortOrder: { type: Number, default: 0 },
}, { timestamps: true, versionKey: false });

CategorySchema.index({ id: 1 });
CategorySchema.index({ storeId: 1, sortOrder: 1 });
// Prevent duplicate category names within the same store
CategorySchema.index({ storeId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Category', CategorySchema);