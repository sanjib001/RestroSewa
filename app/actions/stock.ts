"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { STOCK_ACCESS } from "@/lib/permissions";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";
import { dayBounds, stockStatus, CAN_ADD_STOCK } from "@/lib/stock";
import type { StockMovement, StockStatus } from "@/lib/stock";

export type ActionResult = { error: string } | null;

// ─── Types ────────────────────────────────────────────────────────────────────

export type StockRow = {
  id: string;
  product_code: string;
  name: string;
  unit: string;
  low_stock_threshold: number;
  last_unit_cost: number;
  is_active: boolean;
  /** Stock at the start of the selected day (= previous day's final stock). */
  opening: number;
  purchased: number;
  /** Sold through the POS, NET of reservations released the same day. */
  used_pos: number;
  /** Taken out by hand: kitchen usage, waste, damage, staff meals. */
  used_manual: number;
  /** Actually consumed today = used_pos + manual. A rejected or cancelled order
   *  is not consumption, so it does not appear here. */
  used: number;
  /** Reservations placed today and released today (rejected / force closed /
   *  cancelled). Already netted out of `used_pos` — kept separately so the
   *  breakdown can show the sale and its reversal as two honest lines. */
  reversed: number;
  /** Put BACK: manual corrections, plus reservations from an EARLIER day released
   *  today. Kept apart from `used` so a +5 correction can't cancel a −5 wastage
   *  and report "nothing used today". */
  added: number;
  /** Final stock = opening + purchased − used + added. */
  closing: number;
  status: StockStatus;
  /** How many menu items sell this product. 0 ⇒ nothing will ever deduct it. */
  link_count: number;
};

export type StockSummary = {
  productCount: number;
  lowCount: number;
  outCount: number;
  /** Closing stock valued at each product's last purchase price. */
  inventoryValue: number;
  /** Menu items with no product link — their sales deduct nothing. */
  unlinkedMenuItems: number;
};

export type StockFilter = "all" | "low" | "out" | "inactive";

export type ProductLink = {
  link_id: string;
  menu_item_id: string;
  menu_item_name: string;
  /** Null when the line belongs to the item itself rather than one of its variants. */
  variant_id: string | null;
  variant_name: string | null;
  qty_per_unit: number;
};

export type ProductDetail = StockRow & {
  created_at: string;
  /** Every menu item — or variant of one — that consumes this product. */
  links: ProductLink[];
};

export type RecipeLine = {
  link_id: string;
  product_id: string;
  product_name: string;
  unit: string;
  qty_per_unit: number;
};

/**
 * A menu item, its recipe, and the recipes of any variants that have their own.
 *
 * The resolution rule (mirrored exactly in the `order_item_consumption` view, and
 * that view is the one that actually decides): a sold line uses its VARIANT's
 * recipe when the variant has one, and the item's recipe otherwise. A variant
 * recipe REPLACES the item's — it does not add to it.
 */
export type MenuItemLink = {
  menu_item_id: string;
  menu_item_name: string;
  /** The item's own recipe. Applies to every variant that doesn't override it. */
  base: RecipeLine[];
  variants: {
    variant_id: string;
    variant_name: string;
    /** True when this variant has its own lines, so `base` does NOT apply to it. */
    overrides: boolean;
    products: RecipeLine[];
  }[];
};

/** A thing a product can be attached to: a menu item, or one variant of one. */
export type LinkTarget = {
  menu_item_id: string;
  variant_id: string | null;
  /** "Momo" or "Momo · Chicken" */
  label: string;
};

function sanitizeSearch(raw: string): string {
  return raw.replace(/[,()*%\\]/g, " ").trim().slice(0, 60);
}

const RPC_ERRORS: Record<string, string> = {
  PRODUCT_EXISTS: "A product with this name already exists. Use that one instead of creating a second.",
  NAME_REQUIRED: "Enter the product name.",
  UNIT_REQUIRED: "Enter a unit (bottle, kg, litre…).",
  INVALID_OPENING_STOCK: "Opening stock cannot be negative.",
  INVALID_LOW_STOCK: "The low-stock level cannot be negative.",
};

