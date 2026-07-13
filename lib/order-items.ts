// Turning a cart into order rows.
//
// Both order paths — the customer's phone and the staff POS — used to take the
// cart straight from the browser and insert `item_name`, `item_price`,
// `workstation_id` and `workstation_name` exactly as sent. The price of a dish
// was therefore whatever the client said it was: a guest with dev tools could
// order a ₹500 biryani for ₹1, and the bill, the sales report and the day's
// takings would all agree with them, because nothing downstream ever re-checked.
//
// So the cart is now a REQUEST, not a fact. The client sends only ids and
// quantities; every value that ends up on the bill is looked up here. That is
// also what makes variants safe to add — a variant changes the price, and the
// price it changes to has to come from the menu, not from the phone.
//
// The name and price are then SNAPSHOT onto the order row (the columns are
// documented as "immutable snapshots — never change after submission"). A
// variant is baked into the name at that moment — "Coffee (Large)" — which is
// why the kitchen ticket, the bill, the receipt and the sales report all show
// the variant without any of them needing to know variants exist.

export type CartRequest = {
  menu_item_id: string;
  variant_id?: string | null;
  quantity: number;
  notes?: string | null;
};

export type ResolvedOrderItem = {
  menu_item_id: string;
  variant_id: string | null;
  workstation_id: string | null;
  item_name: string;
  item_price: number;
  workstation_name: string | null;
  quantity: number;
  notes: string | null;
};

export type ResolveResult =
  | { ok: true; items: ResolvedOrderItem[] }
  | { ok: false; error: string };

const MAX_QTY = 99;

export async function resolveOrderItems(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any,
  restaurantId: string,
  cart: CartRequest[]
): Promise<ResolveResult> {
  if (!cart?.length) return { ok: false, error: "No items selected." };

  const itemIds = [...new Set(cart.map((c) => c.menu_item_id).filter(Boolean))];
  if (itemIds.length === 0) return { ok: false, error: "No items selected." };

  // Scoped to THIS restaurant, so ids belonging to another restaurant's menu
  // resolve to nothing and the order is refused rather than silently priced.
  const { data: rows } = await service
    .from("menu_items")
    .select(
      "id, name, price, is_available, availability_status, is_deleted, workstation_id, workstations ( name )"
    )
    .eq("restaurant_id", restaurantId)
    .in("id", itemIds);

  const items = new Map<string, Record<string, unknown>>();
  for (const r of (rows as Record<string, unknown>[]) ?? []) {
    items.set(r.id as string, r);
  }

  const variantIds = [
    ...new Set(cart.map((c) => c.variant_id).filter((v): v is string => Boolean(v))),
  ];
  const variants = new Map<string, Record<string, unknown>>();
  if (variantIds.length > 0) {
    const { data: vRows } = await service
      .from("menu_item_variants")
      .select("id, menu_item_id, name, price, is_available")
      .in("id", variantIds);
    for (const v of (vRows as Record<string, unknown>[]) ?? []) {
      variants.set(v.id as string, v);
    }
  }

  const resolved: ResolvedOrderItem[] = [];

  for (const line of cart) {
    const item = items.get(line.menu_item_id);
    if (!item) return { ok: false, error: "That item is no longer on the menu." };

    if (item.is_deleted || item.availability_status === "hidden") {
      return { ok: false, error: `"${item.name}" is no longer on the menu.` };
    }
    if (!item.is_available || item.availability_status !== "available") {
      return { ok: false, error: `"${item.name}" is out of stock.` };
    }

    const quantity = Math.floor(Number(line.quantity));
    if (!Number.isFinite(quantity) || quantity < 1) {
      return { ok: false, error: "Invalid quantity." };
    }
    if (quantity > MAX_QTY) {
      return { ok: false, error: `You can order at most ${MAX_QTY} of an item at a time.` };
    }

    let name = item.name as string;
    let price = Number(item.price);
    let variantId: string | null = null;

    if (line.variant_id) {
      const v = variants.get(line.variant_id);
      // A variant of a DIFFERENT dish would otherwise let someone attach the
      // cheap variant of one item to the expensive item of another.
      if (!v || v.menu_item_id !== line.menu_item_id) {
        return { ok: false, error: `Please choose an option for "${name}".` };
      }
      if (!v.is_available) {
        return { ok: false, error: `"${name} (${v.name})" is out of stock.` };
      }
      name = `${name} (${v.name})`;
      price = Number(v.price);
      variantId = v.id as string;
    }

    // The workstation comes from the menu item, never from the client — this is
    // what routes the ticket to the right kitchen station. The POS was sending
    // an empty string for `workstation_name`, so POS tickets printed with no
    // station on them; taking it from the item's relation fixes that too.
    const ws = (item.workstations as { name?: string } | null) ?? null;

    resolved.push({
      menu_item_id: line.menu_item_id,
      variant_id: variantId,
      workstation_id: (item.workstation_id as string) ?? null,
      item_name: name,
      item_price: price,
      workstation_name: ws?.name ?? null,
      quantity,
      notes: line.notes?.trim() || null,
    });
  }

  return { ok: true, items: resolved };
}
