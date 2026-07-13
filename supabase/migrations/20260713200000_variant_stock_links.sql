-- Per-variant stock consumption.
--
-- Until now a menu item's recipe was attached to the ITEM, so every variant of it
-- consumed exactly the same thing in exactly the same quantity: a Large Coffee
-- drew down the same beans as a Small, and a Chicken Momo drew down whatever the
-- Veg Momo did. Both are wrong, and they're wrong in the two ways that matter —
-- the AMOUNT differs by size, and the PRODUCT itself differs by variety.
--
-- So a recipe line can now hang off a variant as well as an item:
--
--   menu_item_products.variant_id IS NULL  → the item's own recipe
--   menu_item_products.variant_id = <V>    → V's recipe
--
-- RESOLUTION (the whole design in one rule):
--
--   A sold line uses its VARIANT's recipe if that variant has one.
--   Otherwise it falls back to the ITEM's recipe.
--
-- Variant lines REPLACE the item's rather than adding to them. Additive would be
-- more expressive, but it would silently double-deduct the existing links the
-- moment anyone added their first variant line — every restaurant already has
-- item-level recipes, and none of them are expecting a second helping. Override
-- means today's numbers do not move until you deliberately give a variant its own
-- recipe, and then only for that variant.
--
-- The rule is stated exactly once, in the `order_item_consumption` view below.
-- It used to be a `join menu_item_products` repeated at six sites across three
-- functions; six copies of a rule is six chances to drift.

-- ── Schema ───────────────────────────────────────────────────────────────────

alter table menu_item_products
  add column if not exists variant_id uuid
    references menu_item_variants(id) on delete cascade;

-- One line per (target, product). The target is the variant when there is one and
-- the item otherwise — so a product can appear once on the item AND once on each
-- variant, but never twice on the same target.
--
-- Two partial indexes rather than one over `coalesce(variant_id, …)`: they say
-- what they mean, and a NULL variant_id is genuinely a different kind of row, not
-- a missing value to be papered over.
alter table menu_item_products drop constraint if exists menu_item_products_pair_key;

create unique index if not exists menu_item_products_item_pair_key
  on menu_item_products (menu_item_id, product_id)
  where variant_id is null;

create unique index if not exists menu_item_products_variant_pair_key
  on menu_item_products (variant_id, product_id)
  where variant_id is not null;

create index if not exists menu_item_products_variant_idx
  on menu_item_products (variant_id);

-- A variant line must belong to a variant OF THAT ITEM. Without this you could
-- attach the Large Coffee recipe to a Pizza and the numbers would quietly rot.
create or replace function menu_item_products_variant_matches_item()
returns trigger
language plpgsql
as $$
begin
  if new.variant_id is not null then
    if not exists (
      select 1 from menu_item_variants v
       where v.id = new.variant_id
         and v.menu_item_id = new.menu_item_id
    ) then
      raise exception 'VARIANT_NOT_OF_ITEM';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists rs_mip_variant_matches_item on menu_item_products;
create trigger rs_mip_variant_matches_item
before insert or update on menu_item_products
for each row execute function menu_item_products_variant_matches_item();

-- ── The rule ─────────────────────────────────────────────────────────────────

-- One row per (sold line × product it consumes), with the quantity already
-- multiplied out. Everything downstream — stock levels, history, COGS — reads
-- consumption from here and never has to know that variants exist.
create or replace view order_item_consumption as
select
  soi.id            as order_item_id,
  soi.order_id,
  so.restaurant_id,
  so.created_by,
  soi.menu_item_id,
  soi.variant_id,
  soi.item_name,
  soi.created_at,
  soi.cancelled_at,
  soi.cancel_reason,
  soi.cancelled_by,
  mip.product_id,
  mip.qty_per_unit,
  soi.quantity,
  (soi.quantity * mip.qty_per_unit)::numeric as qty
