-- Super Admin destructive operations: reset a restaurant's books, or erase the
-- restaurant entirely.
--
-- WHY THESE ARE FUNCTIONS AND NOT A LIST OF DELETES IN TYPESCRIPT
-- The Supabase JS client speaks PostgREST, and PostgREST gives one statement per
-- request with no way to open a transaction. Sixteen sequential DELETEs over
-- HTTP is sixteen chances to fail halfway and leave a restaurant that is neither
-- whole nor gone — sessions deleted but payments still pointing at them. A
-- plpgsql body is one statement from the caller's side, so it is atomic for
-- free: it either all lands or none of it does.
--
-- WHY THE DELETE ORDER IS SPELLED OUT INSTEAD OF LEANING ON `on delete cascade`
-- Almost every table cascades from `restaurants`, so `delete from restaurants`
-- looks like it should be enough. It is not, reliably. Nine foreign keys in this
-- schema are ON DELETE RESTRICT (menu_items.category_id, purchases.vendor_id,
-- room_stays.room_id, …). RESTRICT is checked immediately and cannot be
-- deferred, while Postgres fires a row's cascade triggers in an order it does
-- not promise. So if menu_categories happens to be cascaded before menu_items,
-- RESTRICT aborts the whole delete. It would work until the day it didn't.
-- Deleting children before parents by hand makes the outcome the same every run.

