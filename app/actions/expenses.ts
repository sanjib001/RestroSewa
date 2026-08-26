"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { STOCK_ACCESS } from "@/lib/permissions";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";
import { periodBounds } from "@/lib/finance";
import type { FinancePeriod } from "@/lib/finance";
import { historyPeriodBounds, type HistoryPeriod } from "@/lib/history-period";
import { resolveSplit } from "@/lib/payment-split";
import { expenseCategoryLabel, isSpendingCategory } from "@/lib/expenses";
import type { ExpenseCategory, ExtraExpense, SavingTitle } from "@/lib/expenses";

export type ActionResult = { error: string } | null;

const SELECT =
  "id, category, note, amount, payment_method, cash_amount, online_amount, created_at, updated_at, saving_title_id, " +
  "restaurant_users!extra_expenses_created_by_fkey ( display_name ), " +
  "saving_titles ( name )";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapExpenses(data: any): ExtraExpense[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    category: r.category as ExpenseCategory,
    categoryLabel: expenseCategoryLabel(r.category),
    note: r.note ?? null,
    amount: Number(r.amount ?? 0),
    method: r.payment_method,
    cash: Number(r.cash_amount ?? 0),
    online: Number(r.online_amount ?? 0),
    createdAt: r.created_at,
    createdByName: r.restaurant_users?.display_name ?? null,
    updatedAt: r.updated_at ?? null,
    savingTitleId: r.saving_title_id ?? null,
    savingTitleName: r.saving_titles?.name ?? null,
  }));
}

// ─── Reading ──────────────────────────────────────────────────────────────────

/**
 * The period's expenses, newest first.
 *
 * Periods resolve through `periodBounds` on the restaurant's own closing hour,
 * exactly like the Finance report — so the list on this page and the "Extra
 * expenses" figure on the report always cover the same hours. Working the day
 * out here instead would eventually disagree with the report and there would be
 * no way to tell which was right.
 */
export async function listExtraExpenses(params?: {
  period?: FinancePeriod;
  from?: string | null;
  to?: string | null;
}): Promise<ExtraExpense[]> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canViewExpenses(ru)) return [];

  // The add-only holder sees TODAY and nothing else. Forced HERE, on the server,
  // rather than by hiding the period picker: the picker is a convenience, this is
  // the rule. A crafted call asking for "year" gets today.
  const todayOnly = STOCK_ACCESS.expensesTodayOnly(ru);
  const period = todayOnly ? "today" : params?.period ?? "month";
  const { from, to } = periodBounds(
    period,
    ru.closingHour,
    todayOnly ? null : params?.from,
    todayOnly ? null : params?.to
  );

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("extra_expenses")
    .select(SELECT)
    .eq("restaurant_id", ru.restaurant_id)
    // Savings are excluded: they have their own section, where they are grouped
    // by pot. Listing them here too would show the same money twice.
    .neq("category", "saving")
    .gte("created_at", from.toISOString())
    .lt("created_at", to.toISOString())
    .order("created_at", { ascending: false });

  return mapExpenses(data);
}

// ─── Writing ──────────────────────────────────────────────────────────────────

/**
 * Parse and validate the form's amount + tender split.
 *
 * `resolveSplit` is the shared parser every other tender in the app uses, so the
 * tolerance and the wording of a mismatch are identical here. It returns nulls
 * for a non-mixed method — meaning "derive it from the method" — which the
 * DB functions handle but a plain insert does not, so the two single-tender
 * cases are resolved explicitly below.
 */
function resolveExpenseSplit(
  amount: number,
  method: string,
  formData: FormData
): { cash: number; online: number } | { error: string } {
  if (method === "cash") return { cash: amount, online: 0 };
  if (method === "online") return { cash: 0, online: amount };

  const split = resolveSplit(
    "mixed",
    amount,
    String(formData.get("cash_amount") ?? ""),
    String(formData.get("online_amount") ?? "")
  );
  if (!split.ok) return { error: split.error };
  return { cash: split.cash ?? 0, online: split.online ?? 0 };
}