from session_order_items soi
join session_orders so on so.id = soi.order_id
join menu_item_products mip
  on mip.menu_item_id = soi.menu_item_id
 -- Load-bearing, and inherited from the old joins: a menu item usually has sales
 -- history predating its recipe. Without this, adding a link would retroactively
 -- deduct EVERY past sale and drive stock negative on day one.
 and soi.created_at >= mip.created_at
 and (
   -- The variant's own recipe…
   mip.variant_id = soi.variant_id
   or (
     -- …or the item's, but only where the variant has no recipe of its own.
     -- The created_at guard is repeated here on purpose: a variant recipe added
     -- TODAY must not retroactively displace the item recipe that priced
     -- yesterday's sales. Old orders keep resolving exactly as they did.
     mip.variant_id is null
     and not exists (
       select 1
         from menu_item_products v
        where v.menu_item_id = soi.menu_item_id
          and v.variant_id   = soi.variant_id
          and soi.created_at >= v.created_at
     )
   )
 );

-- The view must not become a hole in the deny-by-default wall: a plain view runs
-- as its OWNER, which would let the browser read order lines straight out of
-- PostgREST, bypassing the RLS on the tables underneath it. `security_invoker`
-- makes it run as the CALLER instead, so the browser gets nothing and the
-- service role (which bypasses RLS) still sees everything.
alter view order_item_consumption set (security_invoker = on);
revoke all on order_item_consumption from anon, authenticated;

-- ── The three readers, now going through the view ────────────────────────────

create or replace function stock_report(
  p_restaurant_id uuid,
  p_from          timestamptz,
  p_to            timestamptz
)
returns table (
  product_id  uuid,
  opening     numeric,
  purchased   numeric,
  used_pos    numeric,
  used_manual numeric,
  used        numeric,
  reversed    numeric,
  added       numeric,
  closing     numeric
)
language sql
stable
as $fn$
  with
  -- POS consumption. Cancelled items are NOT excluded here — the reservation
  -- genuinely happened, and it is what the release below cancels out.
  usage as (
    select
      c.product_id,
      sum(c.qty) filter (where c.created_at < p_from)                          as before,
      sum(c.qty) filter (where c.created_at >= p_from and c.created_at < p_to) as within
    from order_item_consumption c
    where c.restaurant_id = p_restaurant_id
    group by c.product_id
  ),
  -- The release: stock coming back because the item was rejected, force closed or
  -- cancelled. Dated by `cancelled_at` — when it came back — not `created_at`.
  --
  -- `reversed` and `returned` are the same event, split by WHICH DAY the use it
  -- reverses belongs to. Same day ⇒ it cancels that use out of `used`. Earlier day
  -- ⇒ that day is settled, so today just gains the stock back.
  release as (
    select
      c.product_id,
      sum(c.qty) filter (where c.cancelled_at < p_from)                       as before,
      sum(c.qty) filter (where c.cancelled_at >= p_from and c.cancelled_at < p_to
                           and c.created_at   >= p_from)                      as reversed,
      sum(c.qty) filter (where c.cancelled_at >= p_from and c.cancelled_at < p_to
                           and c.created_at   <  p_from)                      as returned
    from order_item_consumption c
    where c.restaurant_id = p_restaurant_id
      and c.cancelled_at is not null
    group by c.product_id
  ),
  purch as (
    select
      pi.product_id,
      sum(pi.quantity) filter (where pu.created_at < p_from)                           as before,
      sum(pi.quantity) filter (where pu.created_at >= p_from and pu.created_at < p_to) as within
    from purchase_items pi
    join purchases pu on pu.id = pi.purchase_id
    where pu.restaurant_id = p_restaurant_id
    group by pi.product_id
  ),
  -- Manual movements, split by direction rather than netted, so a +5 correction
  -- cannot cancel a −5 wastage and report "nothing used today".
  adj as (
    select
      a.product_id,
      sum(a.qty) filter (where a.created_at < p_from)                                        as net_before,
      sum(-a.qty) filter (where a.qty < 0 and a.created_at >= p_from and a.created_at < p_to) as out_within,
      sum(a.qty)  filter (where a.qty > 0 and a.created_at >= p_from and a.created_at < p_to) as in_within
    from stock_adjustments a
    where a.restaurant_id = p_restaurant_id
    group by a.product_id
  )
  select
    p.id,
    -- Opening = stock on hand the instant the window began. Today's opening IS
    -- yesterday's closing, so the rollover needs no nightly job.
    (p.opening_stock
       + coalesce(pu.before, 0)
       - coalesce(u.before, 0)
       + coalesce(rl.before, 0)
       + coalesce(a.net_before, 0))::numeric                        as opening,
    coalesce(pu.within, 0)::numeric                                 as purchased,
    -- NET POS consumption. `reversed` is a subset of `usage.within` — same view,
    -- same guard, and a row can only be cancelled at or after it was created — so
    -- this can never go negative.
    (coalesce(u.within, 0) - coalesce(rl.reversed, 0))::numeric     as used_pos,
    coalesce(a.out_within, 0)::numeric                              as used_manual,
    (coalesce(u.within, 0) - coalesce(rl.reversed, 0)
       + coalesce(a.out_within, 0))::numeric                        as used,
    coalesce(rl.reversed, 0)::numeric                               as reversed,
    -- Put back: corrections by hand, plus reservations from a CLOSED day released
    -- today. Same-day releases are not here — they cancelled a use instead.
    (coalesce(a.in_within, 0) + coalesce(rl.returned, 0))::numeric  as added,
    -- Every leg still lands exactly once, so
    --   closing = opening + purchased − used + added
    -- reconciles whichever bucket a release fell into.
    (p.opening_stock
       + coalesce(pu.before, 0)  + coalesce(pu.within, 0)
       - coalesce(u.before, 0)   - coalesce(u.within, 0)
       + coalesce(rl.before, 0)  + coalesce(rl.reversed, 0) + coalesce(rl.returned, 0)
       + coalesce(a.net_before, 0)
       - coalesce(a.out_within, 0) + coalesce(a.in_within, 0))::numeric as closing
  from products p
  left join usage u    on u.product_id  = p.id
  left join release rl on rl.product_id = p.id
  left join purch pu   on pu.product_id = p.id
  left join adj a      on a.product_id  = p.id
  where p.restaurant_id = p_restaurant_id;
