"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { requireRestaurantAdmin } from "@/lib/auth/guards";
import { normalizeBillLabel, type BillNumberLabel } from "@/lib/billing/bill-number";
import { normalizeClosingHour } from "@/lib/business-day";
import { defaultTicketCode, ticketCodeOf } from "@/lib/workstations/ticket-code";

export type ActionResult = { error: string } | { ok: true } | null;

export type BillingSettings = {
  /** PAN / VAT registration number printed on bills. Empty when unset. */
  panNumber: string;
  /** The number the NEXT bill will use; null = custom numbering off (legacy refs). */
  billNumberNext: number | null;
  /** Minimum digits to zero-pad the printed number to (0 = no padding). */
  billNumberPad: number;
  /** Whether bills read "Bill No" or "Order No". */
  billNumberLabel: BillNumberLabel;
  /** Whether a discount PIN is configured — i.e. whether discounts are possible at all.
   *  Only ever a boolean: the PIN itself never leaves the DB (see set_discount_pin). */
  discountPinSet: boolean;
};

export type BusinessDaySettings = {
  /** The hour a business day rolls over, 0–23. 0 = midnight (the default). */
  closingHour: number;
};

// Reads the restaurant's billing settings for the admin form. Admin-only; the page
// guards too, but the action is the security boundary.
export async function getBillingSettings(): Promise<BillingSettings> {
  const { restaurantUser } = await requireRestaurantAdmin();
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("restaurants")
    .select("pan_vat_number, bill_number_next, settings, discount_pin_hash")
    .eq("id", restaurantUser.restaurant_id)
    .maybeSingle();

  const s = data?.settings ?? {};
  return {
    panNumber: data?.pan_vat_number ?? "",
    billNumberNext: data?.bill_number_next ?? null,
    billNumberPad: Number.isFinite(Number(s.bill_number_pad)) ? Number(s.bill_number_pad) : 0,
    billNumberLabel: normalizeBillLabel(s.bill_number_label),
    // Collapsed to a boolean HERE, server-side — the hash must never reach the client.
    discountPinSet: !!data?.discount_pin_hash,
  };
}

// Sets, changes or removes the discount authorization PIN. Without a PIN a restaurant
// cannot apply discounts at all, so removing it is the off switch — that's deliberate:
// there is no configuration in which a discount can be applied unauthorized.
//
// The PIN goes straight into `set_discount_pin`, which hashes it (bcrypt) inside the DB.
// It is never stored, logged or returned in plaintext.
export async function updateDiscountPin(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const { restaurantUser } = await requireRestaurantAdmin();
  const service = createServiceClient();

  const clearing = formData.get("clear_pin") === "1";
  const pin = ((formData.get("discount_pin") as string) || "").trim();

  if (!clearing) {
    // Matches the 4-digit staff-login PIN format, so there's one PIN shape to remember.
    if (!/^\d{4}$/.test(pin)) return { error: "The discount PIN must be exactly 4 digits." };
    const confirm = ((formData.get("discount_pin_confirm") as string) || "").trim();
    if (confirm !== pin) return { error: "The two PINs don't match." };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("set_discount_pin", {
    p_restaurant_id: restaurantUser.restaurant_id,
    p_pin: clearing ? null : pin,
  });
  if (error) return { error: "Could not save the discount PIN. Please try again." };

  revalidatePath("/admin/settings");
  return { ok: true };
}

// Saves PAN + bill-number configuration. Scoped to the caller's own restaurant, so it can
// never touch another tenant. Changing the sequence only moves the counter for FUTURE
// bills — every past bill already carries its own stamped number, untouched.
export async function updateBillingSettings(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const { restaurantUser } = await requireRestaurantAdmin();
  const service = createServiceClient();

  const pan = ((formData.get("pan_number") as string) || "").trim() || null;

  // Blank "next number" turns custom numbering OFF (fall back to legacy refs). Otherwise it
  // must be a non-negative integer, and it becomes the number the very next bill will use.
  const rawNext = ((formData.get("bill_number_next") as string) || "").trim();
  let billNumberNext: number | null = null;
  if (rawNext !== "") {
    const n = Number(rawNext);
    if (!Number.isInteger(n) || n < 0) return { error: "Next bill number must be a whole number (0 or more)." };
    billNumberNext = n;
  }

  const rawPad = ((formData.get("bill_number_pad") as string) || "").trim();
  let pad = 0;
  if (rawPad !== "") {
    const p = Number(rawPad);
    if (!Number.isInteger(p) || p < 0 || p > 12) return { error: "Padding must be a whole number between 0 and 12." };
    pad = p;
  }

  const label = normalizeBillLabel(formData.get("bill_number_label"));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rest } = await (service as any)
    .from("restaurants")
    .select("settings")
    .eq("id", restaurantUser.restaurant_id)
    .maybeSingle();

  const settings = {
    ...(rest?.settings ?? {}),
    bill_number_pad: pad,
    bill_number_label: label,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("restaurants")
    .update({
      pan_vat_number: pan,
      bill_number_next: billNumberNext,
      settings,
    })
    .eq("id", restaurantUser.restaurant_id);

  if (error) return { error: error.message };

  // The floor reads these when printing, so refresh the surfaces that render a bill.
  revalidatePath("/admin/settings");
  revalidatePath("/employee/sales");
  return { ok: true };
}

// ─── Business day ─────────────────────────────────────────────────────────────
// Restaurants that trade past midnight count those sales as the previous night's
// takings. This is the hour at which the books roll over.

export async function getBusinessDaySettings(): Promise<BusinessDaySettings> {
  const { restaurantUser } = await requireRestaurantAdmin();
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("restaurants")
    .select("settings")
    .eq("id", restaurantUser.restaurant_id)
    .maybeSingle();

  return { closingHour: normalizeClosingHour(data?.settings?.business_closing_hour) };
}

export async function updateBusinessDaySettings(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const { restaurantUser } = await requireRestaurantAdmin();
  const service = createServiceClient();

  const raw = ((formData.get("closing_hour") as string) || "").trim();
  const hour = Number(raw);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return { error: "Choose a valid closing time." };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rest } = await (service as any)
    .from("restaurants")
    .select("settings")
    .eq("id", restaurantUser.restaurant_id)
    .maybeSingle();

  const settings = { ...(rest?.settings ?? {}), business_closing_hour: hour };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("restaurants")
    .update({ settings })
    .eq("id", restaurantUser.restaurant_id);

  if (error) return { error: error.message };

  // This re-buckets every date-based figure in the app, so every reporting
  // surface must be refreshed — a cached page would keep showing totals computed
  // against the OLD boundary and quietly disagree with the rest of the system.
  for (const p of [
    "/admin/settings",
    "/admin/dashboard",
    "/admin/finance",
    "/admin/stock",
    "/admin/purchases",
    "/admin/staff",
    "/employee/sales",
    "/employee/credits",
    "/employee/dashboard",
  ]) {
    revalidatePath(p);
  }
  return { ok: true };
}