export async function addExtraExpense(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  // Filing an expense is the ADD gate, not the manage gate — `add_expenses`
  // exists precisely so the person who pays the bills can record them without
  // being shown the totals.
  if (!STOCK_ACCESS.canAddExpenses(ru)) {
    return { error: "You don't have permission to record expenses." };
  }

  const category = String(formData.get("category") ?? "").toLowerCase();
  const note = String(formData.get("note") ?? "").trim();
  const amount = parseFloat(String(formData.get("amount") ?? "0")) || 0;
  const method = String(formData.get("method") ?? "cash").toLowerCase();

  // `saving` is rejected here on purpose: a saving needs a pot to file it under,
  // and this form has no way to choose one. It is recorded from the Saving
  // section instead, via `addSaving`.
  if (!isSpendingCategory(category)) return { error: "Choose what the expense was for." };
  if (amount <= 0) return { error: "Enter the amount." };
  if (!["cash", "online", "mixed"].includes(method)) {
    return { error: "Choose how it was paid." };
  }

  const split = resolveExpenseSplit(amount, method, formData);
  if ("error" in split) return { error: split.error };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).from("extra_expenses").insert({
    restaurant_id: ru.restaurant_id,
    category,
    note: note || null,
    amount,
    payment_method: method,
    cash_amount: split.cash,
    online_amount: split.online,
    created_by: ru.id,
  });

  if (error) {
    // The CHECK constraint is the backstop behind `resolveSplit`; if it fires,
    // the two figures disagreed by more than the shared tolerance.
    if ((error.message ?? "").includes("extra_expenses_split_check")) {
      return { error: "Cash and online together must equal the amount." };
    }
    return { error: "Could not save the expense. Please try again." };
  }

  revalidatePath("/admin/expenses");
  revalidatePath("/admin/finance");
  return null;
}

// ─── Savings ─────────────────────────────────────────────────────────────────
// (see below — deposits, withdrawals and the pots themselves)
//
// A saving is an extra expense with a pot. Everything financial about it is
// already handled by being an `extra_expenses` row — the tender split, the four
// balances, the ledger, the CSV, the PDF, the profit subtraction. The only thing
// added here is the pot, and pots exist ONLY on this page: Finance shows a single
// "Saving" line and never the per-title detail, by design.

/**
 * Every pot with its ALL-TIME total.
 *
 * Deliberately not period-filtered. A pot's size is not a period concept — "how
 * much is in the emergency fund" has one answer, and showing a month's worth of
 * it under the same heading would be actively misleading.
 */
export async function listSavingTitles(): Promise<SavingTitle[]> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canViewExpenses(ru)) return [];

  // For the add-only holder the running balance is never computed, never mind
  // sent: the saving rows are filtered to today BEFORE they are summed, and the
  // pot's opening amount is not read at all. There is no total in the payload
  // for a client bug to reveal.
  const todayOnly = STOCK_ACCESS.expensesTodayOnly(ru);
  const today = todayOnly ? periodBounds("today", ru.closingHour) : null;

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rowsQuery = (service as any)
    .from("extra_expenses")
    .select("saving_title_id, amount, cash_amount, online_amount")
    .eq("restaurant_id", ru.restaurant_id)
    .eq("category", "saving");
  if (today) {
    rowsQuery = rowsQuery
      .gte("created_at", today.from.toISOString())
      .lt("created_at", today.to.toISOString());
  }

  const [titlesRes, rowsRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("saving_titles")
      .select(
        todayOnly
          ? "id, name, created_at, closed_at"
          : "id, name, created_at, opening_amount, closed_at"
      )
      .eq("restaurant_id", ru.restaurant_id)
      // Closed pots are RETURNED, not filtered out — their history has to stay
      // reachable, and Finance still counts their rows. The screen collapses them into
      // a "Closed" group and the "file into" picker drops them; see `closedAt`.
      .order("created_at", { ascending: true }),
    rowsQuery,
  ]);

  // Totalled here rather than in SQL: an aggregate would need its own RPC, and a
  // restaurant has a handful of pots, not thousands. Two round trips either way.
  const totals = new Map<string, { total: number; cash: number; online: number; n: number }>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (rowsRes?.data ?? []) as any[]) {
    const key = r.saving_title_id as string;
    const t = totals.get(key) ?? { total: 0, cash: 0, online: 0, n: 0 };
    t.total += Number(r.amount ?? 0);
    t.cash += Number(r.cash_amount ?? 0);
    t.online += Number(r.online_amount ?? 0);
    t.n += 1;
    totals.set(key, t);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((titlesRes?.data ?? []) as any[]).map((t) => {
    const agg = totals.get(t.id);
    // The pot started with whatever was already set aside before the app knew
    // about it. That figure is part of the BALANCE but of neither tender leg —
    // no money moved when it was typed in. See migration 20260817000000.
    const opening = todayOnly ? 0 : Number(t.opening_amount ?? 0);
    return {
      id: t.id,
      name: t.name,
      total: opening + (agg?.total ?? 0),
      openingAmount: opening,
      cash: agg?.cash ?? 0,
      online: agg?.online ?? 0,
      entryCount: agg?.n ?? 0,
      createdAt: t.created_at,
      closedAt: t.closed_at ?? null,
      todayOnly,
    };
  });
}

