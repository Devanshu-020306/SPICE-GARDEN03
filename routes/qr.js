'use strict';

const express = require('express');
const router = express.Router();
const Table = require('../models/Table');
const { protect, authorize } = require('../middleware/authMiddleware');
const { generateQRDataURL, generateQRFile } = require('../qr-generator/generate');

/**
 * POST /api/qr/generate-all — admin only
 * Generates PNG QR files for all tables and writes them to qr-generator/output/.
 */
router.post('/generate-all', protect, authorize('admin'), async (_req, res, next) => {
  try {
    const tables = await Table.find({});
    const frontendUrl = process.env.FRONTEND_URL || '';
    const files = [];

    for (const table of tables) {
      const url = `${frontendUrl}/index.html?table=${table.tableNumber}&session=${table.currentSessionId}`;
      const filename = await generateQRFile(table.tableNumber, url);
      files.push(filename);
    }

    return res.json({ generated: files.length, files });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/qr/:tableNumber — public
 * Returns QR code data URL, sessionId, and tableInfo for a table.
 */
router.get('/:tableNumber', async (req, res, next) => {
  try {
    const tableNumber = Number(req.params.tableNumber);
    const table = await Table.findOne({ tableNumber });

    if (!table) {
      return res.status(404).json({ error: 'Table not found.' });
    }

    const frontendUrl = process.env.FRONTEND_URL || '';
    const url = `${frontendUrl}/index.html?table=${table.tableNumber}&session=${table.currentSessionId}`;
    const qrCodeDataUrl = await generateQRDataURL(url);

    return res.json({
      qrCodeDataUrl,
      sessionId: table.currentSessionId,
      tableInfo: {
        tableNumber: table.tableNumber,
        capacity: table.capacity,
        location: table.location,
        status: table.status,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
