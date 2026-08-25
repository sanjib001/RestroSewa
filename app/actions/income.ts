"use server";

// Extra Income — money in that is NOT a restaurant/hotel sale (misc income,
// service income, or anything else received by hand). The mirror of
// app/actions/expenses.ts, on the money-IN side: same "the row IS the payment,
// no pending state" shape, same tender-split parsing, same Finance integration
// via finance_report/finance_transactions (see the extra_income migration).
//
// Correcting or removing an entry lives in app/actions/security.ts, alongside
// every other Security-PIN-gated financial correction (updateExtraExpense,
// updatePaymentTender, updateRoomAdvance) — never here, so there is exactly one
// place in the app that rewrites a settled financial row.

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { STOCK_ACCESS } from "@/lib/permissions";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";
import { periodBounds } from "@/lib/finance";
import type { FinancePeriod } from "@/lib/finance";
import { resolveSplit } from "@/lib/payment-split";

export type ActionResult = { error: string } | null;

/** One recorded extra-income entry, as the Finance page reads it. */
export type ExtraIncome = {
  id: string;
  description: string;
  amount: number;
  /** cash | online | card | mixed */
  method: string;
  cash: number;
  online: number;
  card: number;
  createdAt: string;
  createdByName: string | null;
  /** Null until an admin corrects the row behind the Security PIN. */
  updatedAt: string | null;
};

const SELECT =
  "id, description, amount, payment_method, cash_amount, online_amount, card_amount, created_at, updated_at, " +
  "restaurant_users!extra_income_created_by_fkey ( display_name )";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapIncome(data: any): ExtraIncome[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    description: r.description,
    amount: Number(r.amount ?? 0),
    method: r.payment_method,
    cash: Number(r.cash_amount ?? 0),
    online: Number(r.online_amount ?? 0),
    card: Number(r.card_amount ?? 0),
    createdAt: r.created_at,
    createdByName: r.restaurant_users?.display_name ?? null,
    updatedAt: r.updated_at ?? null,
  }));
}

// ─── Reading ──────────────────────────────────────────────────────────────────

/**
 * The period's extra income, newest first. Periods resolve through the SAME
 * `periodBounds`/closing-hour rule the Finance report uses, so the list on
 * screen and the figures it explains always cover the same hours.
 */
export async function listExtraIncome(params?: {
  period?: FinancePeriod;
  from?: string | null;
  to?: string | null;
}): Promise<ExtraIncome[]> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canViewFinance(ru)) return [];

  const period = params?.period ?? "month";
  const { from, to } = periodBounds(period, ru.closingHour, params?.from, params?.to);

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("extra_income")
    .select(SELECT)
    .eq("restaurant_id", ru.restaurant_id)
    .gte("created_at", from.toISOString())
    .lt("created_at", to.toISOString())
    .order("created_at", { ascending: false });

  return mapIncome(data);
}

// ─── Writing ──────────────────────────────────────────────────────────────────

/**
 * Parse and validate the form's amount + tender split. Card stands alone here
 * (unlike the extra-expense form, which never offers it) — `mixed` still only
 * ever means Cash + Online, the same convention every payment-method picker in
 * the app already uses.
 */
function resolveIncomeSplit(
  amount: number,
  method: string,
  formData: FormData
): { cash: number; online: number; card: number } | { error: string } {
  if (method === "cash") return { cash: amount, online: 0, card: 0 };
  if (method === "online") return { cash: 0, online: amount, card: 0 };
  if (method === "card") return { cash: 0, online: 0, card: amount };

  const split = resolveSplit(
    "mixed",
    amount,
    String(formData.get("cash_amount") ?? ""),
    String(formData.get("online_amount") ?? "")
  );
  if (!split.ok) return { error: split.error };
  return { cash: split.cash ?? 0, online: split.online ?? 0, card: 0 };
}

export async function addExtraIncome(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  // The SAME gate the Finance page's other write action (Opening Balance) uses —
  // writer-level, not just able to see the report. Correcting an entry afterwards
  // is a heavier act still and lives behind the admin + Security PIN gate in
  // security.ts.
  if (!STOCK_ACCESS.canManageStock(ru) || !STOCK_ACCESS.canViewFinance(ru)) {
    return { error: "You don't have permission to record income." };
  }

  const description = String(formData.get("description") ?? "").trim();
  const amount = parseFloat(String(formData.get("amount") ?? "0")) || 0;
  const method = String(formData.get("method") ?? "cash").toLowerCase();
  const occurredRaw = String(formData.get("occurred_at") ?? "").trim();

  if (!description) return { error: "Enter what this income was for." };
  if (amount <= 0) return { error: "Enter the amount." };
  if (!["cash", "online", "card", "mixed"].includes(method)) {
    return { error: "Choose how it was received." };
  }

  // Blank keeps the column's own now() default — an ordinary add needs no
  // thought. A value lets the entry be logged for when the money actually
  // arrived (e.g. filing this morning's cash count in the afternoon).
  let occurredAt: string | undefined;
  if (occurredRaw) {
    const d = new Date(occurredRaw);
    if (isNaN(d.getTime())) return { error: "Invalid date/time." };
    occurredAt = d.toISOString();
  }

  const split = resolveIncomeSplit(amount, method, formData);
  if ("error" in split) return { error: split.error };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).from("extra_income").insert({
    restaurant_id: ru.restaurant_id,
    description,
    amount,
    payment_method: method,
    cash_amount: split.cash,
    online_amount: split.online,
    card_amount: split.card,
    created_by: ru.id,
    ...(occurredAt ? { created_at: occurredAt } : {}),
  });

  if (error) {
    // The CHECK constraint is the backstop behind `resolveSplit`; if it fires,
    // the figures disagreed by more than the shared tolerance.
    if ((error.message ?? "").includes("extra_income_split_check")) {
      return { error: "Cash, online and card together must equal the amount." };
    }
    return { error: "Could not save the income. Please try again." };
  }

  revalidatePath("/admin/finance");
  return null;
}
