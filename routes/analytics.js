'use strict';

const express = require('express');
const { query, validationResult } = require('express-validator');

const Order = require('../models/Order');
const Table = require('../models/Table');
const MenuItem = require('../models/MenuItem');
const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

// All analytics endpoints require admin role
router.use(protect, authorize('admin'));

// ── Helper: compute startDate from period ─────────────────────────────────────
function getStartDate(period) {
  const now = new Date();
  if (period === 'week') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
  }
  if (period === 'month') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
  }
  // default: today
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// ── GET /api/analytics/dashboard?period=today|week|month ─────────────────────
// Requirements: 11.1, 11.2
router.get(
  '/dashboard',
  [
    query('period')
      .optional()
      .isIn(['today', 'week', 'month'])
      .withMessage('period must be today, week, or month'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(422).json({ errors: errors.array() });
      }

      const period = req.query.period || 'today';
      const startDate = getStartDate(period);

      // Aggregate totalOrders, totalRevenue, avgOrderValue via pipeline
      const [summary] = await Order.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            totalRevenue: { $sum: '$total' },
            avgOrderValue: { $avg: '$total' },
          },
        },
      ]);

      const totalOrders = summary ? summary.totalOrders : 0;
      const totalRevenue = summary ? parseFloat(summary.totalRevenue.toFixed(2)) : 0;
      const avgOrderValue = summary ? parseFloat(summary.avgOrderValue.toFixed(2)) : 0;

      // Real-time active orders (pending + preparing)
      const activeOrders = await Order.countDocuments({
        status: { $in: ['pending', 'preparing'] },
      });

      // topCategory: unwind items, lookup MenuItem for category, group by category
      const topCategoryResult = await Order.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        { $unwind: '$items' },
        {
          $lookup: {
            from: 'menuitems',
            localField: 'items.menuItem',
            foreignField: '_id',
            as: 'menuItemDoc',
          },
        },
        { $unwind: { path: '$menuItemDoc', preserveNullAndEmptyArrays: false } },
        {
          $group: {
            _id: '$menuItemDoc.category',
            count: { $sum: '$items.quantity' },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 1 },
      ]);

      const topCategory = topCategoryResult.length > 0 ? topCategoryResult[0]._id : null;

      return res.status(200).json({
        totalOrders,
        totalRevenue,
        avgOrderValue,
        activeOrders,
        topCategory,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/analytics/popular — menu items ranked by order frequency ─────────
// Requirements: 11.3
router.get('/popular', async (req, res, next) => {
  try {
    const popular = await Order.aggregate([
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.menuItem',
          orderCount: { $sum: '$items.quantity' },
        },
      },
      { $sort: { orderCount: -1 } },
      {
        $lookup: {
          from: 'menuitems',
          localField: '_id',
          foreignField: '_id',
          as: 'menuItem',
        },
      },
      { $unwind: { path: '$menuItem', preserveNullAndEmptyArrays: false } },
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: ['$menuItem', { orderCount: '$orderCount' }],
          },
        },
      },
    ]);

    return res.status(200).json(popular);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/analytics/revenue-chart?days=N — daily revenue totals ────────────
// Requirements: 11.4
router.get(
  '/revenue-chart',
  [
    query('days')
      .optional()
      .isInt({ min: 1, max: 365 })
      .withMessage('days must be an integer between 1 and 365'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(422).json({ errors: errors.array() });
      }

      const days = parseInt(req.query.days, 10) || 30;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      startDate.setHours(0, 0, 0, 0);

      const chart = await Order.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
            },
            revenue: { $sum: '$total' },
          },
        },
        { $sort: { _id: 1 } },
        {
          $project: {
            _id: 0,
            date: '$_id',
            revenue: { $round: ['$revenue', 2] },
          },
        },
      ]);

      return res.status(200).json(chart);
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/analytics/crowd — crowd heatmap per table ───────────────────────
// Requirements: 11.5
router.get('/crowd', async (req, res, next) => {
  try {
    // Get lastActivity per table from Order collection via aggregation
    const lastActivityByTable = await Order.aggregate([
      {
        $group: {
          _id: '$tableNumber',
          lastActivity: { $max: '$createdAt' },
        },
      },
    ]);

    // Build a lookup map: tableNumber → lastActivity
    const activityMap = {};
    for (const row of lastActivityByTable) {
      activityMap[row._id] = row.lastActivity;
    }

    // Fetch all tables (activeOrderCount comes from Table collection)
    const tables = await Table.find({}, 'tableNumber activeOrderCount').lean();

    const crowd = tables.map((t) => ({
      tableNumber: t.tableNumber,
      orderCount: t.activeOrderCount || 0,
      lastActivity: activityMap[t.tableNumber] || null,
    }));

    // Sort by tableNumber ascending
    crowd.sort((a, b) => a.tableNumber - b.tableNumber);

    return res.status(200).json(crowd);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