function rpcError(message: string, fallback: string): string {
  for (const [code, text] of Object.entries(RPC_ERRORS)) {
    if (message.includes(code)) return text;
  }
  return fallback;
}

// ─── Stock list for a given day ───────────────────────────────────────────────
// Every figure comes from `stock_report`, which derives them from the POS, the
// purchase ledger and adjustments — so "Used Today" needs no manual deduction and
// "Yesterday's Stock" needs no nightly rollover job.

export async function getStock(params?: {
  search?: string | null;
  filter?: StockFilter;
  /** Calendar day (YYYY-MM-DD). Defaults to today. */
  day?: string | null;
}): Promise<StockRow[]> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canViewStock(ru)) return [];

  const service = createServiceClient();
  const { from, to } = dayBounds(params?.day ?? null, ru.closingHour);

  const [productsRes, reportRes, linksRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("products")
      .select("id, product_code, name, unit, low_stock_threshold, last_unit_cost, is_active")
      .eq("restaurant_id", ru.restaurant_id),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).rpc("stock_report", {
      p_restaurant_id: ru.restaurant_id,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("menu_item_products")
      .select("product_id")
      .eq("restaurant_id", ru.restaurant_id),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const report = new Map<string, any>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((reportRes.data ?? []) as any[]).map((r) => [r.product_id, r])
  );

  const linkCount = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const l of (linksRes.data ?? []) as any[]) {
    linkCount.set(l.product_id, (linkCount.get(l.product_id) ?? 0) + 1);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rows: StockRow[] = ((productsRes.data ?? []) as any[]).map((p) => {
    const r = report.get(p.id);
    const closing = Number(r?.closing ?? 0);
    const threshold = Number(p.low_stock_threshold);
    return {
      id: p.id,
      product_code: p.product_code,
      name: p.name,
      unit: p.unit,
      low_stock_threshold: threshold,
      last_unit_cost: Number(p.last_unit_cost),
      is_active: p.is_active,
      opening: Number(r?.opening ?? 0),
      purchased: Number(r?.purchased ?? 0),
      used_pos: Number(r?.used_pos ?? 0),
      used_manual: Number(r?.used_manual ?? 0),
      used: Number(r?.used ?? 0),
      reversed: Number(r?.reversed ?? 0),
      added: Number(r?.added ?? 0),
      closing,
      status: stockStatus(closing, threshold),
      link_count: linkCount.get(p.id) ?? 0,
    };
  });

  const filter = params?.filter ?? "all";
  if (filter === "inactive") rows = rows.filter((p) => !p.is_active);
  else {
    rows = rows.filter((p) => p.is_active);
    if (filter === "low") rows = rows.filter((p) => p.status === "low");
    else if (filter === "out") rows = rows.filter((p) => p.status === "out");
  }

  const search = sanitizeSearch(params?.search ?? "");
  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.product_code.toLowerCase().includes(q) ||
        p.unit.toLowerCase().includes(q)
    );
  }

  // Anything needing attention first (out, then low), then alphabetical.
  const rank: Record<StockStatus, number> = { out: 0, low: 1, ok: 2 };
  return rows.sort(
    (a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name)
  );
}

export async function getStockSummary(day?: string | null): Promise<StockSummary> {
  const ru = await getRestaurantUser();
  const empty: StockSummary = {
    productCount: 0,
    lowCount: 0,
    outCount: 0,
    inventoryValue: 0,
    unlinkedMenuItems: 0,
  };
  if (!STOCK_ACCESS.canViewStock(ru)) return empty;

  const rows = await getStock({ day: day ?? null, filter: "all" });

  const service = createServiceClient();
  const [menuRes, linkRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("menu_items")
      .select("id")
      .eq("restaurant_id", ru.restaurant_id)
      .not("is_deleted", "is", true),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("menu_item_products")
      .select("menu_item_id")
      .eq("restaurant_id", ru.restaurant_id),
  ]);

  const linked = new Set(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((linkRes.data ?? []) as any[]).map((l) => l.menu_item_id)
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const menuItems = (menuRes.data ?? []) as any[];

  const summary: StockSummary = {
    productCount: rows.length,
    lowCount: rows.filter((r) => r.status === "low").length,
    outCount: rows.filter((r) => r.status === "out").length,
    // Value what's actually on the shelf, at what it last cost to buy.
    inventoryValue: rows.reduce(
      (sum, r) => sum + Math.max(0, r.closing) * r.last_unit_cost,
      0
    ),
    unlinkedMenuItems: menuItems.filter((m) => !linked.has(m.id)).length,
  };
  return summary;
}

