"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { requireAdminOrPermission, requireRestaurantAdmin, requireRestaurantStaff } from "@/lib/auth/guards";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { revalidateRestaurantInfo } from "@/lib/restaurant-info";
import {
  verifySecurityPin,
  logSecurityEvent,
  getSecurityAuditRows,
  type SecurityAuditRow,
} from "@/lib/security/authorize";

export type ActionResult = { error: string } | { ok: true } | null;

// ─── Security PIN (Admin → Settings) ──────────────────────────────────────────
// Independent of the discount PIN. Belongs only to the restaurant admin; it is never
// shared with staff and gates sensitive financial edits. Write-only: hashed in the DB,
// never read back — this form can only SET a new one or REMOVE it.

export async function getSecurityPinStatus(): Promise<{ securityPinSet: boolean }> {
  const { restaurantUser } = await requireRestaurantAdmin();
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("restaurants")
    .select("security_pin_hash")
    .eq("id", restaurantUser.restaurant_id)
    .maybeSingle();
  // Collapsed to a boolean HERE, server-side — the hash must never reach the client.
  return { securityPinSet: !!data?.security_pin_hash };
}

export async function updateSecurityPin(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const { restaurantUser } = await requireRestaurantAdmin();
  const service = createServiceClient();

  const clearing = formData.get("clear_pin") === "1";
  const pin = ((formData.get("security_pin") as string) || "").trim();

  if (!clearing) {
    // Same 4-digit shape as the staff-login and discount PINs.
    if (!/^\d{4}$/.test(pin)) return { error: "The Security PIN must be exactly 4 digits." };
    const confirm = ((formData.get("security_pin_confirm") as string) || "").trim();
    if (confirm !== pin) return { error: "The two PINs don't match." };
  }

  // Straight into set_security_pin, which hashes it (bcrypt) inside the DB. Never stored,
  // logged or returned in plaintext.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("set_security_pin", {
    p_restaurant_id: restaurantUser.restaurant_id,
    p_pin: clearing ? null : pin,
  });
  if (error) return { error: "Could not save the Security PIN. Please try again." };

  // Written by the DB function, not a .update() — so it's the invalidation a grep for
  // `.from("restaurants").update(` would miss. Setting/clearing flips `securityEnabled`,
  // which the edit surfaces read to decide whether the Edit action can work at all.
  revalidateRestaurantInfo(restaurantUser.restaurant_id);
  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function getSecurityAuditLog(limit = 50): Promise<SecurityAuditRow[]> {
  const { restaurantUser } = await requireRestaurantAdmin();
  return getSecurityAuditRows(restaurantUser.restaurant_id, limit);
}

// ─── Gated edits ──────────────────────────────────────────────────────────────
// Each sensitive edit is admin-only (requireRestaurantAdmin) AND Security-PIN-gated. The
// PIN is verified first (logging a failure if wrong); on success the op's RPC performs the
// change and logs the success snapshot atomically; a post-auth refusal is logged as blocked.

// Friendly text for the bare coded errors the edit RPCs raise.
const EDIT_ERRORS: Record<string, string> = {
  PAYMENT_NOT_FOUND: "That payment no longer exists.",
  CANNOT_EDIT_CREDIT_PAYMENT: "Credit bills are settled in the Credits screen, not here.",
  SPLIT_MISMATCH: "The cash, online and card amounts must add up to the bill total.",
  INVALID_AMOUNT: "Amounts can't be negative.",
  PURCHASE_NOT_FOUND: "That purchase no longer exists.",
  VENDOR_NOT_FOUND: "That vendor no longer exists.",
  VENDOR_INACTIVE: "That vendor is inactive — reactivate it first.",
  NO_ITEMS: "Add at least one item.",
  INVALID_QUANTITY: "Every item needs a quantity greater than zero.",
  INVALID_UNIT_COST: "Unit cost can't be negative.",
  PRODUCT_NOT_FOUND: "One of the products no longer exists.",
  INVALID_TOTAL: "The purchase total must be greater than zero.",
  INVALID_METHOD: "Choose a valid payment method.",
  NOTHING_ON_CREDIT: "A credit purchase must leave something owing — reduce the amount paid now.",
  VENDOR_BALANCE_NEGATIVE:
    "This change would leave the vendor overpaid — you've already paid more toward this vendor than the new amount owed. Adjust the vendor's payments first.",
};

