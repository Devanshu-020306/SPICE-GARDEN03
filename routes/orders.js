'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, param, query, validationResult } = require('express-validator');

const Order = require('../models/Order');
const Table = require('../models/Table');
const MenuItem = require('../models/MenuItem');
const { protect, authorize } = require('../middleware/authMiddleware');
const { computeEstimatedReadyAt, validateStatusTransition } = require('../utils/orderUtils');

const router = express.Router();

// ── Rate limiter: 10 orders per session per 15 minutes ────────────────────────
const orderRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.body.sessionId || req.ip,
  message: { error: 'Too many orders placed. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Validation helpers ────────────────────────────────────────────────────────
function sendValidationErrors(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ errors: errors.array() });
  }
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function generateOrderId() {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const counter = String(Date.now()).slice(-4).padStart(4, '0');
  return `ORD-${datePart}-${counter}`;
}

// ── 8.1  POST /api/orders — place order (no auth, session-based) ──────────────
router.post(
  '/',
  orderRateLimiter,
  [
    body('tableNumber').isInt({ min: 1 }).withMessage('tableNumber must be a positive integer'),
    body('sessionId').isString().notEmpty().withMessage('sessionId is required'),
    body('items').isArray({ min: 1 }).withMessage('items must be a non-empty array'),
    body('items.*.menuItemId').notEmpty().withMessage('each item must have a menuItemId'),
    body('items.*.quantity').isInt({ min: 1 }).withMessage('each item quantity must be >= 1'),
  ],
  async (req, res, next) => {
    try {
      const validationErr = sendValidationErrors(req, res);
      if (validationErr !== null) return;

      const { tableNumber, sessionId, items, specialInstructions, paymentMethod } = req.body;

      // Validate session
      const table = await Table.findOne({ tableNumber });
      if (!table) {
        return res.status(404).json({ error: 'Table not found.' });
      }
      if (table.currentSessionId !== sessionId) {
        return res.status(403).json({ error: 'Session expired. Please scan the QR code again.' });
      }

      // Validate menu items
      const unavailableItems = [];
      const resolvedItems = [];

      for (const item of items) {
        const menuItem = await MenuItem.findById(item.menuItemId);
        if (!menuItem || !menuItem.isAvailable) {
          unavailableItems.push(item.menuItemId);
        } else {
          resolvedItems.push({
            menuItem: menuItem._id,
            name: menuItem.name,       // snapshot
            price: menuItem.price,     // snapshot
            quantity: item.quantity,
            specialNote: item.specialNote || undefined,
          });
        }
      }

      if (unavailableItems.length > 0) {
        return res.status(422).json({
          error: 'One or more items are currently unavailable.',
          unavailableItems,
        });
      }

      // Compute financials
      const subtotal = resolvedItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
      const gst = parseFloat((subtotal * 0.05).toFixed(2));
      const total = parseFloat((subtotal + gst).toFixed(2));

      // Build order document (without estimatedReadyAt yet so we can pass it to the util)
      const orderId = generateOrderId();
      const newOrder = new Order({
        orderId,
        tableNumber,
        sessionId,
        items: resolvedItems,
        specialInstructions: specialInstructions || undefined,
        paymentMethod: paymentMethod || undefined,
        subtotal,
        gst,
        total,
        status: 'pending',
        statusHistory: [{ status: 'pending', timestamp: new Date(), updatedBy: null }],
      });

      // Compute ETA
      const estimatedReadyAt = await computeEstimatedReadyAt(newOrder);
      newOrder.estimatedReadyAt = estimatedReadyAt;

      await newOrder.save();

      // Increment table active order count
      await Table.findOneAndUpdate({ tableNumber }, { $inc: { activeOrderCount: 1 } });

      // Emit Socket.io events
      const io = req.app.get('io');
      if (io) {
        io.to('kitchen').emit('kitchen:new-order', newOrder.toObject());
        io.to('admin').emit('order:new', newOrder.toObject());
      }

      return res.status(201).json({ orderId, _id: newOrder._id, estimatedReadyAt, total });
    } catch (err) {
      next(err);
    }
  }
);

