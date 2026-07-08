-- =============================================================
-- RestroSewa — Workstation-aware order notifications
-- =============================================================
-- new_order notifications need to be resolvable to the order's items so an
-- alert can be routed to only the workstations that order touches. We record
-- the originating order on the notification (additive, nullable). Service
-- notifications (call_waiter / request_bill) leave it null.

alter table notifications
  add column if not exists order_id uuid references session_orders(id) on delete set null;

create index if not exists notifications_order_id_idx
  on notifications(order_id)
  where order_id is not null;
