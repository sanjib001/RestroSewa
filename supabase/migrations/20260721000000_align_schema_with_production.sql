-- =============================================================
-- RECORD THE DRIFT: make the migrations produce what production actually runs
--
-- Building a second Supabase project by replaying every migration into an empty
-- database — the first time that had ever been done — proved the repo and the
-- live schema had diverged in four places. Each was applied to production by
-- hand and never written down, so a fresh project came out subtly different and
-- a straight data copy failed.
--
--   1. menu_items.badges              jsonb  → text[]
--   2. restaurant_users.permissions   jsonb  → text[]
--   3. restaurant_user_tables         missing entirely
--   4. restaurant_type enum           missing 'restaurant_hotel'
--
-- Every statement here is a NO-OP against production (which already looks like
-- this) and brings any other database into line. That is the point: it is safe
-- to run everywhere, and from now on "replay the migrations" yields the real
-- schema.
--
-- Note on 1 & 2: the app reads both with `Array.isArray(...)`, which is true for
-- a parsed jsonb array AND for a text[], so this drift never broke the product —
-- it only broke anything that moves rows between databases. That is exactly why
-- it survived unnoticed.
-- =============================================================


-- ── 1 & 2. jsonb arrays → text[] ──────────────────────────────────────────────
-- The conversion has to go through a helper: `ALTER COLUMN ... USING` rejects a
-- subquery ("cannot use subquery in transform expression"), and unpacking a
-- jsonb array needs one. A function body may contain it, so the subquery hides
-- in here and the USING clause stays a plain call.
create or replace function rs_jsonb_to_text_array(j jsonb)
returns text[]
language sql
immutable
as $$
  select case
           when j is null or jsonb_typeof(j) <> 'array' then '{}'::text[]
           else array(select jsonb_array_elements_text(j))
         end
$$;

-- Guarded on the CURRENT type so this is idempotent, and the USING clause
-- converts real data rather than assuming the table is empty.
do $$
begin
  if (select udt_name from information_schema.columns
       where table_schema = 'public' and table_name = 'menu_items'
         and column_name = 'badges') = 'jsonb' then
    alter table menu_items alter column badges drop default;
    alter table menu_items
      alter column badges type text[] using rs_jsonb_to_text_array(badges);
    alter table menu_items alter column badges set default '{}'::text[];
    alter table menu_items alter column badges set not null;
  end if;
end $$;

do $$
begin
  if (select udt_name from information_schema.columns
       where table_schema = 'public' and table_name = 'restaurant_users'
         and column_name = 'permissions') = 'jsonb' then
    alter table restaurant_users alter column permissions drop default;
    alter table restaurant_users
      alter column permissions type text[] using rs_jsonb_to_text_array(permissions);
    alter table restaurant_users alter column permissions set default '{}'::text[];
    alter table restaurant_users alter column permissions set not null;
  end if;
end $$;

drop function if exists rs_jsonb_to_text_array(jsonb);


-- ── 3. The staff→table scoping join table ─────────────────────────────────────
-- Its siblings (restaurant_user_workstations, _table_groups, _rooms, _room_types)
-- all exist in the migrations; this one only ever existed in production.
-- `delete_restaurant_cascade` already references it, so a database without it
-- would fail at restaurant deletion rather than at creation — a late, confusing
-- failure.
create table if not exists restaurant_user_tables (
  restaurant_user_id  uuid not null references restaurant_users(id) on delete cascade,
  restaurant_table_id uuid not null references restaurant_tables(id) on delete cascade,
  created_at          timestamptz not null default now(),
  primary key (restaurant_user_id, restaurant_table_id)
);

alter table restaurant_user_tables enable row level security;

-- Matches every other table here: RLS on, no policies — reachable only through
-- the service role, which is how the whole app talks to the database.
grant all on table restaurant_user_tables to service_role;


-- ── 4. The restaurant type used by hotels that also run a restaurant ──────────
alter type restaurant_type add value if not exists 'restaurant_hotel';


-- ── 5. CHECK constraints and indexes that only production had ─────────────────
-- Found by comparing constraints and indexes, not just columns — a column-level
-- diff reported the two schemas as identical while these five were still missing.
--
-- `restaurants_type_check` is the one with teeth: `restaurant_type` has seven
-- values but production only PERMITS three, so without this a dev database would
-- happily create a 'cafe' that production would reject — a difference that would
-- only surface on deploy.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'restaurants_type_check') then
    alter table restaurants add constraint restaurants_type_check
      check (type = any (array['restaurant'::restaurant_type,
                               'hotel'::restaurant_type,
                               'restaurant_hotel'::restaurant_type]));
  end if;

  -- These two columns are `text` in production, not enums; the CHECK is what
  -- constrains them.
  if not exists (select 1 from pg_constraint where conname = 'menu_items_food_type_check') then
    alter table menu_items add constraint menu_items_food_type_check
      check (food_type = any (array['veg', 'non_veg', 'vegan', 'egg']));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'menu_items_availability_status_check') then
    alter table menu_items add constraint menu_items_availability_status_check
      check (availability_status = any (array['available', 'out_of_stock', 'hidden']));
  end if;
end $$;

-- Both sides of the join get an index, matching production. Without them every
-- "which tables is this waiter assigned to" lookup is a sequential scan.
create index if not exists rut_user_idx  on restaurant_user_tables (restaurant_user_id);
create index if not exists rut_table_idx on restaurant_user_tables (restaurant_table_id);
