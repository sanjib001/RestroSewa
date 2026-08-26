-- =============================================================
-- SUBSCRIPTION — install date + bonus days
--
-- `restaurants.subscription_expires_at` has sat unused since the initial schema
-- (never read or written anywhere in the app). This replaces that dead idea with
-- two small, superadmin-editable facts instead of one derived one:
--
--   install_date              — when the restaurant went live on this system
--   subscription_extra_days   — bonus days granted on top of the standard cycle
--
-- The 365-day cycle itself is a CODE constant (lib/subscription.ts), not a
-- column — there is nothing per-restaurant about it, only the two inputs above
-- vary. Expiry and days-remaining are always computed from these two on read,
-- never stored, so there is no derived value that can drift out of sync with
-- its inputs.
-- =============================================================

alter table restaurants
  add column if not exists install_date date,
  add column if not exists subscription_extra_days integer not null default 0;

comment on column restaurants.install_date is
  'When this restaurant''s system was installed — the start of its 365-day subscription cycle (lib/subscription.ts). Superadmin-editable.';
comment on column restaurants.subscription_extra_days is
  'Bonus days granted on top of the standard 365-day cycle from install_date. Superadmin-editable, default 0.';

-- Backfill so every EXISTING restaurant has a real countdown immediately rather
-- than showing nothing until a superadmin happens to visit it. Its creation date
-- is the only honest stand-in for "when it went live" that we already have.
update restaurants set install_date = created_at::date where install_date is null;