// ─── Product detail ───────────────────────────────────────────────────────────

export async function getProductDetail(
  productId: string,
  day?: string | null
): Promise<ProductDetail | { error: string }> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canViewStock(ru)) {
    return { error: "You don't have permission to view stock." };
  }

  const rows = await getStock({ day: day ?? null, filter: "all" });
  let row = rows.find((r) => r.id === productId);
  if (!row) {
    // Inactive products are filtered out of "all" — fetch it explicitly.
    const inactive = await getStock({ day: day ?? null, filter: "inactive" });
    row = inactive.find((r) => r.id === productId);
  }
  if (!row) return { error: "Product not found." };

  const service = createServiceClient();
  const [prodRes, linkRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("products")
      .select("created_at")
      .eq("id", productId)
      .eq("restaurant_id", ru.restaurant_id)
      .maybeSingle(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("menu_item_products")
      .select(
        "id, menu_item_id, variant_id, qty_per_unit, menu_items ( name ), menu_item_variants ( name )"
      )
      .eq("product_id", productId)
      .eq("restaurant_id", ru.restaurant_id),
  ]);

  return {
    ...row,
    created_at: prodRes.data?.created_at ?? new Date().toISOString(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    links: ((linkRes.data ?? []) as any[])
      .map((l) => ({
        link_id: l.id,
        menu_item_id: l.menu_item_id,
        menu_item_name: l.menu_items?.name ?? "—",
        variant_id: l.variant_id ?? null,
        variant_name: l.menu_item_variants?.name ?? null,
        qty_per_unit: Number(l.qty_per_unit),
      }))
      // Group each item's lines together, its own recipe ahead of its variants'.
      .sort(
        (a, b) =>
          a.menu_item_name.localeCompare(b.menu_item_name) ||
          (a.variant_name ?? "").localeCompare(b.variant_name ?? "")
      ),
  };
}

// ─── Product history ──────────────────────────────────────────────────────────
// Every movement of one product — opening count, purchases, POS sales and manual
// deductions — with a running balance. Assembled by `product_history` from where
// that data already lives, so the final balance always equals the stock level.

