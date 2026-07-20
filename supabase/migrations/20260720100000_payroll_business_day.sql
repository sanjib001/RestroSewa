-- =============================================================
-- payroll_summary: "today" and "this month" come from the CALLER
--
-- Two figures in this function computed their own windows:
--
--   t_tot: filter (where created_at >= date_trunc('day',   now()))
--   m_tot: filter (where created_at >= date_trunc('month', now()))
--
-- `now()` is evaluated in the DATABASE session timezone — UTC on Supabase —
-- while every other figure in the same returned row honours the p_from/p_to the
-- application computed in ITS local timezone. So `period_total` and `today_total`
-- could already disagree about what "today" meant, by the size of the offset
-- (5h45m for Nepal). That was a bug before this feature existed.
--
-- Restaurants can now also end their business day after midnight, which the
-- database has no way to know about. Rather than teach SQL about the closing
-- hour, the caller — which already knows both the timezone and the hour — passes
-- the two windows in. That kills the UTC bug and applies the business day in one
-- move, and leaves NO date arithmetic in here to drift.
--
-- The params DEFAULT to the old expressions, so the two in-database callers
-- (`finance_report`'s `owed` CTE, and this file's older copy) keep working
-- untouched, and a deploy where the migration lands before the TypeScript is
-- safe.
--
-- ⚠ WHY THIS DROPS RATHER THAN `create or replace`: adding parameters creates an
-- OVERLOAD, not a replacement. With both a 3-arg and a 5-arg-with-defaults
-- version present, every existing 3-arg call becomes ambiguous and Postgres
-- raises "function payroll_summary(uuid, timestamptz, timestamptz) is not
-- unique" — which would take out finance_report, i.e. the whole Finance page.
-- Dropping first is what keeps exactly one candidate. The old GRANTs die with
-- the old function, so they are re-issued below.
-- =============================================================

drop function if exists payroll_summary(uuid, timestamptz, timestamptz);

create function payroll_summary(
  p_restaurant_id uuid,
  p_from          timestamptz,
  p_to            timestamptz,
  p_today_from    timestamptz default null,
  p_month_from    timestamptz default null
)
returns table (
  period_salary        numeric,
  period_advance       numeric,
  period_total         numeric,
  period_cash          numeric,
  period_online        numeric,
  today_total          numeric,
  month_total          numeric,
  all_time_total       numeric,
  all_time_advance     numeric,
  outstanding_liability numeric,
  staff_on_payroll     integer
)
language sql
stable
as $$
  with
  pay as (
    select
      coalesce(sum(amount) filter (where kind = 'salary'  and created_at >= p_from and created_at < p_to), 0) p_sal,
      coalesce(sum(amount) filter (where kind = 'advance' and created_at >= p_from and created_at < p_to), 0) p_adv,
      coalesce(sum(amount) filter (where created_at >= p_from and created_at < p_to), 0)                      p_tot,
      coalesce(sum(amount) filter (where method = 'cash'   and created_at >= p_from and created_at < p_to), 0) p_cash,
      coalesce(sum(amount) filter (where method = 'online' and created_at >= p_from and created_at < p_to), 0) p_online,
      coalesce(sum(amount) filter (
        where created_at >= coalesce(p_today_from, date_trunc('day', now()))), 0)                              t_tot,
      coalesce(sum(amount) filter (
        where created_at >= coalesce(p_month_from, date_trunc('month', now()))), 0)                            m_tot,
      coalesce(sum(amount), 0)                                                                                a_tot,
      coalesce(sum(amount) filter (where kind = 'advance'), 0)                                                a_adv
    from salary_payments
    where restaurant_id = p_restaurant_id
  ),
  -- Every payroll month of every staff member, from the month they joined to the
  -- month we are in now. Left on calendar months deliberately: a payroll month is
  -- a month, not a trading day, and shifting it by a closing hour would be wrong.
  months as (
    select
      pr.restaurant_user_id,
      generate_series(
        date_trunc('month', pr.joining_date),
        date_trunc('month', now()),
        interval '1 month'
      )::date as month
    from staff_payroll pr
    join restaurant_users ru on ru.id = pr.restaurant_user_id
    where pr.restaurant_id = p_restaurant_id
      and ru.deleted_at is null
  ),
  owed as (
    select coalesce(sum(
      greatest(
        coalesce(sal.monthly_salary, 0) - coalesce(p.paid, 0),
        0
      )
    ), 0) v
    from months m
    left join lateral (
      select s.monthly_salary
        from staff_salaries s
       where s.restaurant_user_id = m.restaurant_user_id
         and s.effective_from <= m.month
       order by s.effective_from desc
       limit 1
    ) sal on true
    left join lateral (
      select coalesce(sum(sp.amount), 0) paid
        from salary_payments sp
       where sp.restaurant_user_id = m.restaurant_user_id
         and sp.restaurant_id = p_restaurant_id
         and sp.salary_month = m.month
    ) p on true
  ),
  headcount as (
    select count(*)::int v
    from staff_payroll pr
    join restaurant_users ru on ru.id = pr.restaurant_user_id
    where pr.restaurant_id = p_restaurant_id and ru.deleted_at is null and ru.is_active
  )
  select
    pay.p_sal::numeric, pay.p_adv::numeric, pay.p_tot::numeric,
    pay.p_cash::numeric, pay.p_online::numeric,
    pay.t_tot::numeric, pay.m_tot::numeric,
    pay.a_tot::numeric, pay.a_adv::numeric,
    owed.v::numeric,
    headcount.v
  from pay, owed, headcount;
$$;

revoke all on function payroll_summary(uuid, timestamptz, timestamptz, timestamptz, timestamptz) from public;
grant execute on function payroll_summary(uuid, timestamptz, timestamptz, timestamptz, timestamptz) to service_role;
