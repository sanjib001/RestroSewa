"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { STOCK_ACCESS } from "@/lib/permissions";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";
import { dayBounds } from "@/lib/stock";
import { historyPeriodBounds, type HistoryPeriod } from "@/lib/history-period";

export type ActionResult = { error: string } | null;

// ─── Types ────────────────────────────────────────────────────────────────────

export type PurchaseMethod = "cash" | "online" | "credit";

export type PurchaseRow = {
  id: string;
  purchase_code: string;
  vendor_id: string;
  vendor_name: string;
  method: PurchaseMethod;
  total_amount: number;
  cash_amount: number;
  online_amount: number;
  /** Still owed to the vendor from this bill. */
  credit_amount: number;
  notes: string | null;
  created_at: string;
  item_count: number;
};

export type PurchaseLine = {
  id: string;
  product_id: string;
  product_name: string;
  unit: string;
  quantity: number;
  unit_cost: number;
  line_total: number;
};

export type PurchaseDetail = PurchaseRow & {
  created_by_name: string | null;
  items: PurchaseLine[];
};

export type PurchaseFilter = "all" | "cash" | "online" | "credit";

export type PurchaseSummary = {
  /** Everything bought in the period, at bill value. */
  totalPurchases: number;
  cashSpend: number;
  onlineSpend: number;
  /** Bought on credit — NOT money spent yet. */
  creditPurchases: number;
  purchaseCount: number;
};

export type VendorOption = { id: string; name: string; credit_balance: number };

/**
 * ONE line of a supplier bill, lifted out so it can be reported on by station.
 *
 * A bill is not the right unit for a station question: one bill routinely mixes
 * 4kg of chicken (Kitchen) with two crates of beer (Bar), and its `total_amount`
 * is the sum of both. Reporting "Bar spend" off bill totals would count the
 * chicken, so the station view drops to the LINE — the only level at which the
 * question has an honest answer.
 */
export type PurchaseLineRow = {
  id: string;
  purchase_id: string;
  purchase_code: string;
  vendor_name: string;
  method: PurchaseMethod;
  created_at: string;
  product_id: string;
  product_name: string;
  unit: string;
  quantity: number;
  unit_cost: number;
  line_total: number;
  /** Stations holding this line's PRODUCT. Empty ⇒ Unassigned. */
  workstation_ids: string[];
};

function sanitizeSearch(raw: string): string {
  return raw.replace(/[,()*%\\]/g, " ").trim().slice(0, 60);
}

const RPC_ERRORS: Record<string, string> = {
  VENDOR_NOT_FOUND: "Vendor not found.",
  VENDOR_INACTIVE: "That vendor is deactivated. Reactivate them before buying from them.",
  PRODUCT_NOT_FOUND: "One of the products no longer exists (or is deactivated).",
  NO_ITEMS: "Add at least one product to the purchase.",
  INVALID_QUANTITY: "Every line needs a quantity greater than zero.",
  INVALID_UNIT_COST: "Unit cost cannot be negative.",
  INVALID_METHOD: "Choose Cash, Online or Credit.",
  INVALID_AMOUNT: "Amounts cannot be negative.",
  INVALID_TOTAL: "The purchase total must be greater than zero.",
  NOTHING_ON_CREDIT:
    "Nothing would be left on credit. Use Cash or Online to settle this purchase in full.",
};

