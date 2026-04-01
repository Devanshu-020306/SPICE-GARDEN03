'use strict';

const jwt = require('jsonwebtoken');
const Order = require('../models/Order');
const Table = require('../models/Table');
const { validateStatusTransition } = require('../utils/orderUtils');

/**
 * Verifies a JWT token and returns the decoded payload.
 * Returns null if the token is invalid or missing.
 *
 * @param {string} token
 * @returns {object|null} decoded payload or null
 */
function verifyToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

/**
 * Initializes all Socket.io event handlers.
 * Called once at server startup with the io instance.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 10.3, 10.4
 *
 * @param {import('socket.io').Server} io
 */
function initializeSocket(io) {
  io.on('connection', (socket) => {
    // ── join:session ─────────────────────────────────────────────────────────
    // No authentication required — admit any socket with a sessionId
    // Requirement: 8.1
    socket.on('join:session', ({ sessionId, tableNumber } = {}) => {
      if (!sessionId) return;
      socket.join(`session:${sessionId}`);
    });

    // ── join:kitchen ─────────────────────────────────────────────────────────
    // Verify JWT; role must be 'kitchen' or 'admin'
    // Requirement: 8.2, 8.4
    socket.on('join:kitchen', ({ token } = {}) => {
      const decoded = verifyToken(token);
      if (!decoded || !['kitchen', 'admin'].includes(decoded.role)) {
        socket.emit('auth:error', { message: 'Authentication failed.' });
        socket.disconnect();
        return;
      }
      socket.join('kitchen');
    });

    // ── join:admin ────────────────────────────────────────────────────────────
    // Verify JWT; role must be 'admin'
    // Requirement: 8.3, 8.4
    socket.on('join:admin', ({ token } = {}) => {
      const decoded = verifyToken(token);
      if (!decoded || decoded.role !== 'admin') {
        socket.emit('auth:error', { message: 'Authentication failed.' });
        socket.disconnect();
        return;
      }
      socket.join('admin');
    });

    // ── kitchen:update-status ─────────────────────────────────────────────────
    // Delegate to order update logic; emit status-changed events
    // Requirement: 8.6, 7.1–7.6
    socket.on('kitchen:update-status', async ({ orderId, status } = {}) => {
      if (!socket.rooms.has('kitchen')) return;

      try {
        const order = await Order.findById(orderId);
        if (!order) return;

        if (!validateStatusTransition(order.status, status)) return;

        order.status = status;
        order.statusHistory.push({ status, timestamp: new Date(), updatedBy: null });

        if (status === 'served') {
          order.servedAt = new Date();
          await Table.findOneAndUpdate(
            { tableNumber: order.tableNumber },
            { $inc: { activeOrderCount: -1 } }
          );
        } else if (status === 'cancelled') {
          await Table.findOneAndUpdate(
            { tableNumber: order.tableNumber },
            { $inc: { activeOrderCount: -1 } }
          );
        }

        await order.save();

        const payload = {
          orderId: order._id,
          status: order.status,
          estimatedReadyAt: order.estimatedReadyAt,
          tableNumber: order.tableNumber,
          sessionId: order.sessionId
        };

        io.to('admin').emit('order:status-changed', payload);
        io.to(`session:${order.sessionId}`).emit('order:your-status-changed', payload);
        io.to('kitchen').emit('kitchen:order-updated', payload);
      } catch (err) {
        console.error('kitchen:update-status error:', err.message);
      }
    });

    // ── customer:call-waiter ──────────────────────────────────────────────────
    // Emit waiter:called to kitchen room
    // Requirement: 10.4
    socket.on('customer:call-waiter', ({ sessionId, tableNumber } = {}) => {
      io.to('kitchen').emit('waiter:called', { sessionId, tableNumber });
    });
  });
}

module.exports = { initializeSocket };
