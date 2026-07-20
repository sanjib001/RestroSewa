// Shared Stock & Finance vocabulary and date maths. Kept out of the "use server"
// action files so the screens and the actions agree on what "today" means and on
// when a product counts as low or out — the two can never drift apart.

import { businessDayBounds, businessToday } from "@/lib/business-day";

export type StockStatus = "ok" | "low" | "out";

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  ok: "In stock",
  low: "Low",
  out: "Out of stock",
};

export const STOCK_STATUS_COLOR: Record<StockStatus, string> = {
  ok: "#1a7a4a",
  low: "#f97316",
  out: "#dc2626",
};

/**
 * A product is "out" once nothing is left (a negative level means it was oversold
 * — still out). It is "low" at or below its threshold, but only when a threshold
 * has actually been set; a threshold of 0 means "don't warn me".
 */
export function stockStatus(closing: number, threshold: number): StockStatus {
  if (closing <= 0) return "out";
  if (threshold > 0 && closing <= threshold) return "low";
  return "ok";
}

/**
 * Bounds for one BUSINESS day (YYYY-MM-DD) — see `lib/business-day.ts`, which
 * holds the single definition the whole app shares, so a stock day and a sales
 * day always line up.
 *
 * The upper bound is exclusive, which is what makes the rollover exact: a day's
 * closing balance and the next day's opening balance are evaluated at the very
 * same instant, so they cannot disagree.
 */
export function dayBounds(day: string | null | undefined, hour: number): { from: Date; to: Date } {
  return businessDayBounds(day, hour);
}

/** The business day we're currently inside, as YYYY-MM-DD (local, never UTC). */
export function todayISO(hour: number): string {
  return businessToday(hour);
}

/** Trims trailing zeros so 2.500 shows as 2.5 and 3.000 as 3. */
export function qty(n: number): string {
  return Number(n.toFixed(3)).toLocaleString("en-IN");
}

// ─── Manual stock movements ───────────────────────────────────────────────────
// Stock leaves for reasons other than a sale: the kitchen uses rice and oil,
// things spoil, staff eat. Every reason below removes stock, except `adjustment`,
// which is a correction and may go either way.

export type StockReason =
  | "kitchen_usage"
  | "waste"
  | "damage"
  | "staff_consumption"
  | "adjustment"
  | "other";

export const STOCK_REASONS: { value: StockReason; label: string }[] = [
  { value: "kitchen_usage", label: "Kitchen Usage" },
  { value: "waste", label: "Waste" },
  { value: "damage", label: "Damage" },
  { value: "staff_consumption", label: "Staff Consumption" },
  { value: "adjustment", label: "Adjustment" },
  { value: "other", label: "Other" },
];

export const STOCK_REASON_LABEL: Record<string, string> = {
  kitchen_usage: "Kitchen Usage",
  waste: "Waste",
  damage: "Damage",
  staff_consumption: "Staff Consumption",
  adjustment: "Adjustment",
  other: "Other",
  // Written before the reason list existed; still valid in the DB.
  wastage: "Waste",
};

/** Only a correction may ADD stock — every other reason consumes it. */
export const CAN_ADD_STOCK = (reason: string) => reason === "adjustment";

// ─── Cancellation reasons ─────────────────────────────────────────────────────
// Ordering an item reserves its stock immediately. These are the four ways that
// reservation is released again — the item was never actually consumed.

export const CANCEL_REASON_LABEL: Record<string, string> = {
  order_rejected: "Order Rejected",
  session_closed: "Session Closed",
  order_cancelled: "Order Cancelled",
  item_cancelled: "Item Cancelled",
};

// ─── Product history ──────────────────────────────────────────────────────────

export type MovementKind = "opening" | "purchase" | "sale" | "restore" | "manual";

export type StockMovement = {
  at: string;
  kind: MovementKind;
  /** Signed: + adds stock, − removes it. */
  qty: number;
  /** The manual reason, when kind is `manual`. */
  reason: string | null;
  /** Purchase code, or the menu item that sold it. */
  ref: string | null;
  /** Purchase context — null on every other kind of movement. */
  vendor_name: string | null;
  vendor_code: string | null;
  /** What this line of the purchase cost. */
  amount: number | null;
  /** How that purchase was paid: cash / online / credit. */
  method: string | null;
  staff_name: string | null;
  /** Stock on hand AFTER this movement. */
  balance: number;
};

/**
 * What to call a movement. A manual one is named by the REASON the admin picked
 * ("Kitchen Usage", "Waste") rather than a generic "Manual Deduction" — the
 * reason is the whole point of recording it.
 */
export function movementLabel(m: { kind: MovementKind; reason: string | null }): string {
  switch (m.kind) {
    case "opening":
      return "Opening stock";
    case "purchase":
      return "Purchase";
    case "sale":
      return "POS Sale";
    case "restore":
      // Named by WHY the reservation was released — that is the whole audit point.
      return m.reason ? CANCEL_REASON_LABEL[m.reason] ?? m.reason : "Stock Restored";
    case "manual":
      if (m.reason === "adjustment") return "Stock Adjustment";
      return m.reason ? STOCK_REASON_LABEL[m.reason] ?? m.reason : "Manual Deduction";
  }
}

export const MOVEMENT_COLOR: Record<MovementKind, string> = {
  opening: "var(--color-ink-mute)",
  purchase: "#1a7a4a", // stock in
  sale: "#dc2626", // stock out
  restore: "#1a7a4a", // stock back in — the reservation was released
  manual: "#f97316", // stock out by hand
};
