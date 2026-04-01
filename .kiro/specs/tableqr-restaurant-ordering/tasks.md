# Implementation Plan: TableQR — Smart Restaurant Ordering System

## Overview

Incremental implementation of the TableQR platform: Node.js/Express backend with MongoDB, Socket.io real-time layer, and Vanilla JS frontends for customers, kitchen staff, and admins. Each task builds on the previous, ending with full integration.

## Tasks

- [x] 1. Project scaffold and core infrastructure
  - Initialize Node.js project with all dependencies from the design (`express`, `mongoose`, `socket.io`, `jsonwebtoken`, `bcryptjs`, `helmet`, `cors`, `express-rate-limit`, `express-validator`, `qrcode`, `uuid`, `dotenv`, `razorpay`)
  - Create directory structure: `routes/`, `models/`, `middleware/`, `utils/`, `socket/`, `qr-generator/output/`, `public/`
  - Set up `server.js` entry point wiring Express, Socket.io, Helmet, CORS, and MongoDB connection
  - Add global error middleware and 503 health check endpoint (`GET /health`)
  - Configure `.env` with `MONGO_URI`, `JWT_SECRET`, `PORT`, `FRONTEND_URL`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`
  - _Requirements: 14.1, 14.2, 15.1, 15.2, 15.3_

- [x] 2. Data models
  - [x] 2.1 Implement `models/MenuItem.js` Mongoose schema with all fields, validation rules, and `{ aiScore: -1 }` index
    - _Requirements: 2.1, 3.6_
  - [x] 2.2 Implement `models/Order.js` Mongoose schema with all fields, status enum, statusHistory sub-document, and indexes `{ tableNumber: 1, status: 1 }`, `{ sessionId: 1 }`, `{ createdAt: -1 }`
    - _Requirements: 5.7, 5.8, 7.1, 7.3_
  - [x] 2.3 Implement `models/Table.js` Mongoose schema with all fields and unique index on `tableNumber`
    - _Requirements: 4.3, 4.4, 4.5_
  - [x] 2.4 Implement `models/User.js` Mongoose schema with all fields, unique index on `email`, and pre-save hook to bcrypt-hash the password (12 rounds)
    - _Requirements: 1.1, 1.6_

- [x] 3. Utility functions
  - [x] 3.1 Implement `utils/orderUtils.js` — `validateStatusTransition(currentStatus, newStatus)` using the transition table from the design
    - _Requirements: 7.1, 7.2_
  - [ ]* 3.2 Write property test for `validateStatusTransition`
    - **Property 2: Status Monotonicity** — for any sequence of transitions, no backward or invalid transition is ever permitted
    - **Validates: Requirements 7.1, 7.2**
  - [x] 3.3 Implement `computeEstimatedReadyAt(newOrder)` in `utils/orderUtils.js` following the pseudocode: max prep time, load factor, priority multiplier, minimum 1-minute floor
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [ ]* 3.4 Write property tests for `computeEstimatedReadyAt`
    - **Property 5: ETA Monotonicity with Load** — higher active order count produces equal or later ETA for identical orders
    - **Property 12: ETA Always in the Future** — result is always > now for any valid input
    - **Property 13: Priority Reduces ETA** — urgent always ≤ normal ETA under same load
    - **Validates: Requirements 6.4, 6.5, 6.6**
  - [x] 3.5 Implement `computeAiScore(menuItemId)` in `utils/orderUtils.js` following the pseudocode: frequency, rating, recency signals with weights 0.4/0.4/0.2, clamped to [0, 100]
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_
  - [ ]* 3.6 Write property test for `computeAiScore`
    - **Property 6: AI Score Bounds** — for any valid stats combination, result is always an integer in [0, 100]
    - **Validates: Requirements 3.6**

- [x] 4. Checkpoint — Ensure all utility tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Auth module
  - [x] 5.1 Implement `middleware/authMiddleware.js` — `protect` (JWT verification, attaches `req.user` without password) and `authorize(...roles)` (role check)
    - _Requirements: 1.4, 1.5, 1.6, 1.7_
  - [ ]* 5.2 Write unit tests for `protect` and `authorize`
    - Test valid token → `req.user` populated, `next()` called
    - Test expired/invalid token → 401, `next()` not called
    - Test wrong role → 403
    - _Requirements: 1.4, 1.5, 1.7_
  - [x] 5.3 Implement `routes/auth.js` — `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
    - Apply `express-validator` validation on register and login bodies
    - Apply rate limiting (5 attempts per IP per 15 min) on login route
    - _Requirements: 1.1, 1.2, 1.3, 1.6, 14.4, 14.5, 14.6_
  - [ ]* 5.4 Write property test for password security
    - **Property 7: Password Security** — raw password is never persisted in plaintext and never appears in any API response
    - **Validates: Requirements 1.1, 1.6**