-- ─────────────────────────────────────────────────────────────────────────────
-- What is about to be destroyed — read before either dialog is confirmed.
--
-- Both confirmation dialogs are built from this. A warning that says "this will
-- delete your sales" is ignorable; one that says "this will delete 1,204 orders
-- and write off ₹8,300 owed by 3 customers" is not.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function restaurant_data_summary(p_restaurant_id uuid)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'restaurant', (
      select jsonb_build_object('id', r.id, 'name', r.name, 'slug', r.slug,
                                'logo_url', r.logo_url)
        from restaurants r where r.id = p_restaurant_id
    ),

    -- Cleared by BOTH operations.
    'financial', jsonb_build_object(
      'sessions',        (select count(*) from sessions          where restaurant_id = p_restaurant_id),
      'orders',          (select count(*) from session_orders    where restaurant_id = p_restaurant_id),
      'order_items',     (select count(*) from session_order_items soi
                            join session_orders so on so.id = soi.order_id
                           where so.restaurant_id = p_restaurant_id),
      'payments',        (select count(*) from payments          where restaurant_id = p_restaurant_id),
      'revenue',         (select coalesce(sum(amount), 0) from payments where restaurant_id = p_restaurant_id),
      'credits',         (select count(*) from credits           where restaurant_id = p_restaurant_id),
      'credit_payments', (select count(*) from credit_payments   where restaurant_id = p_restaurant_id),
      'purchases',       (select count(*) from purchases         where restaurant_id = p_restaurant_id),
      'vendor_payments', (select count(*) from vendor_payments   where restaurant_id = p_restaurant_id),
      'salary_payments', (select count(*) from salary_payments   where restaurant_id = p_restaurant_id),
      'stock_moves',     (select count(*) from stock_adjustments where restaurant_id = p_restaurant_id),
      'room_stays',      (select count(*) from room_stays        where restaurant_id = p_restaurant_id),
      'notifications',   (select count(*) from notifications     where restaurant_id = p_restaurant_id),
      'has_opening',     (select exists (select 1 from finance_openings where restaurant_id = p_restaurant_id))
    ),

    -- Money that OUTLIVES a finance reset, because it is carried forward onto
    -- the accounts rather than forgiven. Shown so the super admin can see that
    -- it survives — and, on a full delete, that it does not.
    'carried', jsonb_build_object(
      'customer_debt',   (select coalesce(sum(balance), 0) from credit_customers
                           where restaurant_id = p_restaurant_id and balance > 0),
      'debtors',         (select count(*) from credit_customers
                           where restaurant_id = p_restaurant_id and balance > 0),
      'vendor_payable',  (select coalesce(sum(credit_balance), 0) from vendors
                           where restaurant_id = p_restaurant_id and credit_balance > 0),
      'creditors',       (select count(*) from vendors
                           where restaurant_id = p_restaurant_id and credit_balance > 0)
    ),

    -- Survives a finance reset. Destroyed by a full delete.
    'setup', jsonb_build_object(
      'staff',            (select count(*) from restaurant_users  where restaurant_id = p_restaurant_id),
      'menu_items',       (select count(*) from menu_items        where restaurant_id = p_restaurant_id),
      'menu_categories',  (select count(*) from menu_categories   where restaurant_id = p_restaurant_id),
      'variants',         (select count(*) from menu_item_variants v
                             join menu_items mi on mi.id = v.menu_item_id
                            where mi.restaurant_id = p_restaurant_id),
      'tables',           (select count(*) from restaurant_tables where restaurant_id = p_restaurant_id),
      'table_groups',     (select count(*) from table_groups      where restaurant_id = p_restaurant_id),
      'rooms',            (select count(*) from rooms             where restaurant_id = p_restaurant_id),
      'workstations',     (select count(*) from workstations      where restaurant_id = p_restaurant_id),
      'products',         (select count(*) from products          where restaurant_id = p_restaurant_id),
      'vendors',          (select count(*) from vendors           where restaurant_id = p_restaurant_id),
      'credit_customers', (select count(*) from credit_customers  where restaurant_id = p_restaurant_id)
    )
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Reset finance & sales — clear the books, keep the restaurant.
--
-- The transactional layer goes; every piece of setup stays. The subtlety is that
-- three figures are STORED, not derived, and deleting the rows underneath them
-- would leave them floating with nothing to back them:
--
--   products.opening_stock   stock on hand = opening + purchased − used + adj.
--   vendors.credit_balance   what we still owe the supplier
--   credit_customers.balance what a diner still owes us
--
-- So each is carried forward FIRST, while the evidence for it still exists. That
-- is also just what a financial-year close does: closing becomes opening. The
-- alternative — zeroing them — would silently forgive real debt and report stock
-- that isn't on the shelf.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function reset_restaurant_finance(p_restaurant_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_before jsonb;
begin
  perform 1 from restaurants where id = p_restaurant_id;
  if not found then
    raise exception 'RESTAURANT_NOT_FOUND';
  end if;

  -- Snapshot what we are about to destroy, so the caller can report it.
  v_before := restaurant_data_summary(p_restaurant_id);

  -- ── Carry forward, BEFORE the transactions that prove these numbers go ──

  -- Closing stock becomes the new opening stock. Reading it back through
  -- stock_report, rather than re-deriving the arithmetic here, is what stops this
  -- from drifting away from the number the Stock page shows.
  --
  -- The window is deliberately unbounded. stock_report sorts each movement into
  -- `before` (created_at < from) or `within` (from ≤ created_at < to), and
  -- `closing` sums both — so any window gives the same answer EXCEPT at its own
  -- edges, where a row can fall into neither. now() is frozen to the transaction
  -- start, so a sale landing on exactly that instant would be dropped from the
  -- carry-forward and its stock silently restored. Rare, but this figure becomes
  -- the restaurant's opening stock; it has to be exactly right.
  update products p
     set opening_stock = s.closing
    from stock_report(p_restaurant_id, '-infinity'::timestamptz, 'infinity'::timestamptz) s
   where s.product_id = p.id
     and p.restaurant_id = p_restaurant_id;

  -- What we still owe each supplier becomes their opening credit. credit_balance
  -- is left alone — it is already the right number; it just needs a term to stand
  -- on once the purchases and payments are gone.
  update vendors
     set opening_credit = credit_balance
   where restaurant_id = p_restaurant_id;

  -- credit_customers.balance is ALREADY the outstanding figure and is untouched
  -- below, so the debt carries forward with no work. Payments keep working
  -- against it afterwards: record_credit_payment allocates across open bills,
  -- finds none, and still decrements the balance.

  -- ── Delete the books, children before parents ──
  delete from notifications       where restaurant_id = p_restaurant_id;
  delete from credit_payments     where restaurant_id = p_restaurant_id;
  delete from credits             where restaurant_id = p_restaurant_id;
  delete from payments            where restaurant_id = p_restaurant_id;
  delete from session_order_items
        where order_id in (select id from session_orders where restaurant_id = p_restaurant_id);
  delete from session_orders      where restaurant_id = p_restaurant_id;
  delete from sessions            where restaurant_id = p_restaurant_id;
  delete from room_charges        where restaurant_id = p_restaurant_id;
  delete from room_stays          where restaurant_id = p_restaurant_id;
  delete from purchase_items      where restaurant_id = p_restaurant_id;
  delete from purchases           where restaurant_id = p_restaurant_id;
  delete from vendor_payments     where restaurant_id = p_restaurant_id;
  delete from stock_adjustments   where restaurant_id = p_restaurant_id;
  delete from salary_payments     where restaurant_id = p_restaurant_id;

  -- The opening balance is deliberately dropped, not zeroed: the super admin is
  -- prompted for a new one, and "not set yet" is a state the Finance page
  -- already knows how to show. A 0/0 row would look like a deliberate answer.
  delete from finance_openings    where restaurant_id = p_restaurant_id;

  -- A room whose stay we just deleted is not occupied any more. Tables need no
  -- equivalent — occupancy there is the existence of an open session, and those
  -- are gone.
  update rooms
     set status = 'available'
   where restaurant_id = p_restaurant_id
     and status <> 'available';

  -- staff_payroll (joining date, salary type) and staff_salaries (the agreed
  -- monthly figure) are the employment terms, not payment history. They stay —
  -- only salary_payments, the money actually handed over, was cleared.

  return v_before;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Delete restaurant setup — erase it completely.