export async function getProductHistory(
  productId: string
): Promise<StockMovement[]> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canViewStock(ru)) return [];

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any).rpc("product_history", {
    p_restaurant_id: ru.restaurant_id, // tenant scope enforced inside the function
    p_product_id: productId,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const staffIds = [...new Set(rows.map((m) => m.staff_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (staffIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: users } = await (service as any)
      .from("restaurant_users")
      .select("id, display_name")
      .in("id", staffIds);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const u of (users ?? []) as any[]) names.set(u.id, u.display_name);
  }

  // The function returns oldest-first so the running balance accumulates
  // correctly; the screen reads newest-first.
  return rows
    .map((m) => ({
      at: m.at,
      kind: m.kind,
      qty: Number(m.qty),
      reason: m.reason ?? null,
      ref: m.ref ?? null,
      // Present only on purchases — who it came from, what it cost, how it was paid.
      vendor_name: m.vendor_name ?? null,
      vendor_code: m.vendor_code ?? null,
      amount: m.amount == null ? null : Number(m.amount),
      method: m.method ?? null,
      staff_name: m.staff_id ? names.get(m.staff_id) ?? null : null,
      balance: Number(m.balance),
    }))
    .reverse();
}

// ─── Create / update / (de)activate ───────────────────────────────────────────

export async function createProduct(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canManageStock(ru)) {
    return { error: "You don't have permission to manage stock." };
  }

  const name = ((formData.get("name") as string) || "").trim();
  const unit = ((formData.get("unit") as string) || "").trim();
  const openingRaw = (formData.get("opening_stock") as string) || "";
  const lowRaw = (formData.get("low_stock_threshold") as string) || "";
  const opening = openingRaw === "" ? 0 : parseFloat(openingRaw);
  const low = lowRaw === "" ? 0 : parseFloat(lowRaw);

  if (!name) return { error: "Enter the product name." };
  if (!unit) return { error: "Enter a unit (bottle, kg, litre…)." };
  if (isNaN(opening) || opening < 0) return { error: "Opening stock must be zero or more." };
  if (isNaN(low) || low < 0) return { error: "The low-stock level must be zero or more." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("create_product", {
    p_restaurant_id: ru.restaurant_id,
    p_name: name,
    p_unit: unit,
    p_opening_stock: opening,
    p_low_stock: low,
    p_created_by: ru.id,
  });

  if (error) {
    return { error: rpcError(error.message ?? "", "Could not create the product. Please try again.") };
  }

  revalidatePath("/admin/stock");
  return null;
}

export async function updateProduct(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canManageStock(ru)) {
    return { error: "You don't have permission to manage stock." };
  }

  const id = formData.get("id") as string;
  const name = ((formData.get("name") as string) || "").trim();
  const unit = ((formData.get("unit") as string) || "").trim();
  const lowRaw = (formData.get("low_stock_threshold") as string) || "";
  const low = lowRaw === "" ? 0 : parseFloat(lowRaw);

  if (!id) return { error: "Product not found." };
  if (!name) return { error: "Enter the product name." };
  if (!unit) return { error: "Enter a unit." };
  if (isNaN(low) || low < 0) return { error: "The low-stock level must be zero or more." };

  const service = createServiceClient();
  // Opening stock is deliberately NOT editable — changing it would silently
  // rewrite every historical stock figure. Corrections go through an adjustment,
  // which leaves an audit trail.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("products")
    .update({ name, unit, low_stock_threshold: low })
    .eq("id", id)
    .eq("restaurant_id", ru.restaurant_id);

  if (error) {
    if (error.code === "23505") return { error: "Another product already uses this name." };
    return { error: "Could not update the product. Please try again." };
  }

  revalidatePath("/admin/stock");
  return null;
}

export async function setProductActive(
  productId: string,
  isActive: boolean
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canManageStock(ru)) {
    return { error: "You don't have permission to manage stock." };
  }

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("products")
    .update({ is_active: isActive })
    .eq("id", productId)
    .eq("restaurant_id", ru.restaurant_id);

  if (error) return { error: "Could not update the product. Please try again." };

  revalidatePath("/admin/stock");
  return null;
}

// ─── Adjust stock (correction / wastage) ──────────────────────────────────────

const REASONS = new Set([
  "kitchen_usage",
  "waste",
  "damage",
  "staff_consumption",
  "adjustment",
  "other",
]);

export async function adjustStock(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canManageStock(ru)) {
    return { error: "You don't have permission to adjust stock." };
  }

  const productId = formData.get("product_id") as string;
  const kind = ((formData.get("kind") as string) || "kitchen_usage").toLowerCase();
  const direction = (formData.get("direction") as string) || "remove";
  const magnitude = parseFloat(formData.get("qty") as string);
  const notes = ((formData.get("notes") as string) || "").trim();

  if (!productId) return { error: "Product not found." };
  if (!REASONS.has(kind)) return { error: "Choose a reason." };
  if (isNaN(magnitude) || magnitude <= 0) {
    return { error: "Enter a quantity greater than zero." };
  }

  // Every reason consumes stock. Only a correction may put stock back, and only
  // when the admin explicitly asks for it — so a mis-picked reason can never
  // silently ADD stock.
  const qty =
    CAN_ADD_STOCK(kind) && direction === "add" ? magnitude : -magnitude;

  const service = createServiceClient();
  // Ownership check — stock_adjustments takes a product_id, so confirm the
  // product is ours before writing against it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: prod } = await (service as any)
    .from("products")
    .select("id")
    .eq("id", productId)
    .eq("restaurant_id", ru.restaurant_id)
    .maybeSingle();
  if (!prod) return { error: "Product not found." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).from("stock_adjustments").insert({
    restaurant_id: ru.restaurant_id,
    product_id: productId,
    kind,
    qty,
    notes: notes || null,
    created_by: ru.id,
  });

  if (error) return { error: "Could not record the adjustment. Please try again." };

  revalidatePath("/admin/stock");
  return null;
}

