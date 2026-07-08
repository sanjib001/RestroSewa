-- =============================================================
-- RestroSewa — Payment breakdown + split-tender + new_order alert
-- =============================================================
-- The billing flow (closeSessionWithPayment) records a split tender:
-- a cash portion, an online portion and the bill total. The Sales screen
-- reads these back. The initial schema only had a single `amount` column and
-- a payment_method enum of (cash, card, upi, other), so both the write and the
-- read were failing. This migration is purely additive.
--
-- NOTE: PostgreSQL requires ALTER TYPE ADD VALUE to be committed before the new
-- value can be used in DML. Each statement below is run in its own transaction
-- by the deploy tool, so the new enum values are usable immediately after.

-- ── payments: split-tender breakdown ────────────────────────────────────────
alter table payments
  add column if not exists cash_amount   numeric(10,2) not null default 0,
  add column if not exists online_amount numeric(10,2) not null default 0,
  add column if not exists total_amount  numeric(10,2);

-- Backfill the bill total for any pre-existing rows.
update payments set total_amount = amount where total_amount is null;

-- ── payment_method: online + mixed (split) tender ───────────────────────────
do $$ begin
  begin alter type payment_method add value 'online'; exception when duplicate_object then null; end;
  begin alter type payment_method add value 'mixed';  exception when duplicate_object then null; end;
end $$;

-- ── notification_type: new_order (customer places an order → staff alert) ─────
do $$ begin
  begin alter type notification_type add value 'new_order'; exception when duplicate_object then null; end;
end $$;