function friendlyEditError(raw: string | undefined): string {
  const msg = raw ?? "";
  for (const code of Object.keys(EDIT_ERRORS)) {
    if (msg.includes(code)) return EDIT_ERRORS[code];
  }
  return "Could not save the change. Please try again.";
}

export type PaymentTender = {
  /** The bill's full value, for display only — a discount-room stay etc. */
  total: number;
  /** Already settled by a room advance taken earlier. Not editable here — see `editable`. */
  advance: number;
  /**
   * What the cash/online/card split must add up to. Equals `total − advance`,
   * exactly what `edit_payment_tender` itself validates against — a bill part- or
   * fully-settled by a deposit can only have the REMAINDER re-split; redistributing
   * the advance too would count that deposit twice. Keep this identical to the
   * RPC's `v_total`, or the dialog accepts a split the server then rejects.
   */
  editable: number;
  cash: number;
  online: number;
  card: number;
  method: string;
};

// The current tender of a completed payment, for prefilling the edit dialog. Billing staff
// (process_payments) and admins — same gate as saving the edit below.
export async function getPaymentTender(
  paymentId: string
): Promise<PaymentTender | { error: string }> {
  const { restaurantUser } = await requireRestaurantStaff();
  if (!hasPermission(restaurantUser, PERMISSIONS.PROCESS_PAYMENTS)) {
    return { error: "You don't have permission to edit payments." };
  }
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("payments")
    .select("amount, total_amount, cash_amount, online_amount, card_amount, advance_amount, payment_method")
    .eq("id", paymentId)
    .eq("restaurant_id", restaurantUser.restaurant_id)
    .maybeSingle();

  if (!data) return { error: "That payment no longer exists." };
  const total = Number(data.total_amount ?? data.amount ?? 0);
  const advance = Number(data.advance_amount ?? 0);
  return {
    total,
    advance,
    editable: Math.max(0, total - advance),
    cash: Number(data.cash_amount ?? 0),
    online: Number(data.online_amount ?? 0),
    card: Number(data.card_amount ?? 0),
    method: data.payment_method,
  };
}