function rpcError(message: string, fallback: string): string {
  for (const [code, text] of Object.entries(RPC_ERRORS)) {
    if (message.includes(code)) return text;
  }
  return fallback;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRow(p: any): PurchaseRow {
  return {
    id: p.id,
    purchase_code: p.purchase_code,
    vendor_id: p.vendor_id,
    vendor_name: p.vendors?.name ?? "—",
    method: p.payment_method as PurchaseMethod,
    total_amount: Number(p.total_amount),
    cash_amount: Number(p.cash_amount),
    online_amount: Number(p.online_amount),
    credit_amount: Number(p.credit_amount),
    notes: p.notes ?? null,
    created_at: p.created_at,
    item_count: Array.isArray(p.purchase_items) ? p.purchase_items.length : 0,
  };
}

const PURCHASE_SELECT =
  "id, purchase_code, vendor_id, payment_method, total_amount, cash_amount, online_amount, credit_amount, notes, created_at, created_by, vendors ( name ), purchase_items ( id )";

// ─── List / search ────────────────────────────────────────────────────────────

export async function getPurchases(params?: {
  search?: string | null;
  filter?: PurchaseFilter;
  vendorId?: string | null;
  period?: HistoryPeriod;
  /** A specific business day (YYYY-MM-DD) — overrides `period` when given. */
  date?: string | null;
}): Promise<PurchaseRow[]> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canViewPurchases(ru)) return [];

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (service as any)
    .from("purchases")
    .select(PURCHASE_SELECT)
    .eq("restaurant_id", ru.restaurant_id);

  const filter = params?.filter ?? "all";
  if (filter !== "all") query = query.eq("payment_method", filter);
  if (params?.vendorId) query = query.eq("vendor_id", params.vendorId);

  const period = params?.period ?? "today";
  if (params?.date || period !== "all") {
    const { from, to } = historyPeriodBounds(period, ru.closingHour, params?.date);
    query = query.gte("created_at", from.toISOString()).lt("created_at", to.toISOString());
  }

  const { data } = await query.order("created_at", { ascending: false }).limit(500);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rows = ((data ?? []) as any[]).map(toRow);

  // Search spans the purchase code and the vendor's name — the two things an
  // admin has to hand. Done in memory because the vendor name lives on a join.
  const search = sanitizeSearch(params?.search ?? "").toLowerCase();
  if (search) {
    rows = rows.filter(
      (p) =>
        p.purchase_code.toLowerCase().includes(search) ||
        p.vendor_name.toLowerCase().includes(search)
    );
  }

  return rows;
}

/**
 * Every purchase LINE across the recent bills, with its product's stations.
 *
 * Same window as `getPurchases` (most recent 500 bills) so the two views of the
 * same screen cover the same ground — switching to a station must not silently
 * change the period as well as the unit.
 *
 * Station filtering happens on the CLIENT, over this one payload: the screen
 * already holds every line, so switching stations costs no round trip. This
 * returns the lines and their stations; it does not decide which you're looking
 * at.
 */
export async function getPurchaseLines(params?: {
  search?: string | null;
  filter?: PurchaseFilter;
  period?: HistoryPeriod;
  /** A specific business day (YYYY-MM-DD) — overrides `period` when given. */
  date?: string | null;
}): Promise<PurchaseLineRow[]> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canViewPurchases(ru)) return [];

  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (service as any)
    .from("purchases")
    .select(
      "id, purchase_code, payment_method, created_at, vendors ( name ), " +
        "purchase_items ( id, product_id, quantity, unit_cost, line_total, products ( name, unit ) )"
    )
    .eq("restaurant_id", ru.restaurant_id);

  const filter = params?.filter ?? "all";
  if (filter !== "all") query = query.eq("payment_method", filter);

  const period = params?.period ?? "today";
  if (params?.date || period !== "all") {
    const { from, to } = historyPeriodBounds(period, ru.closingHour, params?.date);
    query = query.gte("created_at", from.toISOString()).lt("created_at", to.toISOString());
  }

  const [billsRes, stationsRes] = await Promise.all([
    query.order("created_at", { ascending: false }).limit(500),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("product_workstations")
      .select("product_id, workstation_id")
      .eq("restaurant_id", ru.restaurant_id),
  ]);

  const stations = new Map<string, string[]>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const s of (stationsRes.data ?? []) as any[]) {
    const list = stations.get(s.product_id);
    if (list) list.push(s.workstation_id);
    else stations.set(s.product_id, [s.workstation_id]);
  }

  const search = sanitizeSearch(params?.search ?? "").toLowerCase();
  const rows: PurchaseLineRow[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const b of ((billsRes.data ?? []) as any[])) {
    const vendorName = b.vendors?.name ?? "—";
    // Search matches the BILL (code or vendor) or the PRODUCT, because in a line
    // view "chicken" is at least as likely a search as a purchase code.
    const billMatches =
      !search ||
      b.purchase_code.toLowerCase().includes(search) ||
      vendorName.toLowerCase().includes(search);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const i of ((b.purchase_items ?? []) as any[])) {
      const productName = i.products?.name ?? "—";
      if (!billMatches && !productName.toLowerCase().includes(search)) continue;
      rows.push({
        id: i.id,
        purchase_id: b.id,
        purchase_code: b.purchase_code,
        vendor_name: vendorName,
        method: b.payment_method as PurchaseMethod,
        created_at: b.created_at,
        product_id: i.product_id,
        product_name: productName,
        unit: i.products?.unit ?? "",
        quantity: Number(i.quantity),
        unit_cost: Number(i.unit_cost),
        line_total: Number(i.line_total),
        workstation_ids: stations.get(i.product_id) ?? [],
      });
    }
  }

  // Newest first, matching the bill list. `purchase_items` comes back in no
  // guaranteed order within a bill, so lines of one bill are then held together
  // by product name rather than left arbitrary.
  return rows.sort(
    (a, b) =>
      b.created_at.localeCompare(a.created_at) ||
      a.purchase_code.localeCompare(b.purchase_code) ||
      a.product_name.localeCompare(b.product_name)
  );
}