$fn$;

create or replace function product_history(
  p_restaurant_id uuid,
  p_product_id    uuid
)
returns table (
  at          timestamptz,
  kind        text,
  qty         numeric,
  reason      text,
  ref         text,
  vendor_name text,
  vendor_code text,
  amount      numeric,
  method      text,
  staff_id    uuid,
  balance     numeric
)
language sql
stable
as $fn$
  with moves as (
    select
      p.created_at    as at,
      'opening'::text as kind,
      p.opening_stock as qty,
      null::text      as reason,
      null::text      as ref,
      null::text      as vendor_name,
      null::text      as vendor_code,
      null::numeric   as amount,
      null::text      as method,
      p.created_by    as staff_id,
      0               as tiebreak
    from products p
    where p.id = p_product_id and p.restaurant_id = p_restaurant_id

    union all

    select
      pu.created_at,
      'purchase',
      pi.quantity,
      null,
      pu.purchase_code,
      v.name,
      v.vendor_code,
      pi.line_total,
      pu.payment_method::text,
      pu.created_by,
      1
    from purchase_items pi
    join purchases pu on pu.id = pi.purchase_id
    join vendors v    on v.id = pu.vendor_id
    where pi.product_id = p_product_id
      and pu.restaurant_id = p_restaurant_id

    union all

    -- The reservation, at the moment the customer ordered. `ref` is the sold
    -- line's snapshot name, so a variant reads as "Momo (Chicken)" here — the
    -- history says which variant drew the stock down.
    select
      c.created_at,
      'sale',
      -c.qty,
      null,
      c.item_name,
      null, null, null, null,
      c.created_by,
      2
    from order_item_consumption c
    where c.product_id = p_product_id
      and c.restaurant_id = p_restaurant_id

    union all

    -- The release, at the moment it was cancelled. `reason` says why, and the
    -- tiebreak keeps it after its own sale if both land on the same instant.
    select
      c.cancelled_at,
      'restore',
      c.qty,
      c.cancel_reason,
      c.item_name,
      null, null, null, null,
      c.cancelled_by,
      4
    from order_item_consumption c
    where c.product_id = p_product_id
      and c.restaurant_id = p_restaurant_id
      and c.cancelled_at is not null

    union all

    select
      a.created_at,
      'manual',
      a.qty,
      a.kind,
      null,
      null, null, null, null,
      a.created_by,
      3
    from stock_adjustments a
    where a.product_id = p_product_id
      and a.restaurant_id = p_restaurant_id
  )
  select
    m.at, m.kind, m.qty, m.reason, m.ref,
    m.vendor_name, m.vendor_code, m.amount, m.method, m.staff_id,
    sum(m.qty) over (order by m.at, m.tiebreak, m.kind
                     rows between unbounded preceding and current row)::numeric
  from moves m
  order by m.at, m.tiebreak, m.kind;
