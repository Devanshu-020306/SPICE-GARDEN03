# Requirements Document

## Introduction

TableQR is a QR-based restaurant ordering platform. Customers scan a table QR code, browse the menu, place orders, and track them in real-time from a mobile browser. Kitchen staff manage the live order queue through a Kitchen Display System (KDS). Administrators configure the menu, manage tables, and view live analytics including revenue charts and crowd heatmaps. All three contexts are synchronized in real-time via Socket.io.

## Glossary

- **System**: The TableQR backend and frontend application as a whole
- **Customer**: An anonymous restaurant guest interacting via a mobile browser after scanning a QR code
- **Staff**: An authenticated restaurant employee (kitchen, waiter, or admin role)
- **Admin**: A Staff member with the `admin` role who can manage menus, tables, and view analytics
- **Kitchen**: A Staff member with the `kitchen` role who manages the order queue via the KDS
- **Waiter**: A Staff member with the `waiter` role who can update table status
- **Auth_Module**: The authentication component handling registration, login, and JWT verification
- **Menu_Module**: The component managing menu item CRUD and AI-score-based recommendations
- **Order_Module**: The component managing the full order lifecycle
- **Table_Module**: The component managing table state and QR session lifecycle
- **Analytics_Module**: The component aggregating KPI and chart data for the admin dashboard
- **QR_Module**: The component generating QR codes for tables
- **Socket_Manager**: The component managing all Socket.io rooms and real-time event routing
- **ETA_Engine**: The Smart ETA computation utility
- **AI_Scorer**: The AI score computation utility for menu items
- **Session**: A UUID tied to a specific table scan, valid until the table is cleared
- **KDS**: Kitchen Display System — the kitchen staff's real-time order queue interface
- **JWT**: JSON Web Token used to authenticate Staff requests
- **aiScore**: A computed score in [0, 100] ranking a menu item's popularity and recency

---

## Requirements

### Requirement 1: Staff Authentication

**User Story:** As a staff member, I want to register and log in with a secure account, so that I can access role-appropriate features of the system.

#### Acceptance Criteria

1. WHEN a registration request is received with name, email, password, and role, THE Auth_Module SHALL create a new Staff account with the password stored as a bcrypt hash (12 rounds)
2. WHEN a login request is received with valid email and password, THE Auth_Module SHALL return a signed JWT containing userId, role, and expiry
3. WHEN a login request is received with invalid credentials, THE Auth_Module SHALL return a 401 error response
4. WHEN a protected request is received with a valid Bearer JWT, THE Auth_Module SHALL attach the authenticated user's id, name, email, and role to the request context and allow the request to proceed
5. WHEN a protected request is received with an expired or invalid JWT, THE Auth_Module SHALL return a 401 error and not process the request further
6. THE Auth_Module SHALL never include the password field in any API response
7. WHEN a request is received for a route restricted to specific roles, THE Auth_Module SHALL return a 403 error if the authenticated user's role is not in the allowed set

---

### Requirement 2: Menu Management

**User Story:** As an admin, I want to manage the menu, so that customers always see accurate, up-to-date items.

#### Acceptance Criteria

1. THE Menu_Module SHALL expose a public endpoint that returns all menu items where `isAvailable` is true
2. WHEN an admin creates a menu item with valid fields, THE Menu_Module SHALL persist the item and emit a `menu:updated` Socket.io event to the admin room
3. WHEN an admin updates a menu item, THE Menu_Module SHALL replace the item's fields and emit a `menu:updated` event to the admin room
4. WHEN an admin or kitchen staff updates a menu item's availability, THE Menu_Module SHALL update `isAvailable` and emit a `menu:availability` event to the admin room
5. WHEN an admin deletes a menu item, THE Menu_Module SHALL remove the item from the menu
6. THE Menu_Module SHALL expose a public endpoint returning all distinct category names
7. THE Menu_Module SHALL expose a public recommendations endpoint returning available menu items sorted by `aiScore` descending