/**
 * Every saving filed, newest first — the list that lives under ONE pot.
 * `period` narrows it (default "month" — a pot's own BALANCE is never
 * period-scoped, see `listSavingTitles`, but its transaction HISTORY is a
 * different thing and can get long enough to want narrowing). The filter is
 * per-pot, not a single control over every pot at once — hence `savingTitleId`
 * is required, not optional: this always answers "this pot's history", never
 * "every pot's, mixed together".
 */
export async function listSavings(
  savingTitleId: string,
  period: HistoryPeriod = "month",
  date: string | null = null
): Promise<ExtraExpense[]> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canViewExpenses(ru)) return [];

  // Same rule as `listExtraExpenses`: the add-only holder sees TODAY and nothing
  // else, forced HERE rather than by hiding the picker — a crafted call asking
  // for "year" gets today regardless of what the client sent.
  const todayOnly = STOCK_ACCESS.expensesTodayOnly(ru);
  const effectivePeriod = todayOnly ? "today" : period;
  const effectiveDate = todayOnly ? null : date;

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (service as any)
    .from("extra_expenses")
    .select(SELECT)
    .eq("restaurant_id", ru.restaurant_id)
    .eq("category", "saving")
    .eq("saving_title_id", savingTitleId);

  if (effectiveDate || effectivePeriod !== "all") {
    const { from, to } = historyPeriodBounds(effectivePeriod, ru.closingHour, effectiveDate);
    query = query.gte("created_at", from.toISOString()).lt("created_at", to.toISOString());
  }

  const { data } = await query.order("created_at", { ascending: false });

  return mapExpenses(data);
}

export async function createSavingTitle(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canManageExpenses(ru)) {
    return { error: "You do not have permission to manage savings." };
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Enter a name for this saving." };
  if (name.length > 60) return { error: "That name is too long." };

  // What the pot already held before the app was tracking it. Optional, and it
  // moves NO money: no expense row, no cash leg, no ledger entry, no effect on
  // profit. See migration 20260817000000 for why writing it as a saving row —
  // the obvious implementation — would misreport today's takings.
  const openingRaw = String(formData.get("opening_amount") ?? "").trim();
  const opening = openingRaw === "" ? 0 : parseFloat(openingRaw);
  if (!Number.isFinite(opening) || opening < 0) {
    return { error: "Enter a valid amount already collected, or leave it blank." };
  }

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("saving_titles")
    .insert({
      restaurant_id: ru.restaurant_id,
      name,
      created_by: ru.id,
      opening_amount: Math.round(opening * 100) / 100,
    });

  if (error) {
    // The unique index is case-insensitive, so this also catches "emergency fund"
    // against an existing "Emergency Fund" — which is the whole point of it.
    if ((error.code ?? "") === "23505") {
      return { error: "You already have a saving with that name." };
    }
    return { error: "Could not create the saving. Please try again." };
  }

  revalidatePath("/admin/expenses");
  return null;
}

/**
 * Rename a pot.
 *
 * The reason titles are a table rather than free text: this changes the name
 * everywhere at once, including on savings filed months ago, without touching a
 * single expense row.
 */
export async function renameSavingTitle(id: string, name: string): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canManageExpenses(ru)) {
    return { error: "You do not have permission to manage savings." };
  }
  const clean = name.trim();
  if (!clean) return { error: "Enter a name." };
  if (clean.length > 60) return { error: "That name is too long." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("saving_titles")
    .update({ name: clean })
    .eq("id", id)
    .eq("restaurant_id", ru.restaurant_id);

  if (error) {
    if ((error.code ?? "") === "23505") {
      return { error: "You already have a saving with that name." };
    }
    return { error: "Could not rename the saving." };
  }

  revalidatePath("/admin/expenses");
  return null;
}