$fn$;

create or replace function dashboard_stats(
  p_restaurant_id uuid,
  p_from          timestamptz,
  p_to            timestamptz
)
returns table (
  inventory_value      numeric,
  product_count        int,
  low_count            int,
  out_count            int,
  sales_total          numeric,
  purchases_total      numeric,
  cogs                 numeric,
  tracked_revenue      numeric,
  customer_outstanding numeric,
  vendor_outstanding   numeric
)
language sql
stable
as $fn$
  with
  sr as (
    select s.closing, p.last_unit_cost, p.low_stock_threshold
    from stock_report(p_restaurant_id, p_from, p_to) s
    join products p on p.id = s.product_id where p.is_active
  ),
  stock as (
    select coalesce(sum(greatest(closing,0) * last_unit_cost),0) value,
           count(*)::int products,
           count(*) filter (where closing > 0 and low_stock_threshold > 0 and closing <= low_stock_threshold)::int low,
           count(*) filter (where closing <= 0)::int out
    from sr
  ),
  -- COGS. A Large Coffee now costs what a Large Coffee actually consumes, so the
  -- margin on it stops being a guess.
  cost as (
    select coalesce(sum(c.qty * p.last_unit_cost),0) cogs
    from order_item_consumption c
    join products p on p.id = c.product_id
    where c.restaurant_id = p_restaurant_id
      and c.created_at >= p_from and c.created_at < p_to
      -- The test is not "was it ever cancelled" but "was it still live when this
      -- window closed" — otherwise cancelling today would shrink yesterday's COGS.
      and (c.cancelled_at is null or c.cancelled_at >= p_to)
  ),
  -- Revenue from lines that DO deduct stock, so margin compares like with like.
  -- `exists` against the view, not the table: an item whose only recipes live on
  -- its variants is still stock-tracked, and joining the view directly would
  -- multiply the revenue by the number of ingredients.
  revenue as (
    select coalesce(sum(soi.quantity * soi.item_price),0) tracked
    from session_order_items soi
    join session_orders so on so.id = soi.order_id
    where so.restaurant_id = p_restaurant_id
      and soi.created_at >= p_from and soi.created_at < p_to
      and (soi.cancelled_at is null or soi.cancelled_at >= p_to)
      and exists (select 1 from order_item_consumption c where c.order_item_id = soi.id)
  ),
  sales as (
    select coalesce(sum(coalesce(total_amount, amount)),0) v from payments
    where restaurant_id = p_restaurant_id and created_at >= p_from and created_at < p_to
  ),
  purch as (
    select coalesce(sum(total_amount),0) v from purchases
    where restaurant_id = p_restaurant_id and created_at >= p_from and created_at < p_to
  ),
  cust as (
    select coalesce(sum(balance),0) v from credit_customers where restaurant_id = p_restaurant_id
  ),
  ven as (
    select coalesce(sum(credit_balance),0) v from vendors where restaurant_id = p_restaurant_id
  )
  select stock.value::numeric, stock.products, stock.low, stock.out,
         sales.v::numeric, purch.v::numeric, cost.cogs::numeric, revenue.tracked::numeric,
         cust.v::numeric, ven.v::numeric
  from stock, cost, revenue, sales, purch, cust, ven;
$fn$;