---

### Requirement 3: AI Score Computation

**User Story:** As a customer, I want to see popular and highly-rated items highlighted, so that I can make informed ordering decisions.

#### Acceptance Criteria

1. THE AI_Scorer SHALL compute `aiScore` as a weighted combination: 40% order frequency signal, 40% rating signal, and 20% recency signal (orders in the last 7 days)
2. THE AI_Scorer SHALL normalize the order frequency signal by capping at 500 total orders, mapping to [0, 1]
3. WHEN a menu item has no ratings, THE AI_Scorer SHALL use 0.5 as the neutral rating signal
4. WHEN a menu item has ratings, THE AI_Scorer SHALL map the average rating from [1, 5] to [0, 1]
5. THE AI_Scorer SHALL normalize the recency signal by capping at 50 recent orders, mapping to [0, 1]
6. THE AI_Scorer SHALL clamp the final `aiScore` to the integer range [0, 100]
7. WHEN a menu item has no orders and no ratings, THE AI_Scorer SHALL produce an `aiScore` of 20

---

### Requirement 4: QR Code and Session Management

**User Story:** As a customer, I want to scan a table QR code to start my session, so that my orders are correctly associated with my table.

#### Acceptance Criteria

1. WHEN a request is received for a table's QR code, THE QR_Module SHALL return a base64 data URL encoding the table URL with `tableNumber` and a `sessionId`
2. THE QR_Module SHALL expose an admin endpoint that generates PNG QR files for all tables and writes them to the output directory
3. WHEN a table is initialized, THE Table_Module SHALL generate and store a QR code URL for that table
4. WHEN a table's status transitions to `available` (cleared), THE Table_Module SHALL rotate `currentSessionId` to a new UUID, invalidating all previously issued session tokens for that table
5. THE Table_Module SHALL track `activeOrderCount` and `status` (available, occupied, reserved, or cleaning) for each table

---

### Requirement 5: Order Placement

**User Story:** As a customer, I want to place an order from my table, so that the kitchen can prepare my food.

#### Acceptance Criteria

1. WHEN an order placement request is received, THE Order_Module SHALL validate that the provided `sessionId` matches `table.currentSessionId` for the given `tableNumber`
2. IF the `sessionId` does not match `table.currentSessionId`, THEN THE Order_Module SHALL return a 403 error with the message "Session expired. Please scan the QR code again."
3. WHEN an order placement request contains a `menuItemId` with `isAvailable: false`, THE Order_Module SHALL return a 422 error listing the unavailable items
4. WHEN a valid order is placed, THE Order_Module SHALL persist the order with `status: pending`, compute `estimatedReadyAt` via the ETA_Engine, and increment `table.activeOrderCount` by 1
5. WHEN a valid order is placed, THE Order_Module SHALL emit `kitchen:new-order` to the kitchen room and `order:new` to the admin room
6. WHEN a valid order is placed, THE Order_Module SHALL respond with `orderId`, `estimatedReadyAt`, and `total`
7. THE Order_Module SHALL snapshot `name` and `price` from the MenuItem at order placement time and store them on each order item, independent of future MenuItem changes
8. WHEN computing order totals, THE Order_Module SHALL set `subtotal` to the sum of `price * quantity` for all items, `gst` to `subtotal * 0.05`, and `total` to `subtotal + gst`

---

### Requirement 6: Smart ETA Engine

**User Story:** As a customer, I want to see an accurate estimated wait time for my order, so that I can plan accordingly.

#### Acceptance Criteria