--
-- Returns the Auth user ids and the logo URL, because two things live OUTSIDE
-- this database and cannot be deleted from in here:
--
--   auth.users        restaurant_users.auth_user_id is ON DELETE SET NULL, so
--                     deleting the restaurant leaves every login behind, still
--                     able to authenticate. The caller finishes them off through
--                     the Auth admin API.
--   Storage           the logo file in the `restaurant-logos` bucket.
--
-- Handing the ids back rather than "just leaving them" is the difference between
-- a restaurant that is gone and one that is only invisible.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function delete_restaurant_cascade(p_restaurant_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_out jsonb;
begin
  select jsonb_build_object(
           'name',     r.name,
           'slug',     r.slug,
           'logo_url', r.logo_url,
           'summary',  restaurant_data_summary(p_restaurant_id),
           'auth_user_ids', (
             select coalesce(jsonb_agg(ru.auth_user_id), '[]'::jsonb)
               from restaurant_users ru
              where ru.restaurant_id = p_restaurant_id
                and ru.auth_user_id is not null
           )
         )
    into v_out
    from restaurants r
   where r.id = p_restaurant_id;

  if v_out is null then
    raise exception 'RESTAURANT_NOT_FOUND';
  end if;

  -- Transactions
  delete from notifications      where restaurant_id = p_restaurant_id;
  delete from credit_payments    where restaurant_id = p_restaurant_id;
  delete from credits            where restaurant_id = p_restaurant_id;
  delete from payments           where restaurant_id = p_restaurant_id;
  delete from session_order_items
        where order_id in (select id from session_orders where restaurant_id = p_restaurant_id);
  delete from session_orders     where restaurant_id = p_restaurant_id;
  delete from sessions           where restaurant_id = p_restaurant_id;

  -- Rooms: stays reference rooms with RESTRICT, rooms reference room_types with
  -- RESTRICT. Strictly bottom-up.
  delete from room_charges       where restaurant_id = p_restaurant_id;
  delete from room_stays         where restaurant_id = p_restaurant_id;
  delete from rooms              where restaurant_id = p_restaurant_id;
  delete from room_types         where restaurant_id = p_restaurant_id;

  -- Stock & suppliers: purchase_items → products is RESTRICT, purchases →
  -- vendors is RESTRICT.
  delete from purchase_items     where restaurant_id = p_restaurant_id;
  delete from purchases          where restaurant_id = p_restaurant_id;
  delete from vendor_payments    where restaurant_id = p_restaurant_id;
  delete from vendors            where restaurant_id = p_restaurant_id;
  delete from stock_adjustments  where restaurant_id = p_restaurant_id;

  -- Menu: recipe links and variants hang off menu_items; menu_items → categories
  -- and → workstations are both RESTRICT.
  delete from menu_item_products where restaurant_id = p_restaurant_id;
  delete from menu_item_addons
        where menu_item_id in (select id from menu_items where restaurant_id = p_restaurant_id);
  delete from menu_item_variants
        where menu_item_id in (select id from menu_items where restaurant_id = p_restaurant_id);
  delete from menu_items         where restaurant_id = p_restaurant_id;
  delete from menu_categories    where restaurant_id = p_restaurant_id;
  delete from products           where restaurant_id = p_restaurant_id;

  -- Credit accounts: credits/credit_payments reference these with RESTRICT and
  -- are already gone.
  delete from credit_customers   where restaurant_id = p_restaurant_id;

  -- Employment
  delete from salary_payments    where restaurant_id = p_restaurant_id;
  delete from staff_salaries     where restaurant_id = p_restaurant_id;
  delete from staff_payroll      where restaurant_id = p_restaurant_id;

  -- Staff scoping join tables, then the floor plan they scope to.
  delete from restaurant_user_tables
        where restaurant_user_id in (select id from restaurant_users where restaurant_id = p_restaurant_id);
  delete from restaurant_user_table_groups
        where restaurant_user_id in (select id from restaurant_users where restaurant_id = p_restaurant_id);
  delete from restaurant_user_workstations
        where restaurant_user_id in (select id from restaurant_users where restaurant_id = p_restaurant_id);
  delete from restaurant_user_rooms
        where restaurant_user_id in (select id from restaurant_users where restaurant_id = p_restaurant_id);
  delete from restaurant_user_room_types
        where restaurant_user_id in (select id from restaurant_users where restaurant_id = p_restaurant_id);

  delete from restaurant_tables  where restaurant_id = p_restaurant_id;
  delete from table_groups       where restaurant_id = p_restaurant_id;
  delete from workstations       where restaurant_id = p_restaurant_id;
  delete from finance_openings   where restaurant_id = p_restaurant_id;

  delete from restaurant_users   where restaurant_id = p_restaurant_id;
  delete from restaurants        where id = p_restaurant_id;

  return v_out;
end;
$$;

-- These three are reachable over HTTP through PostgREST as RPC. Nothing but the
-- service role may call them — otherwise any signed-in employee could POST to
-- /rpc/delete_restaurant_cascade and erase the business they work for.
--
-- It has to be PUBLIC that is revoked, not `anon, authenticated`. Postgres grants
-- EXECUTE on every new function to PUBLIC by default, and those two roles inherit
-- it from there — so revoking their direct grants (which they never had) removes
-- nothing at all and reads as security while providing none. Revoking PUBLIC also
-- takes it from service_role, which is why it is granted straight back: an
-- allow-list of exactly one role, rather than a deny-list that has to anticipate
-- every role Supabase might add later.
revoke all on function restaurant_data_summary(uuid)   from public;
revoke all on function reset_restaurant_finance(uuid)  from public;
revoke all on function delete_restaurant_cascade(uuid) from public;

grant execute on function restaurant_data_summary(uuid)   to service_role;
grant execute on function reset_restaurant_finance(uuid)  to service_role;
grant execute on function delete_restaurant_cascade(uuid) to service_role;