- [x] 6. Menu module
  - [x] 6.1 Implement `routes/menu.js` — all six endpoints (`GET /api/menu`, `GET /api/menu/recommendations`, `GET /api/menu/categories`, `POST`, `PUT /:id`, `PATCH /:id/availability`, `DELETE /:id`)
    - Public endpoints return only `isAvailable: true` items
    - Admin mutation endpoints emit `menu:updated` / `menu:availability` Socket.io events
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_
  - [ ]* 6.2 Write property test for menu availability filter
    - **Property 11: Menu Availability Filter** — public menu endpoint always returns only items where `isAvailable` is `true`
    - **Validates: Requirements 2.1**
  - [ ]* 6.3 Write property test for recommendations ordering
    - **Property 15: Recommendations Sorted by AI Score** — recommendations endpoint returns available items in non-increasing order of `aiScore`
    - **Validates: Requirements 2.7**

- [x] 7. QR and Table modules
  - [x] 7.1 Implement `routes/qr.js` and `qr-generator/generate.js` — `GET /api/qr/:tableNumber` (returns base64 data URL + sessionId + tableInfo) and `POST /api/qr/generate-all` (writes PNGs to `qr-generator/output/`)
    - Encode only `tableNumber` and `sessionId` in QR URL — no PII
    - _Requirements: 4.1, 4.2, 14.7, 14.8_
  - [ ]* 7.2 Write property tests for QR session
    - **Property 16: Session IDs Are UUID v4** — every generated sessionId conforms to UUID v4 format
    - **Property 17: QR Codes Contain No PII** — decoded QR URL contains only `tableNumber` and `sessionId` parameters
    - **Validates: Requirements 14.7, 14.8**
  - [x] 7.3 Implement `routes/tables.js` — `GET /api/tables`, `PATCH /api/tables/:num/status`, `POST /api/tables/initialize`
    - On `POST /api/tables/initialize`: generate `currentSessionId` (UUID v4) and QR code per table
    - On status transition to `available`: rotate `currentSessionId` to a new UUID
    - Emit `table:status-changed` to admin room on status updates
    - _Requirements: 4.3, 4.4, 4.5, 12.1, 12.2, 12.3_
  - [ ]* 7.4 Write property test for QR session rotation
    - **Property 10: QR Session Rotation** — after clearing a table, `currentSessionId` always differs from the previous value
    - **Validates: Requirements 4.4**

- [x] 8. Orders module
  - [x] 8.1 Implement `placeOrder` handler in `routes/orders.js` — `POST /api/orders`
    - Validate `sessionId` matches `table.currentSessionId` → 403 on mismatch
    - Validate all `menuItemId` values exist and `isAvailable: true` → 422 on failure
    - Snapshot `name` and `price` from MenuItem onto each order item
    - Compute `subtotal`, `gst` (5%), `total`; call `computeEstimatedReadyAt`
    - Persist order with `status: pending`, increment `table.activeOrderCount`
    - Emit `kitchen:new-order` and `order:new` via Socket.io
    - Apply rate limiting: 10 orders per session per 15 minutes
    - Apply `express-validator` validation on request body
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 14.3, 14.5_
  - [ ]* 8.2 Write property tests for order placement
    - **Property 1: Session Integrity** — orders with mismatched sessionId are always rejected with 403
    - **Property 3: Financial Consistency** — `total === subtotal + gst`, `subtotal === sum(price * qty)`, `gst === subtotal * 0.05`
    - **Property 9: Menu Snapshot Immutability** — order item `name` and `price` remain unchanged after MenuItem update
    - **Validates: Requirements 5.1, 5.2, 5.7, 5.8**
  - [x] 8.3 Implement `updateOrderStatus` handler — `PATCH /api/orders/:id/status`
    - Validate transition via `validateStatusTransition` → 422 on invalid
    - Append to `statusHistory` with timestamp and `req.user._id`
    - On `served`: set `servedAt`, decrement `table.activeOrderCount`
    - On `cancelled`: decrement `table.activeOrderCount`
    - Emit `order:status-changed`, `order:your-status-changed`, `kitchen:order-updated`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_
  - [ ]* 8.4 Write property tests for order status management
    - **Property 4: Active Order Count Invariant** — `table.activeOrderCount` always equals count of orders with status in `[pending, preparing, ready]`
    - **Property 14: Status History Append-Only Growth** — `statusHistory` length increases by exactly 1 per transition, no entries modified
    - **Validates: Requirements 7.3, 7.4, 7.5**
  - [x] 8.5 Implement remaining order endpoints: `GET /api/orders`, `GET /api/orders/active`, `GET /api/orders/table/:num`, `GET /api/orders/:id`, `POST /api/orders/:id/rating`
    - _Requirements: 9.1, 9.3, 10.1, 10.2_