1. THE ETA_Engine SHALL compute `estimatedReadyAt` using the maximum `preparationTime` across all items in the order
2. THE ETA_Engine SHALL apply a load factor based on the count of active (pending + preparing) orders: 1.0 for ≤2, 1.25 for 3–5, 1.5 for 6–10, and 2.0 for >10
3. THE ETA_Engine SHALL apply a priority multiplier: 0.7 for urgent, 0.85 for high, and 1.0 for normal priority orders
4. THE ETA_Engine SHALL always return an `estimatedReadyAt` that is in the future (at least 1 minute from now)
5. WHEN two orders are placed at the same time with identical items, THE ETA_Engine SHALL produce an equal or later `estimatedReadyAt` for the order placed under higher kitchen load
6. WHEN two orders with identical items and load are compared, THE ETA_Engine SHALL produce an earlier `estimatedReadyAt` for the urgent-priority order than for the normal-priority order

---

### Requirement 7: Order Status Management

**User Story:** As a kitchen staff member, I want to update order statuses, so that customers and admins can track order progress in real-time.

#### Acceptance Criteria

1. THE Order_Module SHALL enforce the status transition graph: `pending` → `preparing` or `cancelled`; `preparing` → `ready` or `cancelled`; `ready` → `served`; `served` and `cancelled` are terminal states
2. WHEN a status update request violates the transition graph, THE Order_Module SHALL return a 422 error describing the invalid transition
3. WHEN an order status is updated, THE Order_Module SHALL append a new entry to `statusHistory` containing the new status, timestamp, and the updating staff member's id
4. WHEN an order transitions to `served`, THE Order_Module SHALL set `servedAt` to the current time and decrement `table.activeOrderCount` by 1
5. WHEN an order transitions to `cancelled`, THE Order_Module SHALL decrement `table.activeOrderCount` by 1
6. WHEN an order status is updated, THE Order_Module SHALL emit `order:status-changed` to the admin room, `order:your-status-changed` to the customer's session room, and `kitchen:order-updated` to the kitchen room

---

### Requirement 8: Real-Time Synchronization

**User Story:** As a customer or staff member, I want all order and menu changes to appear instantly on my screen, so that I always see the current state without refreshing.

#### Acceptance Criteria

1. WHEN a customer joins a session room with a valid `sessionId` and `tableNumber`, THE Socket_Manager SHALL admit the socket to the `session:<sessionId>` room without requiring authentication
2. WHEN a staff member emits `join:kitchen` with a valid JWT bearing the `kitchen` or `admin` role, THE Socket_Manager SHALL admit the socket to the `kitchen` room
3. WHEN a staff member emits `join:admin` with a valid JWT bearing the `admin` role, THE Socket_Manager SHALL admit the socket to the `admin` room
4. WHEN a socket emits `join:kitchen` or `join:admin` with an invalid or missing JWT, THE Socket_Manager SHALL emit `auth:error` to that socket and disconnect it
5. THE Socket_Manager SHALL route `order:your-status-changed` events only to the customer's session room, not to kitchen or admin rooms
6. WHEN a kitchen staff member emits `kitchen:update-status`, THE Socket_Manager SHALL delegate the update to the Order_Module and emit the appropriate status-changed events

---

### Requirement 9: Customer Order Tracking

**User Story:** As a customer, I want to track my order status in real-time, so that I know when my food will be ready.

#### Acceptance Criteria

1. WHEN a customer requests a single order by id, THE Order_Module SHALL return the order detail including current status, `statusHistory`, and `estimatedReadyAt`
2. WHEN the kitchen updates an order's status, THE Socket_Manager SHALL emit `order:your-status-changed` with the new status and `estimatedReadyAt` to the customer's session room
3. WHEN a customer submits a rating between 1 and 5 for a served order, THE Order_Module SHALL persist the rating and comment on the order

---

### Requirement 10: Kitchen Display System

**User Story:** As a kitchen staff member, I want to see all active orders in real-time, so that I can prepare them efficiently.

#### Acceptance Criteria

1. THE Order_Module SHALL expose an authenticated endpoint returning all orders with status `pending` or `preparing`
2. THE Order_Module SHALL expose an authenticated endpoint returning all orders filterable by table number
3. WHEN a new order is placed, THE Socket_Manager SHALL emit `kitchen:new-order` to the kitchen room immediately
4. WHEN a waiter calls for service, THE Socket_Manager SHALL emit `waiter:called` to the kitchen room with the session and table information

