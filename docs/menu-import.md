# Importing a menu (from a photo, PDF or price list)

How to load a restaurant's whole menu into RestroSewa quickly and correctly. Written after
analysing `app/actions/menu.ts`, `lib/order-items.ts` and the menu migrations, so the traps below
are the real ones, not hypothetical.

The admin UI (`/admin/menu`) is fine for a handful of dishes. For a whole menu it is far too slow —
one form submit per item, plus one per variant. Bulk load with SQL instead.

---

## The model

```
menu_categories          (restaurant_id, name, workstation_id NOT NULL, sort_order, is_active)
   └── menu_items        (restaurant_id, category_id, workstation_id, name, price, food_type, …)
          ├── menu_item_variants  (menu_item_id, name, price, is_available, sort_order)
          └── menu_item_addons    (menu_item_id, name, price, is_required, is_available, sort_order)
```

## Five rules that will bite you

**1. A variant's price REPLACES the item's price. It is not a surcharge.**
`lib/order-items.ts` resolves the line as `price = Number(v.price)` — not `item.price + v.price`.
So *Coffee ₹100* with variants *Small ₹80 / Large ₹150* sells at exactly 80 or 150. If you enter
variant prices as differences (+0 / +50) every large coffee bills at ₹50.

**2. `menu_item_variants` has NO `restaurant_id` column.** Ownership is derived through
`menu_item_id`. Including `restaurant_id` in the insert is what made every variant insert fail
historically — the comment in `createVariant` exists for that reason.

**3. `menu_items.workstation_id` is strictly DERIVED from the category.** Two triggers
(`20260720200000_category_workstation_cascade.sql`) enforce it: a BEFORE-INSERT trigger overwrites
whatever you supply with the category's station, and changing a category's station moves every item
in it. **So set the station on the CATEGORY; never on the item.** There is no per-item override.

**4. `menu_items.has_variants` is trigger-maintained** (`rs_sync_has_variants` on
`menu_item_variants`). Never set it by hand — insert the variants and it becomes true by itself.

**5. `sort_order` decides variant display order, and 0 everywhere means alphabetical.**
Small/Medium/Large sorts as Large/Medium/Small if every row is 0. Number them explicitly.

## Other things worth knowing

- `menu_items.price` is `NOT NULL` even when the item has variants. Use the cheapest (or headline)
  variant price as the base — it is what shows before a variant is picked.
- Enums, validated by the actions: `food_type ∈ veg | non_veg | vegan | egg`;
  `availability_status ∈ available | out_of_stock | hidden`. Keep `is_available` consistent with
  `availability_status` (the UI writes `is_available = (status === 'available')`).
- `category_id` is `on delete restrict`; `menu_item_id → variants` is `on delete cascade`.
- Deleting a variant is a hard delete, but `session_order_items.variant_id` is `on delete set null`
  and name/price are snapshotted on the order row — sales history stays correct.
- At order time the variant is baked into the printed name: `"Coffee (Large)"`. KOT, bill and stock
  need no variant awareness at all.
- Items are soft-deleted (`is_deleted`), categories are not.

---

## The fast path: `scripts/import-menu.mjs`

Write the menu as JSON (copy `docs/menu-data/hotel-glasgow.json` as the template — it covers
plain items, multi-price variants and description rows), then:

```bash
node scripts/import-menu.mjs --file docs/menu-data/<name>.json --env .env.production --dry-run
node scripts/import-menu.mjs --file docs/menu-data/<name>.json --env .env.production --yes
```

It encodes all five rules below, and it is **idempotent** — existing categories/items are matched
by name and skipped, so a re-run after a partial failure resumes rather than duplicating. It never
updates or deletes: correcting a price stays a deliberate act.

The JSON keeps a record of what was loaded and why, which is worth as much as the load itself when
someone asks in six months where a price came from. Note the `_meta.database` field — fill it in and
read it back before running; it is the only thing standing between a dev import and a production one.

*First run: Hotel GlasGow In & Restaurant, 2026-08-10 — 27 categories, 195 items, 70 variants.*

The manual SQL recipe below still works and is useful for one-off fixes.

## Recipe (manual SQL)

