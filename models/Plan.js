const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const PlanSchema = new mongoose.Schema({
  id:    { type: String, default: () => uuidv4(), unique: true },
  name:  { type: String, required: true },   // 'Free', 'Pro', 'Business'
  price: { type: Number, default: 0 },
  color: { type: String, default: '#9499a8' },
  desc:  { type: String, default: '' },
  limits: {
    stores:     { type: Number, default: 1 },
    products:   { type: Number, default: 10 },
    categories: { type: Number, default: 5 },
  },
  feats: [{ type: String }],
  no:    [{ type: String }],
}, { timestamps: true });

module.exports = mongoose.model('Plan', PlanSchema);