// Editing HOW a completed bill was paid (the cash/online/card split). Open to billing staff
// (process_payments), not just the admin — but still gated by the Security PIN, and every
// attempt (including a wrong PIN) is logged with the actor. Admin passes the permission check.
export async function updatePaymentTender(
  pin: string,
  paymentId: string,
  split: { cash: number; online: number; card: number }
): Promise<ActionResult> {
  const { restaurantUser } = await requireRestaurantStaff();
  if (!hasPermission(restaurantUser, PERMISSIONS.PROCESS_PAYMENTS)) {
    return { error: "You don't have permission to edit payments." };
  }

  const authorized = await verifySecurityPin(restaurantUser, "edit_payment_tender", pin, {
    type: "payment",
    id: paymentId,
  });
  if (!authorized) return { error: "Incorrect Security PIN." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("edit_payment_tender", {
    p_restaurant_id: restaurantUser.restaurant_id,
    p_actor_id: restaurantUser.id,
    p_actor_name: restaurantUser.display_name ?? null,
    p_payment_id: paymentId,
    p_cash: split.cash,
    p_online: split.online,
    p_card: split.card,
  });

  if (error) {
    // PIN was right but the edit was refused — record the attempt.
    await logSecurityEvent({
      restaurantId: restaurantUser.restaurant_id,
      actor: restaurantUser,
      operation: "edit_payment_tender",
      targetType: "payment",
      targetId: paymentId,
      outcome: "blocked",
      detail: { code: error.message },
    });
    return { error: friendlyEditError(error.message) };
  }

  for (const p of ["/admin/finance", "/admin/dashboard", "/employee/sales", "/employee/dashboard"]) {
    revalidatePath(p);
  }
  return { ok: true };
}

// ─── Room advances ────────────────────────────────────────────────────────────
// Correcting a deposit is a heavier act than re-splitting a tender. A tender edit only
// moves money between columns on a bill that already balances; an advance edit rewrites
// a figure that has ALREADY been counted into a day's cash-in-hand, with no bill to
// reconcile it against. Hence the SAME gate `edit_payment_tender` uses — Process
// Payments (the admin passes automatically) AND the Security PIN — and only while the
// stay is still open; once it is settled the advance is frozen inside a closed bill.

function friendlyAdvanceError(code: string): string {
  if (code.includes("ADVANCE_STAY_CLOSED")) {
    return "This stay has been settled — its advances can no longer be changed.";
  }
  if (code.includes("ADVANCE_NOT_FOUND")) return "That advance no longer exists.";
  if (code.includes("INVALID_ADVANCE")) return "The amount and its split don't match.";
  return "Could not update the advance.";
}

export async function updateRoomAdvance(
  pin: string,
  advanceId: string,
  split: { amount: number; cash: number; online: number; card: number; method: string }
): Promise<ActionResult> {
  const { restaurantUser } = await requireAdminOrPermission(PERMISSIONS.PROCESS_PAYMENTS);

  const authorized = await verifySecurityPin(restaurantUser, "edit_room_advance", pin, {
    type: "room_advance",
    id: advanceId,
  });
  if (!authorized) return { error: "Incorrect Security PIN." };

  const service = createServiceClient();
  // Needed only to revalidate the one page the RPC's own revalidatePath list can't
  // name — that page is keyed by stay_id, which the caller never passes in.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: advanceRow } = await (service as any)
    .from("room_advances")
    .select("stay_id")
    .eq("id", advanceId)
    .eq("restaurant_id", restaurantUser.restaurant_id)
    .maybeSingle();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("edit_room_advance", {
    p_restaurant_id: restaurantUser.restaurant_id,
    p_actor_id: restaurantUser.id,
    p_actor_name: restaurantUser.display_name ?? null,
    p_advance_id: advanceId,
    p_amount: split.amount,
    p_cash: split.cash,
    p_online: split.online,
    p_card: split.card,
    p_method: split.method,
  });

  if (error) {
    // The PIN was right but the edit was refused — record the attempt.
    await logSecurityEvent({
      restaurantId: restaurantUser.restaurant_id,
      actor: restaurantUser,
      operation: "edit_room_advance",
      targetType: "room_advance",
      targetId: advanceId,
      outcome: "blocked",
      detail: { code: error.message },
    });
    return { error: friendlyAdvanceError(error.message ?? "") };
  }

  for (const p of ["/admin/finance", "/admin/dashboard", "/employee/dashboard"]) {
    revalidatePath(p);
  }
  // Without this the cashier's own folio view for this stay keeps the pre-edit
  // split/method cached — Finance re-queries fresh and looks right, so a
  // corrected advance can silently disagree with what the front desk sees.
  if (advanceRow?.stay_id) revalidatePath(`/employee/room/${advanceRow.stay_id}`);
  return { ok: true };
}

export async function removeRoomAdvance(pin: string, advanceId: string): Promise<ActionResult> {
  const { restaurantUser } = await requireAdminOrPermission(PERMISSIONS.PROCESS_PAYMENTS);

  const authorized = await verifySecurityPin(restaurantUser, "edit_room_advance", pin, {
    type: "room_advance",
    id: advanceId,
  });
  if (!authorized) return { error: "Incorrect Security PIN." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: advanceRow } = await (service as any)
    .from("room_advances")
    .select("stay_id")
    .eq("id", advanceId)
    .eq("restaurant_id", restaurantUser.restaurant_id)
    .maybeSingle();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("delete_room_advance", {
    p_restaurant_id: restaurantUser.restaurant_id,
    p_actor_id: restaurantUser.id,
    p_actor_name: restaurantUser.display_name ?? null,
    p_advance_id: advanceId,
  });

  if (error) {
    await logSecurityEvent({
      restaurantId: restaurantUser.restaurant_id,
      actor: restaurantUser,
      operation: "edit_room_advance",
      targetType: "room_advance",
      targetId: advanceId,
      outcome: "blocked",
      detail: { code: error.message },
    });
    return { error: friendlyAdvanceError(error.message ?? "") };
  }

  for (const p of ["/admin/finance", "/admin/dashboard", "/employee/dashboard"]) {
    revalidatePath(p);
  }
  if (advanceRow?.stay_id) revalidatePath(`/employee/room/${advanceRow.stay_id}`);
  return { ok: true };
}

export type PurchaseEditInput = {
  vendorId: string;
  method: "cash" | "online" | "credit" | "mixed";
  cash: number;
  online: number;
  items: { product_id: string; quantity: number; unit_cost: number }[];
  notes: string | null;
};

export async function updatePurchase(
  pin: string,
  purchaseId: string,
  input: PurchaseEditInput
): Promise<ActionResult> {
  const { restaurantUser } = await requireRestaurantAdmin();

  const authorized = await verifySecurityPin(restaurantUser, "edit_purchase", pin, {
    type: "purchase",
    id: purchaseId,
  });
  if (!authorized) return { error: "Incorrect Security PIN." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("edit_purchase", {
    p_restaurant_id: restaurantUser.restaurant_id,
    p_actor_id: restaurantUser.id,
    p_actor_name: restaurantUser.display_name ?? null,
    p_purchase_id: purchaseId,
    p_vendor_id: input.vendorId,
    p_method: input.method,
    p_cash: input.cash,
    p_online: input.online,
    p_items: input.items,
    p_notes: input.notes,
  });

  if (error) {
    await logSecurityEvent({
      restaurantId: restaurantUser.restaurant_id,
      actor: restaurantUser,
      operation: "edit_purchase",
      targetType: "purchase",
      targetId: purchaseId,
      outcome: "blocked",
      detail: { code: error.message },
    });
    return { error: friendlyEditError(error.message) };
  }

  for (const p of ["/admin/purchases", "/admin/stock", "/admin/finance", "/admin/dashboard"]) {
    revalidatePath(p);
  }
  return { ok: true };
}

// ─── Extra expenses ───────────────────────────────────────────────────────────
// Correcting an overhead is the same class of act as correcting a room advance: the
// row has ALREADY been subtracted from a day's cash-in-hand, and unlike a bill there
// is nothing to reconcile it against — no customer, no vendor statement, no stock
// movement. A wrong figure left standing, or a right one quietly deleted, breaks a
// till count that nobody can afterwards explain. Hence admin-only AND the PIN.
//
// Unlike the advance edits, these have no RPC of their own to log success
// atomically — an expense row is a plain insert, so there is nothing for a function
// to wrap. Success is therefore logged explicitly here, which is exactly the case
// `logSecurityEvent` documents itself as covering.

/** Loads the row and proves it belongs to this restaurant before touching it. */
async function ownedExpense(restaurantId: string, expenseId: string) {
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("extra_expenses")
    .select("id, category, amount, payment_method, cash_amount, online_amount, saving_title_id")
    .eq("id", expenseId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  return data ?? null;
}

export async function updateExtraExpense(
  pin: string,
  expenseId: string,
  next: {
    category: string;
    note: string | null;
    amount: number;
    method: string;
    cash: number;
    online: number;
    /** Which pot a saving belongs to. Ignored for every other category. */
    savingTitleId?: string | null;
  }
): Promise<ActionResult> {
  const { restaurantUser } = await requireRestaurantAdmin();

  const authorized = await verifySecurityPin(restaurantUser, "edit_extra_expense", pin, {
    type: "extra_expense",
    id: expenseId,
  });
  if (!authorized) return { error: "Incorrect Security PIN." };

  const before = await ownedExpense(restaurantUser.restaurant_id, expenseId);
  if (!before) return { error: "That expense no longer exists." };

  // A saving stays a saving and an expense stays an expense. Letting the category
  // cross that line would mean a row losing or gaining a pot mid-edit, which the
  // DB constraint would reject anyway — better to say so plainly than surface a
  // constraint violation.
  const isSaving = before.category === "saving";
  const category = isSaving ? "saving" : next.category;
  if (!isSaving && next.category === "saving") {
    return { error: "An expense cannot be turned into a saving. Delete it and record it again." };
  }

  // A withdrawal stays a withdrawal. The form works in positive numbers — nobody
  // types "minus three thousand" — so the sign is re-applied here from the row
  // being edited rather than trusted from the client.
  const wasWithdrawal = isSaving && Number(before.amount) < 0;
  const sign = wasWithdrawal ? -1 : 1;
  const amount = Math.abs(next.amount) * sign;
  const cash = Math.abs(next.cash) * sign;
  const online = Math.abs(next.online) * sign;

  let savingTitleId: string | null = null;
  if (isSaving) {
    savingTitleId = next.savingTitleId ?? before.saving_title_id ?? null;
    if (!savingTitleId) return { error: "Choose which saving this goes into." };

    const svc = createServiceClient();
    // Tenancy again: the pot must be this restaurant's, or an edit could move
    // money into another tenant's saving.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: title } = await (svc as any)
      .from("saving_titles")
      .select("id, opening_amount")
      .eq("id", savingTitleId)
      .eq("restaurant_id", restaurantUser.restaurant_id)
      .maybeSingle();
    if (!title) return { error: "That saving no longer exists." };

    // Growing a withdrawal — or moving it to a smaller pot — must not take that
    // pot negative. The balance is measured WITHOUT this row, since this row is
    // about to be replaced.
    if (wasWithdrawal) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rows } = await (svc as any)
        .from("extra_expenses")
        .select("id, amount")
        .eq("restaurant_id", restaurantUser.restaurant_id)
        .eq("saving_title_id", savingTitleId);
      // Includes the pot's opening balance, exactly as `withdrawSaving` does —
      // if these two measured "held" differently, an amount accepted on create
      // would be refused on edit.
      const heldWithoutThis =
        Number(title.opening_amount ?? 0) +
        ((rows ?? []) as { id: string; amount: number }[])
          .filter((r) => r.id !== expenseId)
          .reduce((s, r) => s + Number(r.amount ?? 0), 0);
      if (Math.abs(amount) > heldWithoutThis + 0.005) {
        return { error: "That is more than this saving holds." };
      }
    }
  }

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("extra_expenses")
    .update({
      category,
      note: next.note,
      amount,
      payment_method: next.method,
      cash_amount: cash,
      online_amount: online,
      saving_title_id: savingTitleId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", expenseId)
    .eq("restaurant_id", restaurantUser.restaurant_id);

  if (error) {
    await logSecurityEvent({
      restaurantId: restaurantUser.restaurant_id,
      actor: restaurantUser,
      operation: "edit_extra_expense",
      targetType: "extra_expense",
      targetId: expenseId,
      outcome: "blocked",
      detail: { code: error.message },
    });
    return {
      error: (error.message ?? "").includes("extra_expenses_split_check")
        ? "Cash and online together must equal the amount."
        : "Could not update the expense.",
    };
  }

  // The BEFORE figures are the point of this record: the row itself now holds only
  // the corrected values, so without them the log would say an edit happened but
  // not what it changed — which is the one question anyone asks it afterwards.
  await logSecurityEvent({
    restaurantId: restaurantUser.restaurant_id,
    actor: restaurantUser,
    operation: "edit_extra_expense",
    targetType: "extra_expense",
    targetId: expenseId,
    outcome: "success",
    detail: {
      before: {
        category: before.category,
        amount: Number(before.amount),
        method: before.payment_method,
        cash: Number(before.cash_amount),
        online: Number(before.online_amount),
        savingTitleId: before.saving_title_id ?? null,
      },
      after: {
        category,
        amount,
        method: next.method,
        cash,
        online,
        savingTitleId,
      },
    },
  });

  for (const p of ["/admin/expenses", "/admin/finance", "/admin/dashboard"]) {
    revalidatePath(p);
  }
  return { ok: true };
}

export async function removeExtraExpense(pin: string, expenseId: string): Promise<ActionResult> {
  const { restaurantUser } = await requireRestaurantAdmin();

  const authorized = await verifySecurityPin(restaurantUser, "delete_extra_expense", pin, {
    type: "extra_expense",
    id: expenseId,
  });
  if (!authorized) return { error: "Incorrect Security PIN." };

  const before = await ownedExpense(restaurantUser.restaurant_id, expenseId);
  if (!before) return { error: "That expense no longer exists." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("extra_expenses")
    .delete()
    .eq("id", expenseId)
    .eq("restaurant_id", restaurantUser.restaurant_id);

  if (error) {
    await logSecurityEvent({
      restaurantId: restaurantUser.restaurant_id,
      actor: restaurantUser,
      operation: "delete_extra_expense",
      targetType: "extra_expense",
      targetId: expenseId,
      outcome: "blocked",
      detail: { code: error.message },
    });
    return { error: "Could not delete the expense." };
  }

  // A deletion leaves nothing behind, so the audit row IS the only remaining
  // record that this money was ever recorded as spent.
  await logSecurityEvent({
    restaurantId: restaurantUser.restaurant_id,
    actor: restaurantUser,
    operation: "delete_extra_expense",
    targetType: "extra_expense",
    targetId: expenseId,
    outcome: "success",
    detail: {
      deleted: {
        category: before.category,
        amount: Number(before.amount),
        method: before.payment_method,
        cash: Number(before.cash_amount),
        online: Number(before.online_amount),
      },
    },
  });

  for (const p of ["/admin/expenses", "/admin/finance", "/admin/dashboard"]) {
    revalidatePath(p);
  }
  return { ok: true };
}
