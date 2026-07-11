-- =============================================================
-- Finance / dashboard now read customer credit from the ACCOUNT
--
-- Outstanding customer credit is the same number either way (an account's
-- balance IS what its open bills owe), but "Pending Customers" must now count
-- CUSTOMERS, not bills — one customer with three unpaid bills is one person to
-- chase, not three.
-- =============================================================

create or replace function finance_report(
  p_restaurant_id uuid, p_from timestamptz, p_to timestamptz
)
returns table (
  opening_cash numeric, opening_online numeric,
  sales_cash numeric, sales_online numeric, sales_card numeric,
  sales_credit numeric, sales_total numeric,
  purchases_cash numeric, purchases_online numeric, purchases_credit numeric, purchases_total numeric,
  customer_credit_created numeric, customer_credit_collected numeric,
  vendor_credit_created numeric, vendor_credit_paid numeric,
  customer_credit_outstanding numeric, vendor_credit_outstanding numeric,
  pending_customers int, pending_vendors int,
  closing_cash numeric, closing_online numeric, has_opening boolean
)
language sql stable as $$
  with
  seed as (
    select coalesce(o.opening_cash,0) cash, coalesce(o.opening_online,0) online,
           coalesce(o.effective_from,'-infinity'::timestamptz) eff,
           (o.restaurant_id is not null) present
    from (select 1) _ left join finance_openings o on o.restaurant_id = p_restaurant_id
  ),
  pay as (
    select
      sum(p.cash_amount) filter (where p.created_at >= (select eff from seed) and p.created_at < p_from) cash_before,
      sum(p.online_amount + coalesce(p.card_amount,0)) filter (where p.created_at >= (select eff from seed) and p.created_at < p_from) online_before,
      sum(p.cash_amount) filter (where p.created_at >= p_from and p.created_at < p_to) cash_in,
      sum(p.online_amount) filter (where p.created_at >= p_from and p.created_at < p_to) online_in,
      sum(coalesce(p.card_amount,0)) filter (where p.created_at >= p_from and p.created_at < p_to) card_in,
      sum(coalesce(p.total_amount,p.amount)) filter (where p.created_at >= p_from and p.created_at < p_to) total_in
    from payments p where p.restaurant_id = p_restaurant_id
  ),
  crp as (
    select
      sum(cp.amount) filter (where cp.method = 'cash'  and cp.created_at >= (select eff from seed) and cp.created_at < p_from) cash_before,
      sum(cp.amount) filter (where cp.method <> 'cash' and cp.created_at >= (select eff from seed) and cp.created_at < p_from) online_before,
      sum(cp.amount) filter (where cp.method = 'cash'  and cp.created_at >= p_from and cp.created_at < p_to) cash_in,
      sum(cp.amount) filter (where cp.method <> 'cash' and cp.created_at >= p_from and cp.created_at < p_to) online_in,
      sum(cp.amount) filter (where cp.created_at >= p_from and cp.created_at < p_to) collected
    from credit_payments cp where cp.restaurant_id = p_restaurant_id
  ),
  -- Credit RAISED in the period still comes from the bills.
  cr as (
    select sum(c.bill_amount - c.down_payment) filter (where c.created_at >= p_from and c.created_at < p_to) created
    from credits c where c.restaurant_id = p_restaurant_id
  ),
  -- …but what is OWED, and by how many people, comes from the accounts.
  cust as (
    select coalesce(sum(balance),0) outstanding,
           count(*) filter (where balance > 0)::int pending
    from credit_customers where restaurant_id = p_restaurant_id
  ),
  pur as (
    select
      sum(pu.cash_amount) filter (where pu.created_at >= (select eff from seed) and pu.created_at < p_from) cash_before,
      sum(pu.online_amount) filter (where pu.created_at >= (select eff from seed) and pu.created_at < p_from) online_before,
      sum(pu.cash_amount) filter (where pu.created_at >= p_from and pu.created_at < p_to) cash_out,
      sum(pu.online_amount) filter (where pu.created_at >= p_from and pu.created_at < p_to) online_out,
      sum(pu.credit_amount) filter (where pu.created_at >= p_from and pu.created_at < p_to) credit_out,
      sum(pu.total_amount) filter (where pu.created_at >= p_from and pu.created_at < p_to) total_out
    from purchases pu where pu.restaurant_id = p_restaurant_id
  ),
  vp as (
    select
      sum(s.amount) filter (where s.method = 'cash'  and s.created_at >= (select eff from seed) and s.created_at < p_from) cash_before,
      sum(s.amount) filter (where s.method <> 'cash' and s.created_at >= (select eff from seed) and s.created_at < p_from) online_before,
      sum(s.amount) filter (where s.method = 'cash'  and s.created_at >= p_from and s.created_at < p_to) cash_out,
      sum(s.amount) filter (where s.method <> 'cash' and s.created_at >= p_from and s.created_at < p_to) online_out,
      sum(s.amount) filter (where s.created_at >= p_from and s.created_at < p_to) paid
    from vendor_payments s where s.restaurant_id = p_restaurant_id
  ),
  ven as (
    select coalesce(sum(credit_balance),0) outstanding,
           count(*) filter (where credit_balance > 0)::int pending
    from vendors where restaurant_id = p_restaurant_id
  ),
  calc as (
    select
      (select cash from seed) + coalesce((select cash_before from pay),0) + coalesce((select cash_before from crp),0)
        - coalesce((select cash_before from pur),0) - coalesce((select cash_before from vp),0) open_cash,
      (select online from seed) + coalesce((select online_before from pay),0) + coalesce((select online_before from crp),0)
        - coalesce((select online_before from pur),0) - coalesce((select online_before from vp),0) open_online
  )
  select
    calc.open_cash::numeric, calc.open_online::numeric,
    coalesce((select cash_in from pay),0)::numeric,
    coalesce((select online_in from pay),0)::numeric,
    coalesce((select card_in from pay),0)::numeric,
    coalesce((select created from cr),0)::numeric,
    coalesce((select total_in from pay),0)::numeric,
    coalesce((select cash_out from pur),0)::numeric,
    coalesce((select online_out from pur),0)::numeric,
    coalesce((select credit_out from pur),0)::numeric,
    coalesce((select total_out from pur),0)::numeric,
    coalesce((select created from cr),0)::numeric,
    coalesce((select collected from crp),0)::numeric,
    coalesce((select credit_out from pur),0)::numeric,
    coalesce((select paid from vp),0)::numeric,
    (select outstanding from cust)::numeric,
    (select outstanding from ven)::numeric,
    (select pending from cust),
    (select pending from ven),
    (calc.open_cash + coalesce((select cash_in from pay),0) + coalesce((select cash_in from crp),0)
      - coalesce((select cash_out from pur),0) - coalesce((select cash_out from vp),0))::numeric,
    (calc.open_online + coalesce((select online_in from pay),0) + coalesce((select card_in from pay),0)
      + coalesce((select online_in from crp),0)
      - coalesce((select online_out from pur),0) - coalesce((select online_out from vp),0))::numeric,
    (select present from seed)
  from calc;
