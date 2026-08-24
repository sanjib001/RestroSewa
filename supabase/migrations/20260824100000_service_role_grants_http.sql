-- =============================================================
-- SERVICE ROLE GRANTS, PART TWO: THE `--http` HOLE
--
-- WHY THIS EXISTS: 20260801000000_service_role_grants.sql closed the "no
-- migration grants anything" hole by writing `alter default privileges`, so
-- every table a later migration creates picks up service_role privileges
-- automatically. That works — but ONLY for the role that executed it.
--
-- Default privileges are recorded PER GRANTING ROLE (pg_default_acl.defaclrole).
-- On the hosted projects migrations connect as `postgres`, so the rule was filed
-- under `postgres` and everything since has inherited correctly. The self-hosted
-- droplet has no published Postgres port, so migrations go through Kong's
-- `/pg/query` instead — and postgres-meta connects as `supabase_admin`. A table
-- created by supabase_admin matches no default-privilege rule at all:
--
--     extra_expenses         owner=postgres        service_role=arwd   ← tunnel era
--     salary_cycles          owner=supabase_admin  relacl=NULL         ← --http era
--     staff_attendance_days  owner=supabase_admin  relacl=NULL         ← --http era
--
-- The schema is complete and PostgREST cannot read it: exactly the failure the
-- earlier migration was written to prevent, re-entering through a door that did
-- not exist when it was written. Every future `--http` migration would repeat it.
--
-- The ownership half matters independently. `.env.hrestrosewa` also carries a
-- direct connection over an SSH tunnel as `postgres`, and postgres cannot
-- ALTER a relation owned by supabase_admin — so those two tables were
-- unmaintainable by half the tooling that targets that database.
--
-- Against the hosted projects this file is a NO-OP by construction: all 53
-- public relations there are already owned by postgres and already carry the
-- grants, and the `alter default privileges` re-files the rule that is already
-- on record. Verified against production before writing.
-- =============================================================

-- ── 1. Ownership ──────────────────────────────────────────────────────────────
-- Normalise anything created by another superuser back to `postgres`, so one
-- role owns the whole schema and either connection route can maintain it.
-- Skipped entirely where no `postgres` role exists.
do $$
declare
  r record;
begin
  if not exists (select 1 from pg_roles where rolname = 'postgres') then
    raise notice 'no postgres role — leaving ownership alone';
    return;
  end if;

  for r in
    select c.oid::regclass as rel
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       -- r=table, p=partitioned, v=view, m=matview. Sequences follow their
       -- owning table; ALTER TABLE is the correct spelling for all of these.
       and c.relkind in ('r', 'p', 'v', 'm')
       and pg_get_userbyid(c.relowner) <> 'postgres'
  loop
    execute format('alter table %s owner to postgres', r.rel);
    raise notice 'reassigned % to postgres', r.rel;
  end loop;
end $$;

-- ── 2. The two tables that lost their grants ──────────────────────────────────
-- Named explicitly as well as covered by the sweep below, so the intent of this
-- migration survives even if the sweep is ever narrowed.
grant select, insert, update, delete on table salary_cycles         to service_role;
grant select, insert, update, delete on table staff_attendance_days to service_role;

-- ── 3. Everything else ────────────────────────────────────────────────────────
-- Idempotent re-run of the 20260801 sweep. Catches any other relation created
-- through `--http` between that migration and this one.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;

-- ── 4. Stop it recurring ──────────────────────────────────────────────────────
-- Files the default-privilege rule under whichever role is applying this
-- migration — `supabase_admin` over Kong, `postgres` over a direct connection.
-- The 20260801 rule is left in place; a database reached both ways needs both.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

-- Deliberately NOT granted to `anon` or `authenticated`. Production lists
-- exactly two grantees across the public schema — postgres and service_role —
-- and widening that here would enlarge the blast radius of a leaked anon key
-- for no benefit. See 20260801000000_service_role_grants.sql.