// ── 8.3  PATCH /api/orders/:id/status — update order status ──────────────────
router.patch(
  '/:id/status',
  protect,
  authorize('kitchen', 'admin'),
  [
    param('id').notEmpty().withMessage('Order id is required'),
    body('status')
      .isIn(['pending', 'preparing', 'ready', 'served', 'cancelled'])
      .withMessage('Invalid status value'),
  ],
  async (req, res, next) => {
    try {
      const validationErr = sendValidationErrors(req, res);
      if (validationErr !== null) return;

      const order = await Order.findById(req.params.id);
      if (!order) {
        return res.status(404).json({ error: 'Order not found.' });
      }

      const newStatus = req.body.status;
      if (!validateStatusTransition(order.status, newStatus)) {
        return res.status(422).json({
          error: `Cannot transition from '${order.status}' to '${newStatus}'.`,
        });
      }

      // Append to status history
      order.statusHistory.push({
        status: newStatus,
        timestamp: new Date(),
        updatedBy: req.user._id,
      });

      order.status = newStatus;

      // Handle terminal states
      if (newStatus === 'served') {
        order.servedAt = new Date();
        await Table.findOneAndUpdate(
          { tableNumber: order.tableNumber },
          { $inc: { activeOrderCount: -1 } }
        );
      } else if (newStatus === 'cancelled') {
        await Table.findOneAndUpdate(
          { tableNumber: order.tableNumber },
          { $inc: { activeOrderCount: -1 } }
        );
      }

      await order.save();

      // Emit Socket.io events
      const io = req.app.get('io');
      if (io) {
        const payload = order.toObject();
        io.to('admin').emit('order:status-changed', payload);
        io.to(`session:${order.sessionId}`).emit('order:your-status-changed', payload);
        io.to('kitchen').emit('kitchen:order-updated', payload);
      }

      return res.status(200).json(order);
    } catch (err) {
      next(err);
    }
  }
);

// ── 8.5  GET /api/orders — all orders (kitchen/admin, optional filters) ───────
router.get(
  '/',
  protect,
  authorize('kitchen', 'admin'),
  [
    query('tableNumber').optional().isInt({ min: 1 }),
    query('status')
      .optional()
      .isIn(['pending', 'preparing', 'ready', 'served', 'cancelled']),
  ],
  async (req, res, next) => {
    try {
      const filter = {};
      if (req.query.tableNumber) filter.tableNumber = parseInt(req.query.tableNumber, 10);
      if (req.query.status) filter.status = req.query.status;

      const orders = await Order.find(filter).sort({ createdAt: -1 });
      return res.status(200).json(orders);
    } catch (err) {
      next(err);
    }
  }
);

// ── 8.5  GET /api/orders/active — pending + preparing orders ─────────────────
router.get(
  '/active',
  protect,
  authorize('kitchen', 'admin'),
  async (req, res, next) => {
    try {
      const orders = await Order.find({ status: { $in: ['pending', 'preparing'] } }).sort({
        createdAt: 1,
      });
      return res.status(200).json(orders);
    } catch (err) {
      next(err);
    }
  }
);

// ── 8.5  GET /api/orders/table/:num — orders for a specific table ─────────────
router.get(
  '/table/:num',
  protect,
  authorize('kitchen', 'admin'),
  [param('num').isInt({ min: 1 }).withMessage('tableNumber must be a positive integer')],
  async (req, res, next) => {
    try {
      const validationErr = sendValidationErrors(req, res);
      if (validationErr !== null) return;

      const orders = await Order.find({ tableNumber: parseInt(req.params.num, 10) }).sort({
        createdAt: -1,
      });
      return res.status(200).json(orders);
    } catch (err) {
      next(err);
    }
  }
);

// ── 8.5  GET /api/orders/:id — single order detail (no auth) ─────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const idParam = req.params.id;
    // Support both MongoDB _id and human-readable orderId (e.g. ORD-20240101-1234)
    let order;
    if (idParam.startsWith('ORD-')) {
      order = await Order.findOne({ orderId: idParam }).select(
        'orderId status statusHistory estimatedReadyAt tableNumber sessionId items subtotal gst total createdAt servedAt'
      );
    } else {
      order = await Order.findById(idParam).select(
        'orderId status statusHistory estimatedReadyAt tableNumber sessionId items subtotal gst total createdAt servedAt'
      );
    }
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }
    return res.status(200).json(order);
  } catch (err) {
    next(err);
  }
});

// ── 8.5  POST /api/orders/:id/rating — rate a served order (no auth) ─────────
router.post(
  '/:id/rating',
  [
    param('id').notEmpty().withMessage('Order id is required'),
    body('rating').isInt({ min: 1, max: 5 }).withMessage('rating must be an integer between 1 and 5'),
    body('ratingComment').optional().isString(),
  ],
  async (req, res, next) => {
    try {
      const validationErr = sendValidationErrors(req, res);
      if (validationErr !== null) return;

      const order = await Order.findById(req.params.id);
      if (!order) {
        return res.status(404).json({ error: 'Order not found.' });
      }
      if (order.status !== 'served') {
        return res.status(422).json({ error: 'Ratings can only be submitted for served orders.' });
      }

      order.rating = req.body.rating;
      if (req.body.ratingComment !== undefined) {
        order.ratingComment = req.body.ratingComment;
      }
      await order.save();

      return res.status(200).json({ message: 'Rating submitted successfully.' });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