/**
 * Delete a pot — only ever an empty one.
 *
 * The FK is `on delete restrict`, so a pot with money filed under it cannot be
 * removed even if this check were bypassed. That matters: deleting it silently
 * would strand rows that Finance still counts, and the Saving section would stop
 * agreeing with the "Saving" line on the report.
 */
export async function deleteSavingTitle(id: string): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canManageExpenses(ru)) {
    return { error: "You do not have permission to manage savings." };
  }

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count } = await (service as any)
    .from("extra_expenses")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", ru.restaurant_id)
    .eq("saving_title_id", id);

  // ⚠️ ENTRIES, not balance — and the message must say so.
  //
  // It used to read "This saving has money in it", which is false for the case that
  // actually hits it: a pot deposited into and then fully withdrawn holds nothing and
  // still has rows. Those rows are dated cash movements Finance has already counted,
  // so they cannot be removed to make the pot deletable. Such a pot is CLOSED
  // instead — see closeSavingTitle.
  if ((count ?? 0) > 0) {
    return {
      error:
        "This saving already has entries, so deleting it would take real cash movements " +
        "out of Finance. Withdraw whatever is left and close it instead.",
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("saving_titles")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", ru.restaurant_id);

  if (error) return { error: "Could not delete the saving." };

  revalidatePath("/admin/expenses");
  revalidatePath("/employee/expenses");
  return null;
}

/**
 * The pot's balance right now: its opening amount plus every row filed against it
 * (withdrawals are negative rows, so they are already netted).
 *
 * Read server-side rather than trusted from the client for the same reason the rest of
 * this file does it: the number decides whether a pot may be retired.
 */
async function savingBalance(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any,
  restaurantId: string,
  id: string
): Promise<{ balance: number; entries: number } | null> {
  const [titleRes, rowsRes] = await Promise.all([
    service
      .from("saving_titles")
      .select("id, opening_amount")
      .eq("id", id)
      .eq("restaurant_id", restaurantId)
      .maybeSingle(),
    service
      .from("extra_expenses")
      .select("amount")
      .eq("restaurant_id", restaurantId)
      .eq("saving_title_id", id),
  ]);

  if (!titleRes.data) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (rowsRes.data ?? []) as any[];
  const net = rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  return {
    balance: Number(titleRes.data.opening_amount ?? 0) + net,
    entries: rows.length,
  };
}

/**
 * Retire an EMPTIED pot.
 *
 * Closing rather than deleting is not a compromise — it is the only correct answer for
 * a pot that has history. Its saving rows are dated cash movements that already moved
 * the day's closing cash and were already reported; removing them to make the pot
 * disappear would rewrite a settled day. So the money stays exactly where it is and
 * only the pot leaves the screen.
 *
 * Requires a ZERO balance: closing a pot with money still in it would hide the money.
 */
export async function closeSavingTitle(id: string): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canManageExpenses(ru)) {
    return { error: "You do not have permission to manage savings." };
  }

  const service = createServiceClient();
  const state = await savingBalance(service, ru.restaurant_id, id);
  if (!state) return { error: "That saving no longer exists." };

  // Paisa tolerance, matching every other money comparison in the app.
  if (Math.abs(state.balance) > 0.005) {
    return {
      error:
        `This saving still holds ₹${state.balance.toFixed(2)}. ` +
        `Withdraw the balance first — closing it now would hide the money.`,
    };
  }

  // A pot that never held anything has no history worth keeping; deleting is cleaner
  // and is still offered. Closing is for the ones that cannot be deleted.
  if (state.entries === 0) {
    return deleteSavingTitle(id);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("saving_titles")
    .update({ closed_at: new Date().toISOString(), closed_by: ru.id })
    .eq("id", id)
    .eq("restaurant_id", ru.restaurant_id)
    // Idempotent: closing an already-closed pot must not move `closed_at` and rewrite
    // who retired it.
    .is("closed_at", null);

  if (error) return { error: "Could not close the saving." };

  revalidatePath("/admin/expenses");
  revalidatePath("/employee/expenses");
  return null;
}

