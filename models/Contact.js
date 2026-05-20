// models/Contact.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const ContactSchema = new mongoose.Schema({
  id:      { type: String, default: () => uuidv4(), unique: true },
  storeId: { type: String, required: true, ref: 'Store' },
  name:    { type: String, default: 'Customer', trim: true, maxlength: 100 },
  wa:      { type: String, required: true, trim: true, maxlength: 20 },
  tags:    { type: [String], default: [] },
}, { timestamps: true, versionKey: false });

ContactSchema.index({ id: 1 });
ContactSchema.index({ storeId: 1, wa: 1 }, { unique: true }); // no duplicate WA per store
ContactSchema.index({ storeId: 1, tags: 1 });                 // broadcast tag filter

module.exports = mongoose.model('Contact', ContactSchema);