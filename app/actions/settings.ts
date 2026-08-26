"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { requireRestaurantAdmin } from "@/lib/auth/guards";
import { normalizeBillLabel, type BillNumberLabel } from "@/lib/billing/bill-number";
import { normalizeClosingHour } from "@/lib/business-day";
import { defaultTicketCode, ticketCodeOf } from "@/lib/workstations/ticket-code";
import { revalidateRestaurantInfo } from "@/lib/restaurant-info";
import { revalidateWorkstations } from "@/lib/cache/tenant-cache";
import {
  normalizeDailySummaryConfig,
  MAX_SUMMARY_EMAILS,
  EMAIL_RE,
  type DailySummaryConfig,
} from "@/lib/reports/daily-summary";
import { sendDailySummary } from "@/lib/reports/daily-summary-send";
import { historyPeriodDateBounds, type HistoryPeriod } from "@/lib/history-period";

export type ActionResult = { error: string } | { ok: true } | null;

export type BillingSettings = {
  /** PAN / VAT registration number printed on bills. Empty when unset. */
  panNumber: string;
  /** Contact number printed on bills, under the PAN. Empty when unset.
   *  Stored on `restaurants.contact_phone` — the SAME column the superadmin surface
   *  edits, deliberately: two columns for one phone number would print whichever the
   *  bill happened to read. */
  contactPhone: string;
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
    .select("pan_vat_number, contact_phone, bill_number_next, settings, discount_pin_hash")
    .eq("id", restaurantUser.restaurant_id)
    .maybeSingle();

  const s = data?.settings ?? {};
  return {
    panNumber: data?.pan_vat_number ?? "",
    contactPhone: data?.contact_phone ?? "",
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

  // Written by the `set_discount_pin` DB function, not by a .update() here — so this is
  // the one invalidation a grep for `.from("restaurants").update(` would have missed.
  // Setting or clearing the PIN is the on/off switch for discounts existing at all, so a
  // stale `discountEnabled` would show the cashier a field that cannot work (or hide one
  // that now can).
  revalidateRestaurantInfo(restaurantUser.restaurant_id);

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

  // The number printed under the PAN. Kept permissive on FORM (Nepali numbers are
  // written +977-71-… , 071-5xxxxx, or with a second number after a slash) but it must
  // still be a phone number rather than a line of free text, so letters are refused and
  // there has to be a plausible count of digits.
  const phoneRaw = ((formData.get("contact_phone") as string) || "").trim();
  let contactPhone: string | null = null;
  if (phoneRaw !== "") {
    if (phoneRaw.length > 40) return { error: "That phone number is too long for a bill." };
    if (!/^[0-9+\-()/ ]+$/.test(phoneRaw)) {
      return { error: "The phone number can only contain digits and + - ( ) / and spaces." };
    }
    const digits = phoneRaw.replace(/\D/g, "").length;
    if (digits < 6) return { error: "That doesn't look like a phone number." };
    contactPhone = phoneRaw;
  }

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
      contact_phone: contactPhone,
      bill_number_next: billNumberNext,
      settings,
    })
    .eq("id", restaurantUser.restaurant_id);

  if (error) return { error: error.message };

  // PAN, bill numbering and the tax/service percentages all print on a customer receipt,
  // and the config is cached for 60s — so this must be dropped NOW, not on the next TTL.
  revalidateRestaurantInfo(restaurantUser.restaurant_id);

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

  revalidateRestaurantInfo(restaurantUser.restaurant_id);

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

// ─── Daily financial-summary emails ───────────────────────────────────────────
// Owner opts in and lists up to three recipients. After the business day closes,
// a scheduled job (pg_cron → /api/cron/daily-summary) emails each restaurant's
// summary. No email configured ⇒ nothing is sent. The config lives in the
// settings jsonb; the shape is owned by lib/reports/daily-summary.ts.

export async function getDailySummarySettings(): Promise<DailySummaryConfig> {
  const { restaurantUser } = await requireRestaurantAdmin();
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("restaurants")
    .select("settings")
    .eq("id", restaurantUser.restaurant_id)
    .maybeSingle();

  return normalizeDailySummaryConfig(data?.settings?.daily_summary);
}