export async function getPurchaseSummary(day?: string | null): Promise<PurchaseSummary> {
  const ru = await getRestaurantUser();
  const empty: PurchaseSummary = {
    totalPurchases: 0,
    cashSpend: 0,
    onlineSpend: 0,
    creditPurchases: 0,
    purchaseCount: 0,
  };
  if (!STOCK_ACCESS.canViewPurchases(ru)) return empty;

  const service = createServiceClient();
  const { from, to } = dayBounds(day ?? null, ru.closingHour);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("purchases")
    .select("total_amount, cash_amount, online_amount, credit_amount")
    .eq("restaurant_id", ru.restaurant_id)
    .gte("created_at", from.toISOString())
    .lt("created_at", to.toISOString());

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []) as any[];
  return rows.reduce<PurchaseSummary>(
    (acc, p) => ({
      totalPurchases: acc.totalPurchases + Number(p.total_amount),
      cashSpend: acc.cashSpend + Number(p.cash_amount),
      onlineSpend: acc.onlineSpend + Number(p.online_amount),
      creditPurchases: acc.creditPurchases + Number(p.credit_amount),
      purchaseCount: acc.purchaseCount + 1,
    }),
    empty
  );
}

// ─── Detail ───────────────────────────────────────────────────────────────────

export async function getPurchaseDetail(
  purchaseId: string
): Promise<PurchaseDetail | { error: string }> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canViewPurchases(ru)) {
    return { error: "You don't have permission to view purchases." };
  }

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: p } = await (service as any)
    .from("purchases")
    .select(PURCHASE_SELECT)
    .eq("id", purchaseId)
    .eq("restaurant_id", ru.restaurant_id) // tenant isolation
    .maybeSingle();

  if (!p) return { error: "Purchase not found." };

  const [itemsRes, userRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("purchase_items")
      .select("id, product_id, quantity, unit_cost, line_total, products ( name, unit )")
      .eq("purchase_id", purchaseId)
      .order("created_at"),
    p.created_by
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (service as any)
          .from("restaurant_users")
          .select("display_name")
          .eq("id", p.created_by)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    ...toRow(p),
    created_by_name: userRes.data?.display_name ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items: ((itemsRes.data ?? []) as any[]).map((i) => ({
      id: i.id,
      product_id: i.product_id,
      product_name: i.products?.name ?? "—",
      unit: i.products?.unit ?? "",
      quantity: Number(i.quantity),
      unit_cost: Number(i.unit_cost),
      line_total: Number(i.line_total),
    })),
  };
}

// ─── Record a purchase ────────────────────────────────────────────────────────
// The bill, its lines, the vendor's credit movement and each product's latest
// cost are written by `record_purchase` in ONE transaction — a purchase can never
// exist without its stock, nor raise a debt without its bill.

type ItemInput = { product_id: string; quantity: number; unit_cost: number };

