-- =============================================================
-- CUSTOMER CREDIT ACCOUNTS
--
-- THE PROBLEM: every bill closed on credit created its OWN `credits` row with
-- its own CR-xxxxx number. A regular customer therefore accumulated several
-- "credit IDs" and no single outstanding balance. (In the live data, "sanjib"
-- already had three.)
--
-- THE FIX: mirror the vendor model. The ACCOUNT is the ledger.
--
--   credit_customers  = the customer's ONE account (CRD-00001) + running balance
--   credits           = one row per credit BILL, now belonging to an account
--   credit_payments   = money received, now against the ACCOUNT
--
-- A repayment lowers the account balance and is allocated FIFO across that
-- customer's open bills, so each bill keeps an accurate paid_amount/status and
-- the full billing + payment history survives under one Credit ID.
--
-- `credit_customers` already existed (vestigial, 0 rows, and already referenced
-- by sessions.credit_customer_id) — so it is REUSED rather than duplicated.
-- =============================================================

-- ── The account ───────────────────────────────────────────────────────────────
alter table credit_customers
  add column if not exists seq_no     int,
  add column if not exists created_by uuid references restaurant_users(id) on delete set null;

-- Number the accounts per restaurant, then make the code a generated column.
-- CRD-00001, CRD-00002, …
alter table credit_customers
  add column if not exists customer_code text
  generated always as ('CRD-' || lpad(seq_no::text, 5, '0')) stored;

-- ── Link bills and payments to the account ────────────────────────────────────
alter table credits
  add column if not exists customer_id uuid references credit_customers(id) on delete restrict;

alter table credit_payments
  add column if not exists customer_id uuid references credit_customers(id) on delete restrict;

-- A payment is now received against the ACCOUNT, then allocated across bills, so
-- it is no longer tied to exactly one bill.
alter table credit_payments alter column credit_id drop not null;

-- =============================================================
-- BACKFILL — every existing credit gets an account. No data is lost.
-- Grouping key: the PHONE when there is one (the reliable identifier), else the
-- normalised name. That is exactly how a cashier would recognise a returning
-- customer, and it is what collapses sanjib's three credit IDs into one account.
-- =============================================================

with keyed as (
  select
    c.id,
    c.restaurant_id,
    c.customer_name,
    c.customer_phone,
    c.created_at,
    coalesce(
      nullif(btrim(c.customer_phone), ''),
      'name:' || lower(btrim(c.customer_name))
    ) as match_key
  from credits c
  where c.customer_id is null
),
grouped as (
  select
    restaurant_id,
    match_key,
    -- Keep the most recently used spelling of the name.
    (array_agg(customer_name order by created_at desc))[1] as name,
    (array_agg(nullif(btrim(customer_phone), '') order by created_at desc)
       filter (where nullif(btrim(customer_phone), '') is not null))[1] as phone,
    min(created_at) as first_seen
  from keyed
  group by restaurant_id, match_key
),
numbered as (
  select
    g.*,
    -- Continue after any accounts that somehow already exist.
    coalesce(
      (select max(cc.seq_no) from credit_customers cc where cc.restaurant_id = g.restaurant_id), 0
    ) + row_number() over (partition by g.restaurant_id order by g.first_seen) as seq_no
  from grouped g
)
insert into credit_customers (restaurant_id, seq_no, name, phone, balance, is_active, created_at)
select restaurant_id, seq_no, name, phone, 0, true, first_seen
from numbered;

-- Point each bill at its account.
update credits c
   set customer_id = cc.id
  from credit_customers cc
 where c.customer_id is null
   and cc.restaurant_id = c.restaurant_id
   and cc.id = (
     select cc2.id from credit_customers cc2
      where cc2.restaurant_id = c.restaurant_id
        and coalesce(nullif(btrim(cc2.phone), ''), 'name:' || lower(btrim(cc2.name)))
          = coalesce(nullif(btrim(c.customer_phone), ''), 'name:' || lower(btrim(c.customer_name)))
      limit 1
   );

-- Payments follow their bill's account.
update credit_payments cp
   set customer_id = c.customer_id
  from credits c
 where cp.customer_id is null
   and cp.credit_id = c.id;

-- The account balance is what its bills still owe.
update credit_customers cc
   set balance = coalesce((
     select sum(c.bill_amount - c.paid_amount)
       from credits c
      where c.customer_id = cc.id
        and c.status <> 'fully_paid'
   ), 0);

-- Now that every row is backfilled, make the links mandatory.
alter table credits          alter column customer_id set not null;
alter table credit_payments  alter column customer_id set not null;
alter table credit_customers alter column seq_no      set not null;

-- ── Constraints ───────────────────────────────────────────────────────────────
alter table credit_customers
  add constraint credit_customers_restaurant_seq_key unique (restaurant_id, seq_no);

-- ONE account per phone per restaurant. Enforced in the database, so a duplicate
-- can't slip in through a race or two cashiers billing the same customer at once.
-- Names are deliberately NOT unique — real people share them.
create unique index if not exists credit_customers_restaurant_phone_key
  on credit_customers (restaurant_id, btrim(phone))
  where phone is not null and btrim(phone) <> '';

create index if not exists credit_customers_restaurant_idx on credit_customers(restaurant_id, is_active);
create index if not exists credit_customers_name_idx       on credit_customers(restaurant_id, lower(name));
create index if not exists credits_customer_idx            on credits(customer_id, created_at);
create index if not exists credit_payments_customer_idx    on credit_payments(customer_id, created_at);
