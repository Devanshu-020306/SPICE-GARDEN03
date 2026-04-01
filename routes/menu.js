'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const MenuItem = require('../models/MenuItem');
const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

// ── Validation rules ──────────────────────────────────────────────────────────
const menuItemValidation = [
  body('name').notEmpty().withMessage('name is required'),
  body('price').isFloat({ min: 0 }).withMessage('price must be a non-negative number'),
  body('category').notEmpty().withMessage('category is required'),
];

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ errors: errors.array() });
  }
  return null;
}

// ── GET /api/menu — public, available items sorted by sortOrder then aiScore desc ──
router.get('/', async (req, res, next) => {
  try {
    const items = await MenuItem.find({ isAvailable: true })
      .sort({ sortOrder: 1, aiScore: -1 });
    res.json(items);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/menu/recommendations — public, available items sorted by aiScore desc ──
router.get('/recommendations', async (req, res, next) => {
  try {
    const items = await MenuItem.find({ isAvailable: true })
      .sort({ aiScore: -1 });
    res.json(items);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/menu/categories — public, distinct categories from available items ──
router.get('/categories', async (req, res, next) => {
  try {
    const categories = await MenuItem.distinct('category', { isAvailable: true });
    res.json(categories);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/menu — admin only, create MenuItem ──────────────────────────────
router.post('/', protect, authorize('admin'), menuItemValidation, async (req, res, next) => {
  const invalid = handleValidation(req, res);
  if (invalid !== null) return;

  try {
    const item = await MenuItem.create(req.body);
    req.app.get('io').to('admin').emit('menu:updated', item);
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/menu/:id — admin only, replace MenuItem fields ──────────────────
router.put('/:id', protect, authorize('admin'), menuItemValidation, async (req, res, next) => {
  const invalid = handleValidation(req, res);
  if (invalid !== null) return;

  try {
    const item = await MenuItem.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!item) return res.status(404).json({ error: 'Menu item not found.' });
    req.app.get('io').to('admin').emit('menu:updated', item);
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/menu/:id/availability — admin or kitchen ──────────────────────
router.patch('/:id/availability', protect, authorize('admin', 'kitchen'), async (req, res, next) => {
  try {
    const { isAvailable } = req.body;
    if (typeof isAvailable !== 'boolean') {
      return res.status(422).json({ error: 'isAvailable must be a boolean.' });
    }
    const item = await MenuItem.findByIdAndUpdate(
      req.params.id,
      { isAvailable },
      { new: true }
    );
    if (!item) return res.status(404).json({ error: 'Menu item not found.' });
    req.app.get('io').to('admin').emit('menu:availability', item);
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/menu/:id — admin only ────────────────────────────────────────
router.delete('/:id', protect, authorize('admin'), async (req, res, next) => {
  try {
    const item = await MenuItem.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ error: 'Menu item not found.' });
    res.json({ message: 'Menu item deleted.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
