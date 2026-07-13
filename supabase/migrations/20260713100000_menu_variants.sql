-- Menu item variants: make the feature actually work.
--
-- The tables have existed since the initial schema, but nothing has ever been
-- written to them: `createVariant` and `createAddon` both insert a
-- `restaurant_id` column that does not exist on these tables, so every insert
-- has failed. (Live DB at the time of writing: 0 variants, 0 addons.) That is
-- fixed in the server actions rather than here — a variant belongs to a menu
-- item, and the menu item already carries the restaurant. Adding a second,
-- denormalised restaurant_id would be a column that can disagree with its own
-- parent, which is worse than the join it saves.
--
-- What DOES need to change here is `menu_items.has_variants`. It is a cached
-- boolean that no code has ever maintained, so it is `false` on every row —
-- including, once variants start being created, rows that have them. A flag
-- maintained by hand in three call sites is a flag that rots, so it is kept
-- honest by a trigger: whatever writes to menu_item_variants, by any path, the
-- flag follows.

create or replace function sync_menu_item_has_variants()
returns trigger
language plpgsql
as $$
declare
  v_item_id uuid;
begin
  -- On delete the row is gone from NEW; on insert/update it's gone from OLD.
  v_item_id := coalesce(new.menu_item_id, old.menu_item_id);

  update menu_items mi
     set has_variants = exists (
           select 1 from menu_item_variants v where v.menu_item_id = v_item_id
         )
   where mi.id = v_item_id;

  return null;  -- after-trigger: return value is ignored
end;
$$;

drop trigger if exists rs_sync_has_variants on menu_item_variants;

-- Statement-level would be cheaper but cannot see WHICH item changed; variant
-- writes are rare (an admin editing a menu), so row-level is the right trade.
create trigger rs_sync_has_variants
after insert or update of menu_item_id or delete on menu_item_variants
for each row execute function sync_menu_item_has_variants();

-- Bring every existing row in line with reality (all false today, but this makes
-- the migration idempotent and correct if run against a DB that already has
-- variants).
update menu_items mi
   set has_variants = exists (
         select 1 from menu_item_variants v where v.menu_item_id = mi.id
       )
 where mi.has_variants is distinct from exists (
         select 1 from menu_item_variants v where v.menu_item_id = mi.id
       );
