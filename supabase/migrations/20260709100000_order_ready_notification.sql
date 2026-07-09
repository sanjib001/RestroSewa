-- Customer-facing "order ready" alert.
-- When staff mark an order fully ready in the queue, we emit an `order_ready`
-- notification scoped to the dining session so the customer (and only that
-- customer) can be told their food is ready. Reuses the existing notifications
-- table + polling; staff-facing reads exclude this type.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'order_ready';
