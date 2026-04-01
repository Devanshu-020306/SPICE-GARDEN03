const MenuItem = require('../models/MenuItem');
const Order = require('../models/Order');

/**
 * Validates whether a status transition is allowed.
 * Transition graph:
 *   pending    → [preparing, cancelled]
 *   preparing  → [ready, cancelled]
 *   ready      → [served]
 *   served     → []  (terminal)
 *   cancelled  → []  (terminal)
 *
 * Requirements: 7.1, 7.2
 *
 * @param {string} currentStatus
 * @param {string} newStatus
 * @returns {boolean}
 */
function validateStatusTransition(currentStatus, newStatus) {
  const allowedTransitions = {
    pending: ['preparing', 'cancelled'],
    preparing: ['ready', 'cancelled'],
    ready: ['served'],
    served: [],
    cancelled: []
  };

  const allowed = allowedTransitions[currentStatus];
  if (!allowed) return false;
  return allowed.includes(newStatus);
}

/**
 * Computes the estimated ready time for a newly placed order.
 * Steps:
 *   1. Find max preparationTime across all items in the order
 *   2. Count active kitchen load (pending + preparing orders)
 *   3. Apply load factor: ≤2 → 1.0, 3-5 → 1.25, 6-10 → 1.5, >10 → 2.0
 *   4. Apply priority multiplier: urgent → 0.7, high → 0.85, normal → 1.0
 *   5. etaMinutes = maxItemPrepTime * loadFactor * priorityMultiplier (min 1 minute)
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4
 *
 * @param {Object} newOrder - The newly placed order document (with items and priority)
 * @returns {Promise<Date>} estimatedReadyAt
 */
async function computeEstimatedReadyAt(newOrder) {
  // Step 1: Get max prep time across all items
  let maxItemPrepTime = 0;
  for (const item of newOrder.items) {
    const menuItemId = item.menuItem || item.menuItemId;
    const menuItem = await MenuItem.findById(menuItemId);
    if (menuItem && menuItem.preparationTime > maxItemPrepTime) {
      maxItemPrepTime = menuItem.preparationTime;
    }
  }

  // Step 2: Count active kitchen load (pending + preparing)
  const activeOrders = await Order.countDocuments({
    status: { $in: ['pending', 'preparing'] }
  });

  // Step 3: Load factor
  let loadFactor;
  if (activeOrders <= 2) {
    loadFactor = 1.0;
  } else if (activeOrders <= 5) {
    loadFactor = 1.25;
  } else if (activeOrders <= 10) {
    loadFactor = 1.5;
  } else {
    loadFactor = 2.0;
  }

  // Step 4: Priority multiplier
  const priority = newOrder.priority || 'normal';
  let priorityMultiplier;
  if (priority === 'urgent') {
    priorityMultiplier = 0.7;
  } else if (priority === 'high') {
    priorityMultiplier = 0.85;
  } else {
    priorityMultiplier = 1.0;
  }

  // Step 5: Compute ETA with minimum 1-minute floor
  let etaMinutes = maxItemPrepTime * loadFactor * priorityMultiplier;
  if (etaMinutes < 1) etaMinutes = 1;

  const estimatedReadyAt = new Date(Date.now() + etaMinutes * 60 * 1000);
  return estimatedReadyAt;
}

/**
 * Computes the AI score for a menu item based on order frequency,
 * rating, and recency signals.
 *
 * Formula:
 *   freqScore    = MIN(stats.totalOrdered / 500, 1.0)
 *   ratingScore  = ratingCount === 0 ? 0.5 : (avgRating - 1) / 4
 *   recencyScore = MIN(recentOrders / 50, 1.0)  [orders in last 7 days]
 *   aiScore      = ROUND((freqScore * 0.4 + ratingScore * 0.4 + recencyScore * 0.2) * 100)
 *   Clamped to [0, 100]
 *
 * Items with no orders and no ratings → aiScore = 20
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
 *
 * @param {string|ObjectId} menuItemId
 * @returns {Promise<number>} aiScore in [0, 100]
 */
async function computeAiScore(menuItemId) {
  const item = await MenuItem.findById(menuItemId);
  if (!item) throw new Error(`MenuItem not found: ${menuItemId}`);

  const stats = item.stats || {};
  const totalOrdered = stats.totalOrdered || 0;
  const avgRating = stats.avgRating || 0;
  const ratingCount = stats.ratingCount || 0;

  // Frequency signal: cap at 500
  const freqScore = Math.min(totalOrdered / 500, 1.0);

  // Rating signal: neutral 0.5 if no ratings, else map [1,5] → [0,1]
  const ratingScore = ratingCount === 0 ? 0.5 : (avgRating - 1) / 4;

  // Recency signal: orders in last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentOrders = await Order.countDocuments({
    'items.menuItem': menuItemId,
    createdAt: { $gte: sevenDaysAgo }
  });
  const recencyScore = Math.min(recentOrders / 50, 1.0);

  // Weighted combination
  const raw = freqScore * 0.4 + ratingScore * 0.4 + recencyScore * 0.2;
  let aiScore = Math.round(raw * 100);

  // Clamp to [0, 100]
  aiScore = Math.max(0, Math.min(100, aiScore));

  return aiScore;
}

module.exports = {
  validateStatusTransition,
  computeEstimatedReadyAt,
  computeAiScore
};