/** Undo a close. A pot retired by mistake must not be a dead end. */
export async function reopenSavingTitle(id: string): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canManageExpenses(ru)) {
    return { error: "You do not have permission to manage savings." };
  }

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("saving_titles")
    .update({ closed_at: null, closed_by: null })
    .eq("id", id)
    .eq("restaurant_id", ru.restaurant_id);

  if (error) {
    // The name index is unique among OPEN pots only, so reopening can collide with a
    // pot created under the same name in the meantime.
    return {
      error:
        "Could not reopen this saving — another open saving already uses its name. " +
        "Rename that one first.",
    };
  }

  revalidatePath("/admin/expenses");
  revalidatePath("/employee/expenses");
  return null;
}

/** File money into a pot. Identical to an expense in every financial respect. */
export async function addSaving(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  // Putting money IN is the add gate. Taking it out (withdrawSaving) is not, and
  // deliberately stays on `manage_expenses`: "Add Expenses & Saving" adds.
  if (!STOCK_ACCESS.canAddExpenses(ru)) {
    return { error: "You do not have permission to record savings." };
  }

  const titleId = String(formData.get("saving_title_id") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  const amount = parseFloat(String(formData.get("amount") ?? "0")) || 0;
  const method = String(formData.get("method") ?? "cash").toLowerCase();

  if (!titleId) return { error: "Choose which saving this goes into." };
  if (amount <= 0) return { error: "Enter the amount." };
  if (!["cash", "online", "mixed"].includes(method)) return { error: "Choose how it was paid." };

  const split = resolveExpenseSplit(amount, method, formData);
  if ("error" in split) return { error: split.error };

  const service = createServiceClient();
  // Tenancy: the pot must belong to THIS restaurant, or one restaurant could file
  // money into another's. The foreign key alone does not check that.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: title } = await (service as any)
    .from("saving_titles")
    .select("id")
    .eq("id", titleId)
    .eq("restaurant_id", ru.restaurant_id)
    .maybeSingle();
  if (!title) return { error: "That saving no longer exists." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).from("extra_expenses").insert({
    restaurant_id: ru.restaurant_id,
    category: "saving",
    note: note || null,
    amount,
    payment_method: method,
    cash_amount: split.cash,
    online_amount: split.online,
    saving_title_id: titleId,
    created_by: ru.id,
  });

  if (error) {
    if ((error.message ?? "").includes("extra_expenses_split_check")) {
      return { error: "Cash and online together must equal the amount." };
    }
    return { error: "Could not save. Please try again." };
  }

  revalidatePath("/admin/expenses");
  revalidatePath("/admin/finance");
  return null;
}

/**
 * Take money back out of a pot.
 *
 * A withdrawal is a NEGATIVE saving row — the same shape `room_advances` uses for
 * a refund, and for the same reason: every figure in the app already SUMS these
 * rows, so the signs do all the work. The pot balance, the period total, the two
 * cash balances and the ledger delta all come out right with no second table, no
 * direction flag and no change to either finance function.
 *
 * The form collects a POSITIVE amount — "withdraw 3,000" is what a person means —
 * and it is negated here, once, at the boundary. Letting a negative number reach
 * the form would invite someone to type one into a deposit.
 */
export async function withdrawSaving(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canManageExpenses(ru)) {
    return { error: "You do not have permission to record savings." };
  }

  const titleId = String(formData.get("saving_title_id") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  const amount = parseFloat(String(formData.get("amount") ?? "0")) || 0;
  const method = String(formData.get("method") ?? "cash").toLowerCase();

  if (!titleId) return { error: "Choose which saving to take from." };
  if (amount <= 0) return { error: "Enter the amount." };
  if (!["cash", "online", "mixed"].includes(method)) return { error: "Choose how it was taken." };

  const split = resolveExpenseSplit(amount, method, formData);
  if ("error" in split) return { error: split.error };

  const service = createServiceClient();
  // Tenancy AND balance in one read: the pot must be this restaurant's, and it
  // must actually hold the money. Without the balance check a pot could be taken
  // negative, which would report as money the restaurant never had.
  const [titleRes, rowsRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("saving_titles")
      .select("id, name, opening_amount")
      .eq("id", titleId)
      .eq("restaurant_id", ru.restaurant_id)
      .maybeSingle(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("extra_expenses")
      .select("amount")
      .eq("restaurant_id", ru.restaurant_id)
      .eq("saving_title_id", titleId),
  ]);

  if (!titleRes?.data) return { error: "That saving no longer exists." };

  // The opening balance COUNTS as held. That money physically exists — it was
  // set aside before the app was tracking it — so a pot that is mostly opening
  // balance must still be drawable, or the feature would create money the
  // restaurant cannot reach. Taking it out IS a real movement (cash comes back
  // into the till today), which is why the withdrawal is a normal signed row
  // even though the opening figure never was one.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const held =
    Number(titleRes.data.opening_amount ?? 0) +
    ((rowsRes?.data ?? []) as any[]).reduce((s, r) => s + Number(r.amount ?? 0), 0);
  if (amount > held + 0.005) {
    return {
      error:
        held <= 0
          ? "There is nothing in this saving to take out."
          : `This saving only holds ₹${held.toLocaleString("en-IN", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}.`,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).from("extra_expenses").insert({
    restaurant_id: ru.restaurant_id,
    category: "saving",
    note: note || null,
    amount: -amount,
    payment_method: method,
    cash_amount: -split.cash,
    online_amount: -split.online,
    saving_title_id: titleId,
    created_by: ru.id,
  });

  if (error) {
    if ((error.message ?? "").includes("extra_expenses_split_check")) {
      return { error: "Cash and online together must equal the amount." };
    }
    return { error: "Could not record the withdrawal. Please try again." };
  }

  revalidatePath("/admin/expenses");
  revalidatePath("/admin/finance");
  return null;
}

// ─── Dashboard summary ────────────────────────────────────────────────────────

/**
 * The Extra Expenses card on the staff dashboard.
 *
 * Permission-aware by construction rather than by the caller remembering to
 * check: an add-only holder gets today's figures and `savingsHeld: null`. The
 * pot balance is not fetched for them at all, so there is no number in the
 * payload for a careless render to print.
 */
export type ExpenseSummary = {
  todayTotal: number;
  todayCash: number;
  todayOnline: number;
  todayCount: number;
  /** All-time savings held, or null when the viewer may not see running totals. */
  savingsHeld: number | null;
};

const EMPTY_EXPENSE_SUMMARY: ExpenseSummary = {
  todayTotal: 0,
  todayCash: 0,
  todayOnline: 0,
  todayCount: 0,
  savingsHeld: null,
};

export async function getExpenseSummary(): Promise<ExpenseSummary> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canViewExpenses(ru)) return EMPTY_EXPENSE_SUMMARY;

  const todayOnly = STOCK_ACCESS.expensesTodayOnly(ru);
  const { from, to } = periodBounds("today", ru.closingHour);
  const service = createServiceClient();

  const [todayRes, potsRes] = await Promise.all([
    // Savings excluded, exactly as the Expenses list excludes them: they are
    // counted under savings, and adding them here would double the same money.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("extra_expenses")
      .select("amount, cash_amount, online_amount")
      .eq("restaurant_id", ru.restaurant_id)
      .neq("category", "saving")
      .gte("created_at", from.toISOString())
      .lt("created_at", to.toISOString()),
    todayOnly
      ? Promise.resolve(null)
      : Promise.all([
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (service as any)
            .from("extra_expenses")
            .select("amount")
            .eq("restaurant_id", ru.restaurant_id)
            .eq("category", "saving"),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (service as any)
            .from("saving_titles")
            .select("opening_amount")
            .eq("restaurant_id", ru.restaurant_id),
        ]),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (todayRes?.data ?? []) as any[];

  let savingsHeld: number | null = null;
  if (potsRes) {
    const [savingRows, titleRows] = potsRes;
    savingsHeld =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((savingRows?.data ?? []) as any[]).reduce((s, r) => s + Number(r.amount ?? 0), 0) +
      // The pots' opening balances count towards what is held — see
      // migration 20260817000000. They move no cash; they are still in the pot.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((titleRows?.data ?? []) as any[]).reduce((s, r) => s + Number(r.opening_amount ?? 0), 0);
  }

  return {
    todayTotal: rows.reduce((s, r) => s + Number(r.amount ?? 0), 0),
    todayCash: rows.reduce((s, r) => s + Number(r.cash_amount ?? 0), 0),
    todayOnline: rows.reduce((s, r) => s + Number(r.online_amount ?? 0), 0),
    todayCount: rows.length,
    savingsHeld,
  };
}
