const mongoose = require('mongoose');

const tableSchema = new mongoose.Schema({
  tableNumber: {
    type: Number,
    required: true,
    unique: true
  },
  capacity: {
    type: Number,
    required: true,
    min: 1
  },
  status: {
    type: String,
    enum: ['available', 'occupied', 'reserved', 'cleaning'],
    default: 'available'
  },
  currentSessionId: {
    type: String // UUID, rotated on table clear
  },
  qrCode: {
    type: String // base64 data URL or file path
  },
  location: {
    type: String // e.g. "indoor", "outdoor", "terrace"
  },
  activeOrderCount: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

module.exports = mongoose.model('Table', tableSchema);
