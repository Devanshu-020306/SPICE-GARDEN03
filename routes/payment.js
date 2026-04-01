'use strict';

const express = require('express');
const crypto = require('crypto');
const Order = require('../models/Order');

const router = express.Router();

// POST /api/payment/webhook
// Uses express.raw() to get the raw body for HMAC signature verification
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];

    if (!signature) {
      return res.status(400).json({ error: 'Missing webhook signature.' });
    }

    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      console.error('RAZORPAY_KEY_SECRET is not configured');
      return res.status(500).json({ error: 'Payment configuration error.' });
    }

    // Compute HMAC-SHA256 over the raw body
    const rawBody = req.body; // Buffer when using express.raw()
    const computed = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    // Timing-safe comparison to prevent timing attacks
    let signatureValid = false;
    try {
      signatureValid = crypto.timingSafeEqual(
        Buffer.from(computed, 'hex'),
        Buffer.from(signature, 'hex')
      );
    } catch (_) {
      // Buffer lengths differ → invalid signature
      signatureValid = false;
    }

    if (!signatureValid) {
      return res.status(400).json({ error: 'Invalid webhook signature.' });
    }

    // Parse the verified body
    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch (_) {
      return res.status(400).json({ error: 'Invalid JSON payload.' });
    }

    // Extract Razorpay IDs from the webhook payload
    const paymentEntity = payload?.payload?.payment?.entity || {};
    const razorpayOrderId = paymentEntity.order_id;
    const razorpayPaymentId = paymentEntity.id;

    // Find the order by paymentRef (razorpay_order_id or razorpay_payment_id)
    const query = [];
    if (razorpayOrderId) query.push({ paymentRef: razorpayOrderId });
    if (razorpayPaymentId) query.push({ paymentRef: razorpayPaymentId });

    if (query.length === 0) {
      // No identifiable payment reference — acknowledge but do nothing
      return res.status(200).json({ received: true });
    }

    const order = await Order.findOne({ $or: query });

    if (order) {
      order.paymentStatus = 'paid';
      if (razorpayPaymentId && !order.paymentRef) {
        order.paymentRef = razorpayPaymentId;
      }
      await order.save();
    }

    // Always return 200 to acknowledge receipt to Razorpay
    return res.status(200).json({ received: true });
  }
);

module.exports = router;
