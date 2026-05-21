// models/Admin.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const AdminSchema = new mongoose.Schema({
  id:        { type: String, default: () => uuidv4(), unique: true },
  name:      { type: String, required: true, trim: true, maxlength: 100 },
  email:     { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:  { type: String, required: true, minlength: 8, select: false },
  role:      { type: String, enum: ['super_admin', 'admin', 'moderator', 'editor'], default: 'admin' },
  status:    { type: String, enum: ['active', 'suspended'], default: 'active' },
  lastLogin: { type: Date, default: null },
}, { timestamps: true, versionKey: false });


AdminSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

AdminSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

// Never return password in JSON responses
AdminSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model('Admin', AdminSchema);