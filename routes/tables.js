'use strict';

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const Table = require('../models/Table');
const { protect, authorize } = require('../middleware/authMiddleware');
const { generateQRDataURL } = require('../qr-generator/generate');

/**
 * GET /api/tables — admin only
 * Returns all tables with status, activeOrderCount, currentSessionId.
 */
router.get('/', protect, authorize('admin'), async (req, res, next) => {
  try {
    const tables = await Table.find({}).select(
      'tableNumber capacity location status activeOrderCount currentSessionId'
    );
    return res.json(tables);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/tables/:num/status — admin or waiter
 * Updates table status. Rotates currentSessionId when status becomes 'available'.
 */
router.patch('/:num/status', protect, authorize('admin', 'waiter'), async (req, res, next) => {
  try {
    const tableNumber = Number(req.params.num);
    const { status } = req.body;

    const validStatuses = ['available', 'occupied', 'reserved', 'cleaning'];
    if (!validStatuses.includes(status)) {
      return res.status(422).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}.` });
    }

    const table = await Table.findOne({ tableNumber });
    if (!table) {
      return res.status(404).json({ error: 'Table not found.' });
    }

    table.status = status;

    // Rotate session ID when table is cleared (becomes available)
    if (status === 'available') {
      table.currentSessionId = uuidv4();
    }

    await table.save();

    // Emit table:status-changed to admin room
    const io = req.app.get('io');
    if (io) {
      io.to('admin').emit('table:status-changed', {
        tableNumber: table.tableNumber,
        status: table.status,
        currentSessionId: table.currentSessionId,
      });
    }

    return res.json(table);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/tables/initialize — admin only
 * Bulk creates/upserts tables with QR codes and session IDs.
 * Body: { tables: [{ tableNumber, capacity, location }] }
 */
router.post('/initialize', protect, authorize('admin'), async (req, res, next) => {
  try {
    const { tables } = req.body;

    if (!Array.isArray(tables) || tables.length === 0) {
      return res.status(422).json({ error: 'tables must be a non-empty array.' });
    }

    const frontendUrl = process.env.FRONTEND_URL || '';
    const results = [];

    for (const tableData of tables) {
      const { tableNumber, capacity, location } = tableData;
      const sessionId = uuidv4();
      const url = `${frontendUrl}/index.html?table=${tableNumber}&session=${sessionId}`;
      const qrCodeDataUrl = await generateQRDataURL(url);

      const table = await Table.findOneAndUpdate(
        { tableNumber },
        {
          tableNumber,
          capacity,
          location,
          currentSessionId: sessionId,
          qrCode: qrCodeDataUrl,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      results.push(table);
    }

    return res.status(201).json({ created: results.length, tables: results });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