- [x] 9. Checkpoint — Ensure all order and auth tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Analytics module
  - [x] 10.1 Implement `routes/analytics.js` — all four endpoints using MongoDB aggregation pipelines
    - `GET /api/analytics/dashboard?period=today|week|month` → `{ totalOrders, totalRevenue, avgOrderValue, activeOrders, topCategory }`
    - `GET /api/analytics/popular` → MenuItem[] ranked by order frequency
    - `GET /api/analytics/revenue-chart` → `[{ date, revenue }]`
    - `GET /api/analytics/crowd` → `[{ tableNumber, orderCount, lastActivity }]`
    - All aggregations use MongoDB pipelines — no in-memory JS aggregation
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_
  - [ ]* 10.2 Write unit tests for analytics aggregations
    - Seed known orders, assert dashboard KPIs match expected values for each period
    - Assert `activeOrders` reflects real-time pending + preparing count
    - _Requirements: 11.1, 11.2_

- [x] 11. Socket manager
  - [x] 11.1 Implement `socket/socketManager.js` — `initializeSocket(io)` registering all client→server event handlers
    - `join:session`: admit any socket with valid `sessionId` + `tableNumber` to `session:<sessionId>` room (no auth)
    - `join:kitchen`: verify JWT with `kitchen` or `admin` role → admit to `kitchen` room; else emit `auth:error` and disconnect
    - `join:admin`: verify JWT with `admin` role → admit to `admin` room; else emit `auth:error` and disconnect
    - `kitchen:update-status`: delegate to order update logic, emit appropriate events
    - `customer:call-waiter`: emit `waiter:called` to kitchen room
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 10.3, 10.4_
  - [ ]* 11.2 Write property test for socket room authorization
    - **Property 8: Socket Room Authorization** — `join:kitchen`/`join:admin` with invalid JWT always results in `auth:error` and disconnection; valid JWT with correct role always results in room admission
    - **Validates: Requirements 8.2, 8.3, 8.4**

- [x] 12. Payment integration
  - [x] 12.1 Implement Razorpay webhook handler — verify HMAC signature before updating `paymentStatus` to `paid`; reject with 400 on signature failure
    - _Requirements: 13.1, 13.2, 13.3_

- [x] 13. Frontend — Customer flow (`public/index.html`, `public/track.html`)
  - [x] 13.1 Implement `public/index.html` — parse `?table=N&session=<uuid>` from URL, fetch and render menu grouped by category, add-to-cart UI, and `POST /api/orders` on checkout
    - _Requirements: 4.1, 5.1, 5.6_
  - [x] 13.2 Implement `public/track.html` — display order status, `estimatedReadyAt`, and `statusHistory`; connect Socket.io and join session room; update UI on `order:your-status-changed`
    - _Requirements: 9.1, 9.2_

- [ ] 14. Frontend — Kitchen Display System (`public/kitchen.html`)
  - Implement `public/kitchen.html` — login form, Socket.io `join:kitchen`, render active order cards, update status via `kitchen:update-status`, handle `kitchen:new-order` and `kitchen:order-updated` events
  - _Requirements: 10.1, 10.3, 8.2_

- [ ] 15. Frontend — Admin dashboard (`public/admin.html`)
  - Implement `public/admin.html` — login, KPI cards from `/api/analytics/dashboard`, revenue chart, crowd heatmap, menu CRUD UI, table management, and Socket.io `join:admin` for live updates
  - _Requirements: 11.1, 11.3, 11.4, 11.5, 2.2, 2.3, 2.4, 12.1, 12.2_

- [ ] 16. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Property tests use `fast-check` as specified in the design
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation before moving to the next layer
- The frontend tasks (13–15) depend on the backend being fully wired (tasks 1–12)