// ─── Per-workstation Order-Ticket (OT) numbering ──────────────────────────────
// Each workstation keeps its OWN independent OT sequence (KOT-00125, BOT-00086, …). Same
// architecture as the bill number, but one counter per workstation. The prefix reuses the
// workstation's ticket_code (the code that already names the "Print KOT" button/header).

export type WorkstationNumbering = {
  id: string;
  name: string;
  /** The effective prefix shown/printed (explicit ticket_code, else derived from name). */
  prefix: string;
  /** Auto default if the admin clears the prefix. */
  defaultPrefix: string;
  /** The number the NEXT ticket for this station will use; null = OT numbering off. */
  next: number | null;
};

// Every workstation the restaurant has — existing AND any future one — so the Settings page
// lists them all without code changes.
export async function getWorkstationNumbering(): Promise<WorkstationNumbering[]> {
  const { restaurantUser } = await requireRestaurantAdmin();
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("workstations")
    .select("id, name, ticket_code, ot_next, sort_order")
    .eq("restaurant_id", restaurantUser.restaurant_id)
    .order("sort_order")
    .order("name");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data as any[]) ?? []).map((w) => ({
    id: w.id,
    name: w.name,
    prefix: ticketCodeOf({ name: w.name, ticket_code: w.ticket_code }),
    defaultPrefix: defaultTicketCode(w.name),
    next: w.ot_next ?? null,
  }));
}

// Saves prefix + next-number for every workstation in one go. Reads the restaurant's own
// workstations from the DB (not a client-supplied list) and, for each, applies the matching
// `prefix_<id>` / `next_<id>` fields. Blank next = numbering off. Changing a number only
// moves that ONE workstation's future tickets; stamped tickets keep their numbers.
export async function updateWorkstationNumbering(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const { restaurantUser } = await requireRestaurantAdmin();
  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: stations } = await (service as any)
    .from("workstations")
    .select("id")
    .eq("restaurant_id", restaurantUser.restaurant_id);

  const ids = ((stations ?? []) as { id: string }[]).map((s) => s.id);

  for (const id of ids) {
    const prefixRaw = ((formData.get(`prefix_${id}`) as string) || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const nextRaw = ((formData.get(`next_${id}`) as string) || "").trim();

    let otNext: number | null = null;
    if (nextRaw !== "") {
      const n = Number(nextRaw);
      if (!Number.isInteger(n) || n < 0) return { error: "Each next number must be a whole number (0 or more)." };
      otNext = n;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (service as any)
      .from("workstations")
      .update({ ticket_code: prefixRaw || null, ot_next: otNext })
      .eq("id", id)
      .eq("restaurant_id", restaurantUser.restaurant_id);
    if (error) return { error: error.message };
  }

  revalidatePath("/admin/settings");
  revalidatePath("/admin/workstations");
  return { ok: true };
}