// ─── Recipes: what a sale deducts ─────────────────────────────────────────────
// A recipe line attaches a product to a menu item, or to ONE VARIANT of it. The
// variant's recipe wins where it exists; the item's is the fallback. See the
// `order_item_consumption` view — it is what actually decides, at read time.

export async function getMenuItemLinks(): Promise<MenuItemLink[]> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canViewStock(ru)) return [];

  const service = createServiceClient();
  const [menuRes, varRes, linkRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("menu_items")
      .select("id, name")
      .eq("restaurant_id", ru.restaurant_id)
      .not("is_deleted", "is", true)
      .order("name"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("menu_item_variants")
      .select("id, menu_item_id, name, sort_order, menu_items!inner(restaurant_id)")
      .eq("menu_items.restaurant_id", ru.restaurant_id)
      .order("sort_order"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("menu_item_products")
      .select("id, menu_item_id, variant_id, product_id, qty_per_unit, products ( name, unit )")
      .eq("restaurant_id", ru.restaurant_id),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toLine = (l: any): RecipeLine => ({
    link_id: l.id,
    product_id: l.product_id,
    product_name: l.products?.name ?? "—",
    unit: l.products?.unit ?? "",
    qty_per_unit: Number(l.qty_per_unit),
  });
  const byName = (a: RecipeLine, b: RecipeLine) => a.product_name.localeCompare(b.product_name);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allLinks = (linkRes.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allVariants = (varRes.data ?? []) as any[];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((menuRes.data ?? []) as any[]).map((m) => ({
    menu_item_id: m.id,
    menu_item_name: m.name,
    base: allLinks
      .filter((l) => l.menu_item_id === m.id && l.variant_id === null)
      .map(toLine)
      .sort(byName),
    // EVERY variant is listed, including those with no recipe of their own — a
    // variant that silently inherits the item's recipe is a thing the admin needs
    // to be able to see, not a thing that quietly isn't there.
    variants: allVariants
      .filter((v) => v.menu_item_id === m.id)
      .map((v) => {
        const products = allLinks
          .filter((l) => l.variant_id === v.id)
          .map(toLine)
          .sort(byName);
        return {
          variant_id: v.id,
          variant_name: v.name,
          overrides: products.length > 0,
          products,
        };
      }),
  }));
}

/**
 * Attach a product to a menu item — or to one variant of it — and set how much of
 * it a single sale consumes. Re-linking the same target and product updates the
 * quantity rather than creating a duplicate.
 */
export async function linkMenuItem(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canManageStock(ru)) {
    return { error: "You don't have permission to manage stock." };
  }

  const menuItemId = formData.get("menu_item_id") as string;
  const productId = formData.get("product_id") as string;
  // Empty string means "the item itself", not "a variant whose id is blank".
  const variantId = ((formData.get("variant_id") as string) || "").trim() || null;
  const qtyRaw = (formData.get("qty_per_unit") as string) || "1";
  const qty = parseFloat(qtyRaw);

  if (!menuItemId) return { error: "Choose a menu item." };
  if (!productId) return { error: "Choose a product." };
  if (isNaN(qty) || qty <= 0) return { error: "Quantity per sale must be greater than zero." };

  const service = createServiceClient();

  // Both sides must belong to this restaurant.
  const [menuRes, prodRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("menu_items")
      .select("id")
      .eq("id", menuItemId)
      .eq("restaurant_id", ru.restaurant_id)
      .maybeSingle(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("products")
      .select("id")
      .eq("id", productId)
      .eq("restaurant_id", ru.restaurant_id)
      .maybeSingle(),
  ]);
  if (!menuRes.data) return { error: "Menu item not found." };
  if (!prodRes.data) return { error: "Product not found." };

  // …and the variant, if given, must be a variant OF THAT ITEM. The DB enforces
  // this too (rs_mip_variant_matches_item) — this is just the friendlier message.
  if (variantId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: v } = await (service as any)
      .from("menu_item_variants")
      .select("id")
      .eq("id", variantId)
      .eq("menu_item_id", menuItemId)
      .maybeSingle();
    if (!v) return { error: "That variant does not belong to this menu item." };
  }

  // The uniqueness of a recipe line is (target, product), and "target" is a
  // variant or an item — which two PARTIAL unique indexes express, and which
  // PostgREST's `upsert` cannot infer. So the update-or-insert is done by hand.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (service as any)
    .from("menu_item_products")
    .select("id")
    .eq("menu_item_id", menuItemId)
    .eq("product_id", productId);
  q = variantId ? q.eq("variant_id", variantId) : q.is("variant_id", null);
  const { data: existing } = await q.maybeSingle();

  const { error } = existing
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any)
        .from("menu_item_products")
        .update({ qty_per_unit: qty })
        .eq("id", existing.id)
    : // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).from("menu_item_products").insert({
        restaurant_id: ru.restaurant_id,
        menu_item_id: menuItemId,
        variant_id: variantId,
        product_id: productId,
        qty_per_unit: qty,
      });

  if (error) {
    if (error.message?.includes("VARIANT_NOT_OF_ITEM")) {
      return { error: "That variant does not belong to this menu item." };
    }
    return { error: "Could not link the menu item. Please try again." };
  }

  revalidatePath("/admin/stock");
  return null;
}

