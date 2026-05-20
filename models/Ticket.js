const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const TicketSchema = new mongoose.Schema({
  id:       { type: String, default: () => uuidv4(), unique: true },
  userId:   { type: String, required: true },
  userName: { type: String, default: '' },
  userEmail:{ type: String, default: '' },
  subject:  { type: String, required: true },
  body:     { type: String, required: true },
  reply:    { type: String, default: '' },
  status:   { type: String, enum: ['open','escalated','resolved'], default: 'open' },
  priority: { type: String, enum: ['normal','high','urgent'], default: 'normal' },
  category: { type: String, default: 'General' },
}, { timestamps: true });

TicketSchema.index({ status: 1, createdAt: -1 });
module.exports = mongoose.model('Ticket', TicketSchema);