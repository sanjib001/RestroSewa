-- =============================================================
-- STAFF PIN LOGIN — lockout after repeated wrong attempts
--
-- `loginWithPin` (app/actions/auth.ts) had NO throttling at all: the 4-digit PIN
-- is checked by handing it straight to Supabase Auth (`signInWithPassword`), and
-- nothing before this stood between a person and 10,000 guesses. This adds the
-- rule: 5 wrong attempts locks that STAFF MEMBER (not the device, not the IP —
-- the `restaurant_users` row itself, since a shared till is used by several
-- people) out of PIN login for 30 minutes, after which they get another 5.
--
-- The PIN itself is never compared here — GoTrue does that, same as before. This
-- only tracks the OUTCOME of each attempt and decides whether the next one may
-- even be tried.
-- =============================================================

alter table restaurant_users
  add column if not exists pin_failed_attempts integer not null default 0,
  add column if not exists pin_locked_until    timestamptz;

comment on column restaurant_users.pin_failed_attempts is
  'Consecutive wrong PIN attempts since the last success or the last lockout. Reset to 0 on a successful login and the moment a lockout trips.';
comment on column restaurant_users.pin_locked_until is
  'NULL = not locked. Set to now() + 30 minutes the instant attempts 1..5 all fail; cleared on the next successful login. Once past, the next attempt is free to try again — read via pin_lockout_status, never compared to now() outside these functions, so the clock is always the DATABASE''s.';

-- Whether this staff member may attempt a PIN right now. Checked BEFORE calling
-- Supabase Auth at all — a locked-out person gets refused even if they happen to
-- type the right PIN, which is the point of a lockout.
create or replace function pin_lockout_status(p_restaurant_user_id uuid)
returns table (locked boolean, retry_after timestamptz)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    (pin_locked_until is not null and pin_locked_until > now()) as locked,
    pin_locked_until as retry_after
  from restaurant_users
  where id = p_restaurant_user_id;
$$;

-- Records one attempt's outcome. A success clears everything; a failure counts
-- up, and the 5th one sets the 30-minute lock AND resets the counter to 0 in the
-- same statement — so the wait, once it passes, starts a genuinely fresh set of
-- 5, not a permanently rising count.
--
-- Both branches of each CASE read `pin_failed_attempts` as it stood BEFORE this
-- statement — that is how SQL's SET list works (every expression sees the same
-- pre-update row), so there is no read-then-write race between the two columns.
create or replace function record_pin_attempt(p_restaurant_user_id uuid, p_success boolean)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_success then
    update restaurant_users
       set pin_failed_attempts = 0,
           pin_locked_until = null
     where id = p_restaurant_user_id;
    return;
  end if;

  update restaurant_users
     set pin_failed_attempts = case when pin_failed_attempts + 1 >= 5 then 0 else pin_failed_attempts + 1 end,
         pin_locked_until    = case when pin_failed_attempts + 1 >= 5 then now() + interval '30 minutes' else pin_locked_until end
   where id = p_restaurant_user_id;
end $$;

revoke all on function pin_lockout_status(uuid)         from public, anon, authenticated;
revoke all on function record_pin_attempt(uuid, boolean) from public, anon, authenticated;
grant execute on function pin_lockout_status(uuid)         to service_role;
grant execute on function record_pin_attempt(uuid, boolean) to service_role;