export async function updateDailySummarySettings(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const { restaurantUser } = await requireRestaurantAdmin();
  const service = createServiceClient();

  const enabled = formData.get("enabled") === "1";

  // Up to three fixed slots. A blank slot is fine; a filled one must be a valid
  // address, so a typo is caught here rather than silently dropping a recipient.
  const seen = new Set<string>();
  const emails: string[] = [];
  for (let i = 0; i < MAX_SUMMARY_EMAILS; i++) {
    const raw = ((formData.get(`email_${i}`) as string) || "").trim();
    if (!raw) continue;
    if (!EMAIL_RE.test(raw)) {
      return { error: `“${raw}” is not a valid email address.` };
    }
    const key = raw.toLowerCase();
    if (seen.has(key)) continue; // ignore duplicates rather than erroring
    seen.add(key);
    emails.push(raw);
  }

  if (enabled && emails.length === 0) {
    return { error: "Add at least one email address, or turn the daily summary off." };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rest } = await (service as any)
    .from("restaurants")
    .select("settings")
    .eq("id", restaurantUser.restaurant_id)
    .maybeSingle();

  const settings = {
    ...(rest?.settings ?? {}),
    daily_summary: { enabled, emails },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("restaurants")
    .update({ settings })
    .eq("id", restaurantUser.restaurant_id);

  if (error) return { error: error.message };

  revalidatePath("/admin/settings");
  return { ok: true };
}

// ─── Daily Finance Report — delivery history + retry ──────────────────────────

export type ReportDeliveryRow = {
  businessDate: string;    // period_key (YYYY-MM-DD)
  generatedAt: string | null;
  sentAt: string | null;   // only meaningful when status === "sent"
  recipients: string[];
  status: "sent" | "failed";
  error: string | null;
  attempts: number;
};

// The recent daily-report deliveries for this restaurant, newest first. Admin-only
// (the report exposes takings), matching the rest of Settings.
//
// `period` narrows by `period_key` — the business date the REPORT covers, not
// when it was sent — so "This Week" means "the last 7 days of reports", matching
// what the row itself is about. Bounds come from `historyPeriodDateBounds`,
// which stays in YYYY-MM-DD string space end to end — `period_key` is a
// calendar day with no time component, and reconstructing a date string from a
// Date instant (`.toISOString().slice(0, 10)`) reads back in UTC, which can name
// the wrong Nepal day. See `business-day.ts`'s header note.
export async function getReportHistory(
  period: HistoryPeriod = "week",
  date: string | null = null,
  limit = 30
): Promise<ReportDeliveryRow[]> {
  const { restaurantUser } = await requireRestaurantAdmin();
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (service as any)
    .from("report_deliveries")
    .select("period_key, generated_at, sent_at, recipients, status, error, attempts")
    .eq("restaurant_id", restaurantUser.restaurant_id)
    .eq("period_type", "daily");

  const { from, to } = historyPeriodDateBounds(period, restaurantUser.closingHour, date);
  if (from) query = query.gte("period_key", from);
  if (to) query = query.lt("period_key", to);

  const { data } = await query
    .order("period_key", { ascending: false })
    .limit(Math.min(Math.max(1, limit), 100));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    businessDate: r.period_key,
    generatedAt: r.generated_at ?? null,
    sentAt: r.status === "sent" ? r.sent_at ?? null : null,
    recipients: Array.isArray(r.recipients) ? r.recipients : [],
    status: r.status === "sent" ? "sent" : "failed",
    error: r.error ?? null,
    attempts: Number(r.attempts ?? 0),
  }));
}

// Re-generate and re-send a single day's report on demand (the history "Retry"
// button). Admin-only; forces a resend even if a row exists. Rebuilds the PDF from
// live data so a retry reflects any corrections since the failure.
export async function retryReportDelivery(
  businessDate: string
): Promise<ActionResult> {
  const { restaurantUser } = await requireRestaurantAdmin();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    return { error: "Invalid report date." };
  }

  const outcome = await sendDailySummary(
    restaurantUser.restaurant_id,
    businessDate,
    restaurantUser.closingHour,
    { force: true }
  );

  revalidatePath("/admin/settings");

  if (outcome.status === "sent") return { ok: true };
  if (outcome.status === "skipped") {
    return { error: "Nothing to send — add at least one recipient and enable the daily summary." };
  }
  return { error: outcome.error || "Could not send the report. Please try again." };
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
    .select("id, name")
    .eq("restaurant_id", restaurantUser.restaurant_id);

  const rows = ((stations ?? []) as { id: string; name: string }[]);

  for (const { id, name } of rows) {
    const prefixRaw = ((formData.get(`prefix_${id}`) as string) || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const nextRaw = ((formData.get(`next_${id}`) as string) || "").trim();

    let otNext: number | null = null;
    if (nextRaw !== "") {
      const n = Number(nextRaw);
      if (!Number.isInteger(n) || n < 0) return { error: "Each next number must be a whole number (0 or more)." };
      otNext = n;
    }

    // Every ticket this station has ever issued keeps its number forever, and two of its
    // tickets may never share one. Winding the counter back into already-issued territory
    // would therefore not renumber history — it would make the NEXT print fail outright,
    // at the counter, mid-service. Refuse it here, where it can still be explained.
    if (otNext !== null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: highest } = await (service as any)
        .from("order_tickets")
        .select("ot_number")
        .eq("workstation_id", id)
        .not("ot_number", "is", null)
        .order("ot_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      const used = highest?.ot_number as number | undefined;
      if (used != null && otNext <= used) {
        return {
          error: `${name} has already issued number ${used}. Its next number must be ${used + 1} or higher.`,
        };
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (service as any)
      .from("workstations")
      .update({ ticket_code: prefixRaw || null, ot_next: otNext })
      .eq("id", id)
      .eq("restaurant_id", restaurantUser.restaurant_id);
    if (error) return { error: error.message };
  }

  // This form edits `ticket_code`, which is the prefix printed on every Order Ticket —
  // so a stale station list would keep printing the old code.
  revalidateWorkstations(restaurantUser.restaurant_id);
  revalidatePath("/admin/settings");
  revalidatePath("/admin/workstations");
  return { ok: true };
}