$$;

revoke all on function finance_report(uuid, timestamptz, timestamptz) from public;
grant execute on function finance_report(uuid, timestamptz, timestamptz) to service_role;

-- ── dashboard_stats: customer_outstanding from the accounts ────────────────────
create or replace function dashboard_stats(
  p_restaurant_id uuid, p_from timestamptz, p_to timestamptz
)
returns table (
  inventory_value numeric, product_count int, low_count int, out_count int,
  sales_total numeric, purchases_total numeric, cogs numeric, tracked_revenue numeric,
  customer_outstanding numeric, vendor_outstanding numeric
)
language sql stable as $$
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
  cost as (
    select coalesce(sum(soi.quantity * mip.qty_per_unit * p.last_unit_cost),0) cogs
    from session_order_items soi
    join session_orders so on so.id = soi.order_id
    join menu_item_products mip on mip.menu_item_id = soi.menu_item_id
    join products p on p.id = mip.product_id
    where so.restaurant_id = p_restaurant_id
      and soi.created_at >= p_from and soi.created_at < p_to
      and soi.created_at >= mip.created_at
  ),
  revenue as (
    select coalesce(sum(soi.quantity * soi.item_price),0) tracked
    from session_order_items soi
    join session_orders so on so.id = soi.order_id
    where so.restaurant_id = p_restaurant_id
      and soi.created_at >= p_from and soi.created_at < p_to
      and exists (select 1 from menu_item_products mip
                   where mip.menu_item_id = soi.menu_item_id and soi.created_at >= mip.created_at)
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
$$;

revoke all on function dashboard_stats(uuid, timestamptz, timestamptz) from public;
grant execute on function dashboard_stats(uuid, timestamptz, timestamptz) to service_role;