---

### Requirement 11: Admin Dashboard and Analytics

**User Story:** As an admin, I want to view live KPIs, revenue charts, and crowd heatmaps, so that I can make informed operational decisions.

#### Acceptance Criteria

1. WHEN an admin requests dashboard analytics with a period of `today`, `week`, or `month`, THE Analytics_Module SHALL return `totalOrders`, `totalRevenue`, `avgOrderValue`, `activeOrders`, and `topCategory` scoped to that period
2. THE Analytics_Module SHALL compute `activeOrders` as the real-time count of orders with status `pending` or `preparing`
3. THE Analytics_Module SHALL expose an endpoint returning menu items ranked by order frequency
4. THE Analytics_Module SHALL expose an endpoint returning daily revenue totals for the requested date range
5. THE Analytics_Module SHALL expose an endpoint returning crowd heatmap data as a list of `{ tableNumber, orderCount, lastActivity }` records derived from `table.activeOrderCount` and recent order timestamps
6. THE Analytics_Module SHALL use MongoDB aggregation pipelines for all aggregations and SHALL NOT perform in-memory aggregation over full collections

---

### Requirement 12: Table Administration

**User Story:** As an admin, I want to initialize and manage tables, so that the restaurant layout is correctly represented in the system.

#### Acceptance Criteria

1. WHEN an admin requests bulk table initialization, THE Table_Module SHALL create the specified tables, each with a unique `tableNumber`, a QR code, and an initial `currentSessionId`
2. WHEN an admin or waiter updates a table's status, THE Table_Module SHALL persist the new status and emit `table:status-changed` to the admin room
3. THE Table_Module SHALL expose an admin-only endpoint returning all tables with their current status, `activeOrderCount`, and `currentSessionId`

---

### Requirement 13: Payment Integration

**User Story:** As a customer, I want to pay for my order through a supported payment method, so that the transaction is recorded accurately.

#### Acceptance Criteria

1. THE Order_Module SHALL accept `paymentMethod` values of `cash`, `card`, `upi`, or `razorpay` on order placement
2. WHEN a Razorpay webhook is received, THE System SHALL verify the webhook signature before updating `paymentStatus` to `paid`
3. IF webhook signature verification fails, THEN THE System SHALL reject the webhook and leave `paymentStatus` unchanged

---

### Requirement 14: Security and Input Validation

**User Story:** As a system operator, I want all inputs validated and all routes secured, so that the system is protected against abuse and unauthorized access.

#### Acceptance Criteria

1. THE System SHALL apply Helmet.js middleware to set secure HTTP headers on all responses
2. THE System SHALL enforce CORS to allow only the configured frontend domain in production
3. THE System SHALL apply rate limiting of 10 order placements per session per 15 minutes on the order placement endpoint
4. THE System SHALL apply rate limiting of 5 login attempts per IP per 15 minutes on the authentication login endpoint
5. THE System SHALL validate all POST and PATCH request bodies using express-validator before processing
6. WHEN a request body fails validation, THE System SHALL return a 422 error with descriptive field-level error messages
7. THE System SHALL use UUID v4 for all session ID generation to ensure session tokens are not guessable
8. THE QR_Module SHALL encode only `tableNumber` and `sessionId` in QR codes and SHALL NOT include any customer personally identifiable information

---

### Requirement 15: Resilience and Error Handling

**User Story:** As a system operator, I want the system to handle failures gracefully, so that transient errors do not cause data loss or a complete outage.

#### Acceptance Criteria

1. WHEN the MongoDB connection is unavailable, THE System SHALL return a 503 error response with the message "Service temporarily unavailable."
2. THE System SHALL register a global error middleware that catches unhandled promise rejections and returns a structured error response
3. WHEN a health check endpoint is requested and the database is unreachable, THE System SHALL respond with HTTP 503 so that the hosting platform can restart the process
