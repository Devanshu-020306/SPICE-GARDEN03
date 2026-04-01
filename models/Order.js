const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  menuItem: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MenuItem'
  },
  name: {
    type: String // snapshot at order time
  },
  price: {
    type: Number // snapshot at order time
  },
  quantity: {
    type: Number,
    min: 1
  },
  specialNote: {
    type: String
  }
}, { _id: false });

const statusHistorySchema = new mongoose.Schema({
  status: {
    type: String
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderId: {
    type: String // human-readable, e.g. "ORD-20240115-0042"
  },
  tableNumber: {
    type: Number,
    required: true
  },
  sessionId: {
    type: String // UUID, ties order to table session
  },
  items: {
    type: [orderItemSchema]
  },
  specialInstructions: {
    type: String
  },
  subtotal: {
    type: Number
  },
  gst: {
    type: Number
  },
  total: {
    type: Number
  },
  status: {
    type: String,
    enum: ['pending', 'preparing', 'ready', 'served', 'cancelled'],
    default: 'pending'
  },
  priority: {
    type: String,
    enum: ['normal', 'high', 'urgent'],
    default: 'normal'
  },
  statusHistory: {
    type: [statusHistorySchema],
    default: []
  },
  estimatedReadyAt: {
    type: Date
  },
  servedAt: {
    type: Date
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'card', 'upi', 'razorpay']
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'refunded'],
    default: 'pending'
  },
  paymentRef: {
    type: String // Razorpay order/payment ID
  },
  rating: {
    type: Number,
    min: 1,
    max: 5
  },
  ratingComment: {
    type: String
  }
}, { timestamps: true });

orderSchema.index({ tableNumber: 1, status: 1 });
orderSchema.index({ sessionId: 1 });
orderSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