### Step 1 — find the restaurant and its workstations

```sql
select id, name from restaurants order by name;
select id, name, ticket_code from workstations where restaurant_id = '<restaurant_id>' order by sort_order;
```

Every category needs a `workstation_id` — Kitchen for food, Bar for drinks. That single choice is
what routes the dish to the right printer, so get it right at category level.

### Step 2 — categories

```sql
insert into menu_categories (restaurant_id, name, workstation_id, sort_order, is_active)
values
  ('<restaurant_id>', 'Momo',      '<kitchen_ws_id>', 1, true),
  ('<restaurant_id>', 'Beverages', '<bar_ws_id>',     2, true)
on conflict do nothing;
```

### Step 3 — items (workstation omitted on purpose — the trigger fills it)

```sql
insert into menu_items (restaurant_id, category_id, name, description, price, food_type,
                        availability_status, is_available, sort_order)
select r.id, c.id, v.name, v.description, v.price, v.food_type, 'available', true, v.sort_order
  from (values
    ('Momo',      'Veg Momo',       'Steamed, 10 pcs', 150.00, 'veg',     1),
    ('Momo',      'Chicken Momo',   null,              200.00, 'non_veg', 2),
    ('Beverages', 'Coffee',         null,               80.00, 'veg',     1)
  ) as v(category, name, description, price, food_type, sort_order)
  join menu_categories c on c.name = v.category and c.restaurant_id = '<restaurant_id>'
  join restaurants r on r.id = '<restaurant_id>';
```

`workstation_id` is deliberately not in the column list — the BEFORE-INSERT trigger sets it from the
category. Supplying it is at best ignored and at worst misleading.

### Step 4 — variants (ABSOLUTE prices, explicit sort_order)

```sql
insert into menu_item_variants (menu_item_id, name, price, is_available, sort_order)
select i.id, v.vname, v.vprice, true, v.vsort
  from (values
    ('Coffee', 'Small',  80.00, 1),
    ('Coffee', 'Large', 150.00, 2)
  ) as v(item, vname, vprice, vsort)
  join menu_items i on i.name = v.item and i.restaurant_id = '<restaurant_id>' and not i.is_deleted;
```

Note: no `restaurant_id` column (rule 2), and `has_variants` flips itself (rule 4).

### Step 5 — verify

```sql
select c.name as category, w.name as station, i.name, i.price, i.food_type, i.has_variants,
       coalesce(string_agg(v.name || ' ' || v.price, ', ' order by v.sort_order), '—') as variants
  from menu_items i
  join menu_categories c on c.id = i.category_id
  join workstations w on w.id = i.workstation_id
  left join menu_item_variants v on v.menu_item_id = i.id
 where i.restaurant_id = '<restaurant_id>' and not i.is_deleted
 group by c.name, c.sort_order, w.name, i.name, i.price, i.food_type, i.has_variants, i.sort_order
 order by c.sort_order, i.sort_order;
```

Check: every item has the expected station; `has_variants` is true exactly where variants exist;
variant prices are **absolute**; `menu_items.price` matches the cheapest variant where relevant.

---

## Which database?

There are three, and they are NOT interchangeable — pick deliberately and say so out loud:

| Target | How to reach it |
|---|---|
| DEV (`lnhionnsqbcfiigbsokg`) | `.env.local` |
| Hosted PRODUCTION (`qsccnzgrhrnjggyymefr`) | `.env.production` — **live customers** |
| Self-hosted DO droplet | `.env.hrestrosewa`, via Kong `POST {url}/pg/query` |

For the droplet, `/pg/query` takes a **SQL string with no bind parameters**, and one request is one
connection — so a transaction cannot span requests. Put `begin … commit` inside a single request.

## Checklist

- [ ] Confirmed which restaurant **and which database**
- [ ] Categories created first, each with the right workstation
- [ ] Item prices are the real menu prices; `food_type` correct (veg/non-veg matters to guests)
- [ ] Variant prices are **absolute**, not surcharges
- [ ] `sort_order` set on categories, items and variants (never all 0)
- [ ] Verification query eyeballed against the source photo
- [ ] Item count matches the menu — nothing silently dropped by a failed join
