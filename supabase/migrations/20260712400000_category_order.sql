-- =============================================================
-- MENU CATEGORY ORDER — make it real
--
-- THE BUG
-- `getMenuCategories` already ordered by `sort_order`, with `name` only as a
-- tiebreak — so on paper the admin's order was respected. In practice it never
-- was: `createCategory` never SET `sort_order`, so every category in the
-- database sat at the default 0. With every key tied, the `name` tiebreak
-- decided everything and the menu rendered ALPHABETICALLY. (Verified: all 12
-- live categories were at 0, and one restaurant's menu read "Hard Drinks, main
-- course, Soft Drinks, Starter" — precisely alphabetical.)
--
-- THE FIX
-- 1. Backfill: number the existing categories 1..n by `created_at`, per
--    restaurant, so they fall into the order the admin CREATED them — which is
--    the default the brief asks for.
-- 2. New categories append to the end (handled in `createCategory`).
-- 3. `swap_category_order` lets the admin rearrange them.
--
-- The `name` tiebreak is also dropped from the query in favour of `created_at`,
-- so even a fresh tie can never silently go alphabetical again.
-- =============================================================

with ranked as (
  select
    id,
    row_number() over (partition by restaurant_id order by created_at, id) as rn
  from menu_categories
)
update menu_categories mc
   set sort_order = ranked.rn
  from ranked
 where ranked.id = mc.id
   -- Only touch the untouched. If an admin has already arranged their menu, that
   -- arrangement is the source of truth and this migration must not stomp it.
   and mc.sort_order = 0;


-- Swap two adjacent categories in ONE transaction, so a reorder can never leave
-- the menu with a duplicated or missing position if it fails halfway.
--
-- Takes the two IDs rather than a target index: the client already knows which
-- neighbour it is swapping with, and comparing positions server-side means two
-- admins reordering at once cannot interleave into a corrupt order.
create or replace function swap_category_order(
  p_restaurant_id uuid,
  p_a             uuid,
  p_b             uuid
)
returns boolean
language plpgsql
as $$
declare
  v_a integer;
  v_b integer;
begin
  -- `for update` serialises concurrent reorders; `order by id` gives both callers
  -- the same lock order, so two admins swapping the same pair cannot deadlock.
  select sort_order into v_a
    from menu_categories
   where id = p_a and restaurant_id = p_restaurant_id
     for update;

  select sort_order into v_b
    from menu_categories
   where id = p_b and restaurant_id = p_restaurant_id
     for update;

  if v_a is null or v_b is null then
    return false;  -- not ours, or gone
  end if;

  update menu_categories set sort_order = v_b where id = p_a and restaurant_id = p_restaurant_id;
  update menu_categories set sort_order = v_a where id = p_b and restaurant_id = p_restaurant_id;

  return true;
end;
$$;

revoke all on function swap_category_order(uuid, uuid, uuid) from public;
grant execute on function swap_category_order(uuid, uuid, uuid) to service_role;
