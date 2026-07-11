-- =============================================================
-- REAL-TIME EVENT BUS (Postgres LISTEN/NOTIFY → server → SSE)
--
-- WHY NOT SUPABASE REALTIME FROM THE BROWSER:
-- postgres_changes delivers rows to the browser subject to RLS. Every table here
-- is RLS-on with NO policies — the browser never reads data directly; only the
-- permission-checked server actions do. Making Realtime work client-side would
-- mean adding SELECT policies for `authenticated`, which would also let ANY
-- staff member read payments / credits / vendors straight from the anon key —
-- destroying the permission split (a storekeeper must not see finance).
--
-- So the database announces only THAT something changed, never WHAT:
--
--   trigger → pg_notify('rs_events', {"r": <restaurant_id>, "t": "<topic>"})
--           → one server-side LISTEN connection
--           → SSE fan-out to the clients of that restaurant
--           → each client REFETCHES through the existing permission-checked
--             server actions, exactly as it does today.
--
-- No row data ever crosses the wire, so no RLS change and no data exposure.
-- Payloads are tiny (well under the 8000-byte NOTIFY limit) no matter how big
-- the write was.
--
-- NOTE: the listener must use the SESSION pooler (:5432). The transaction pooler
-- (:6543) silently drops cross-connection NOTIFY — verified.
-- =============================================================

-- Generic: for tables that carry restaurant_id directly. The topic is passed as
-- a trigger argument.
create or replace function rs_notify_change()
returns trigger
language plpgsql
as $$
declare
  v_restaurant uuid;
  v_topic      text := tg_argv[0];
begin
  -- On DELETE the row is in OLD; otherwise NEW.
  if tg_op = 'DELETE' then
    v_restaurant := (to_jsonb(old) ->> 'restaurant_id')::uuid;
  else
    v_restaurant := (to_jsonb(new) ->> 'restaurant_id')::uuid;
  end if;

  if v_restaurant is not null then
    perform pg_notify('rs_events',
      json_build_object('r', v_restaurant, 't', v_topic)::text);
  end if;

  return null;  -- AFTER trigger; return value is ignored
end;
$$;

-- `session_order_items` has no restaurant_id of its own — it hangs off the order.
create or replace function rs_notify_order_item()
returns trigger
language plpgsql
as $$
declare
  v_restaurant uuid;
  v_order      uuid;
begin
  v_order := coalesce(new.order_id, old.order_id);
  select so.restaurant_id into v_restaurant
    from session_orders so where so.id = v_order;

  if v_restaurant is not null then
    -- An item changing state moves the kitchen queue AND the table's status.
    perform pg_notify('rs_events', json_build_object('r', v_restaurant, 't', 'orders')::text);
    perform pg_notify('rs_events', json_build_object('r', v_restaurant, 't', 'tables')::text);
  end if;

  return null;
end;
$$;

-- ── Wire the triggers ─────────────────────────────────────────────────────────
-- Statement-level where possible: one bulk update fires ONE event, not one per
-- row. Clients refetch on any event, so per-row granularity would just be noise.

-- Tables & sessions — the reported bug: a waiter activating C1 must light up on
-- the cashier's screen instantly.
drop trigger if exists rs_ev_sessions on sessions;
create trigger rs_ev_sessions
  after insert or update or delete on sessions
  for each row execute function rs_notify_change('tables');

drop trigger if exists rs_ev_tables on restaurant_tables;
create trigger rs_ev_tables
  after insert or update or delete on restaurant_tables
  for each row execute function rs_notify_change('tables');

drop trigger if exists rs_ev_rooms on rooms;
create trigger rs_ev_rooms
  after insert or update or delete on rooms
  for each row execute function rs_notify_change('tables');

-- Orders / kitchen queue
drop trigger if exists rs_ev_orders on session_orders;
create trigger rs_ev_orders
  after insert or update or delete on session_orders
  for each row execute function rs_notify_change('orders');

drop trigger if exists rs_ev_order_items on session_order_items;
create trigger rs_ev_order_items
  after insert or update or delete on session_order_items
  for each row execute function rs_notify_order_item();

-- Notifications (waiter calls, bill requests, activation requests)
drop trigger if exists rs_ev_notifications on notifications;
create trigger rs_ev_notifications
  after insert or update or delete on notifications
  for each row execute function rs_notify_change('notifications');

-- Billing / sales
drop trigger if exists rs_ev_payments on payments;
create trigger rs_ev_payments
  after insert or update or delete on payments
  for each row execute function rs_notify_change('billing');

-- Customer credit
drop trigger if exists rs_ev_credit_customers on credit_customers;
create trigger rs_ev_credit_customers
  after insert or update or delete on credit_customers
  for each row execute function rs_notify_change('credits');

drop trigger if exists rs_ev_credits on credits;
create trigger rs_ev_credits
  after insert or update or delete on credits
  for each row execute function rs_notify_change('credits');

drop trigger if exists rs_ev_credit_payments on credit_payments;
create trigger rs_ev_credit_payments
  after insert or update or delete on credit_payments
  for each row execute function rs_notify_change('credits');

-- Stock
drop trigger if exists rs_ev_products on products;
create trigger rs_ev_products
  after insert or update or delete on products
  for each row execute function rs_notify_change('stock');

drop trigger if exists rs_ev_stock_adjustments on stock_adjustments;
create trigger rs_ev_stock_adjustments
  after insert or update or delete on stock_adjustments
  for each row execute function rs_notify_change('stock');

drop trigger if exists rs_ev_menu_item_products on menu_item_products;
create trigger rs_ev_menu_item_products
  after insert or update or delete on menu_item_products
  for each row execute function rs_notify_change('stock');

-- Purchases & vendors (these move stock AND finance)
drop trigger if exists rs_ev_purchases on purchases;
create trigger rs_ev_purchases
  after insert or update or delete on purchases
  for each row execute function rs_notify_change('purchases');

drop trigger if exists rs_ev_purchase_items on purchase_items;
create trigger rs_ev_purchase_items
  after insert or update or delete on purchase_items
  for each row execute function rs_notify_change('purchases');

drop trigger if exists rs_ev_vendors on vendors;
create trigger rs_ev_vendors
  after insert or update or delete on vendors
  for each row execute function rs_notify_change('vendors');

drop trigger if exists rs_ev_vendor_payments on vendor_payments;
create trigger rs_ev_vendor_payments
  after insert or update or delete on vendor_payments
  for each row execute function rs_notify_change('vendors');

-- Finance opening balance
drop trigger if exists rs_ev_finance_openings on finance_openings;
create trigger rs_ev_finance_openings
  after insert or update or delete on finance_openings
  for each row execute function rs_notify_change('finance');

-- Menu (availability changes the customer's menu live)
drop trigger if exists rs_ev_menu_items on menu_items;
create trigger rs_ev_menu_items
  after insert or update or delete on menu_items
  for each row execute function rs_notify_change('menu');

drop trigger if exists rs_ev_menu_categories on menu_categories;
create trigger rs_ev_menu_categories
  after insert or update or delete on menu_categories
  for each row execute function rs_notify_change('menu');
