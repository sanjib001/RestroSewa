-- ─────────────────────────────────────────────────────────────────────────────
-- Subscription-expiry scheduler — MANUAL, per-environment setup (NOT a migration).
--
-- Same reasoning as supabase/cron/daily-summary-cron.sql: this reads secrets
-- from Vault and needs elevated privileges, so it lives outside
-- supabase/migrations/ where scripts/migrate.mjs would otherwise run it. Run it
-- ONCE per project (dev and prod), in the Supabase SQL editor.
--
-- Prerequisites:
--   1. Deploy the app (the /api/cron/subscription-expiry route must exist).
--   2. Apply migration 20260826300000_subscription_install_date.sql.
--   3. The two Vault secrets this reuses — 'app_base_url' and 'cron_secret' —
--      already exist in any environment where daily-summary-cron.sql has been
--      run. If this is the FIRST cron job in this environment, create them the
--      same way that file documents:
--        select vault.create_secret('https://your-app.example.com', 'app_base_url');
--        select vault.create_secret('<the CRON_SECRET value>',       'cron_secret');
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Reschedule idempotently: unschedule an existing job of the same name first.
select cron.unschedule('subscription-expiry-check')
 where exists (select 1 from cron.job where jobname = 'subscription-expiry-check');

-- Once daily. Unlike the 15-minute daily-summary job (which has to land within
-- minutes of each restaurant's own closing hour), a billing lapse doesn't need
-- quarter-hour precision — being deactivated at most a day late is fine, and a
-- restaurant that renews before this next runs is never touched at all (the
-- route only ever looks at restaurants that are STILL active and STILL past
-- zero at the moment it runs).
select cron.schedule(
  'subscription-expiry-check',
  '0 3 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url')
           || '/api/cron/subscription-expiry',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Inspect / troubleshoot:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 20;