/**
 * Remove ONE recipe line, leaving every other line intact.
 *
 * Keyed by the line's own id rather than by (menu_item, product): the same
 * product can legitimately appear on the item AND on several of its variants, so
 * that pair no longer identifies a single row.
 */
export async function unlinkMenuItem(linkId: string): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canManageStock(ru)) {
    return { error: "You don't have permission to manage stock." };
  }

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("menu_item_products")
    .delete()
    .eq("id", linkId)
    .eq("restaurant_id", ru.restaurant_id);

  if (error) return { error: "Could not unlink the menu item. Please try again." };

  revalidatePath("/admin/stock");
  return null;
}

/**
 * Everything a product can be attached to: each menu item, and each variant of
 * each menu item, as separate targets.
 */
export async function getLinkTargets(): Promise<LinkTarget[]> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canViewStock(ru)) return [];

  const service = createServiceClient();
  const [menuRes, varRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("menu_items")
      .select("id, name")
      .eq("restaurant_id", ru.restaurant_id)
      .not("is_deleted", "is", true)
      .order("name"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("menu_item_variants")
      .select("id, menu_item_id, name, sort_order, menu_items!inner(restaurant_id)")
      .eq("menu_items.restaurant_id", ru.restaurant_id)
      .order("sort_order"),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const variants = (varRes.data ?? []) as any[];
  const targets: LinkTarget[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const m of ((menuRes.data ?? []) as any[])) {
    // The item itself first — it is the fallback recipe every variant inherits
    // unless it is given one of its own.
    targets.push({ menu_item_id: m.id, variant_id: null, label: m.name });
    for (const v of variants.filter((x) => x.menu_item_id === m.id)) {
      targets.push({
        menu_item_id: m.id,
        variant_id: v.id,
        label: `${m.name} · ${v.name}`,
      });
    }
  }
  return targets;
}

/** Active products, for the link + purchase pickers. */
export async function getProductOptions(): Promise<
  { id: string; name: string; unit: string }[]
> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canViewStock(ru)) return [];

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("products")
    .select("id, name, unit")
    .eq("restaurant_id", ru.restaurant_id)
    .eq("is_active", true)
    .order("name");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((p) => ({ id: p.id, name: p.name, unit: p.unit }));
}