export async function recordPurchase(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canManagePurchases(ru)) {
    return { error: "You don't have permission to record purchases." };
  }

  const vendorId = formData.get("vendor_id") as string;
  const method = ((formData.get("method") as string) || "cash").toLowerCase();
  const notes = ((formData.get("notes") as string) || "").trim();
  const itemsJson = (formData.get("items") as string) || "[]";
  const paidNowRaw = (formData.get("paid_now") as string) || "";
  const paidTender = ((formData.get("paid_tender") as string) || "cash").toLowerCase();

  if (!vendorId) return { error: "Choose a vendor." };
  if (!["cash", "online", "credit", "mixed"].includes(method)) {
    return { error: "Choose Cash, Online, Mixed or Credit." };
  }

  let items: ItemInput[];
  try {
    items = JSON.parse(itemsJson);
  } catch {
    return { error: "Invalid purchase lines." };
  }
  if (!Array.isArray(items) || items.length === 0) {
    return { error: "Add at least one product to the purchase." };
  }
  for (const i of items) {
    if (!i.product_id) return { error: "Every line needs a product." };
    if (!(i.quantity > 0)) return { error: "Every line needs a quantity greater than zero." };
    if (!(i.unit_cost >= 0)) return { error: "Unit cost cannot be negative." };
  }

  // On a credit purchase the admin may part-pay now; the rest goes on the
  // vendor's account. Cash/online/mixed immediate payment is recorded.
  let cash = 0;
  let online = 0;
  if (method === "credit") {
    const paidNow = paidNowRaw === "" ? 0 : parseFloat(paidNowRaw);
    if (isNaN(paidNow) || paidNow < 0) {
      return { error: "The amount paid now must be zero or more." };
    }
    if (paidNow > 0) {
      if (paidTender === "online") {
        online = paidNow;
      } else if (paidTender === "mixed") {
        const c = parseFloat((formData.get("cash_amount") as string) || "");
        const o = parseFloat((formData.get("online_amount") as string) || "");
        if (isNaN(c) || isNaN(o) || c < 0 || o < 0) {
          return { error: "Enter both the cash and the online amount paid now." };
        }
        if (Math.abs(c + o - paidNow) > 0.01) {
          return { error: "Cash and Online paid now must equal the total paid now." };
        }
        cash = c;
        online = o;
      } else {
        cash = paidNow;
      }
    }
  } else if (method === "mixed") {
    // A fully-paid bill settled partly in cash and partly online. The RPC
    // re-checks that the two halves equal the line total it computes itself —
    // the client is never trusted for the amount.
    const c = parseFloat((formData.get("cash_amount") as string) || "");
    const o = parseFloat((formData.get("online_amount") as string) || "");
    if (isNaN(c) || isNaN(o) || c < 0 || o < 0) {
      return { error: "Enter both the cash and the online amount." };
    }
    cash = c;
    online = o;
  }

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("record_purchase", {
    p_restaurant_id: ru.restaurant_id, // tenant scope re-checked inside the RPC
    p_vendor_id: vendorId,
    p_method: method,
    p_cash: cash,
    p_online: online,
    p_items: items.map((i) => ({
      product_id: i.product_id,
      quantity: i.quantity,
      unit_cost: i.unit_cost,
    })),
    p_notes: notes || null,
    p_created_by: ru.id,
  });

  if (error) {
    return { error: rpcError(error.message ?? "", "Could not record the purchase. Please try again.") };
  }

  // A purchase moves stock, vendor credit and today's expenses at once.
  revalidatePath("/admin/purchases");
  revalidatePath("/admin/stock");
  revalidatePath("/admin/vendors");
  revalidatePath("/admin/finance");
  revalidatePath("/admin/dashboard");
  revalidatePath("/employee/purchases");
  return null;
}

/** Active vendors, for the purchase picker. */
export async function getVendorOptions(): Promise<VendorOption[]> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canViewPurchases(ru)) return [];

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("vendors")
    .select("id, name, credit_balance")
    .eq("restaurant_id", ru.restaurant_id)
    .eq("is_active", true)
    .order("name");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((s) => ({
    id: s.id,
    name: s.name,
    credit_balance: Number(s.credit_balance),
  }));
}
