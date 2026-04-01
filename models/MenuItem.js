const mongoose = require('mongoose');

const menuItemSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  category: {
    type: String,
    required: true
  },
  emoji: {
    type: String
  },
  image: {
    type: String // URL
  },
  tags: {
    type: [String],
    default: []
  },
  isVeg: {
    type: Boolean,
    default: false
  },
  isAvailable: {
    type: Boolean,
    default: true
  },
  preparationTime: {
    type: Number,
    default: 15,
    min: 1 // minutes
  },
  calories: {
    type: Number
  },
  allergens: {
    type: [String],
    default: []
  },
  aiScore: {
    type: Number,
    min: 0,
    max: 100 // computed, clamped to [0, 100]
  },
  stats: {
    totalOrdered: { type: Number, default: 0 },
    totalRevenue: { type: Number, default: 0 },
    avgRating: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 }
  },
  sortOrder: {
    type: Number // manual override for display order
  }
});

menuItemSchema.index({ aiScore: -1 });

module.exports = mongoose.model('MenuItem', menuItemSchema);
