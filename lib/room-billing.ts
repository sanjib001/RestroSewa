// The room folio: what a guest owes when they check out.
//
// Kept as pure functions with no database and no React, because this is the one
// piece of the hotel module that MUST agree with itself in four places at once —
// the staff folio panel, the printed bill, the payment that gets recorded, and
// the sales report. Anything computed twice eventually disagrees; this is
// computed once, here, and everything else reads the result.

export const MS_PER_NIGHT = 24 * 60 * 60 * 1000;

export type RoomChargeType =
  | "room_rate"
  | "extra_bed"
  | "laundry"
  | "mini_bar"
  | "room_service"
  | "late_checkout"
  | "early_checkin"
  | "other";

export const CHARGE_TYPES: { key: RoomChargeType; label: string }[] = [
  { key: "extra_bed", label: "Extra bed" },
  { key: "laundry", label: "Laundry" },
  { key: "mini_bar", label: "Mini bar" },
  { key: "room_service", label: "Room service" },
  { key: "late_checkout", label: "Late checkout" },
  { key: "early_checkin", label: "Early check-in" },
  { key: "other", label: "Other" },
];

export const CHARGE_LABEL: Record<RoomChargeType, string> = {
  room_rate: "Room charge",
  extra_bed: "Extra bed",
  laundry: "Laundry",
  mini_bar: "Mini bar",
  room_service: "Room service",
  late_checkout: "Late checkout",
  early_checkin: "Early check-in",
  other: "Other",
};

/**
 * Chargeable 24-hour periods in a stay.
 *
 * A part-period costs a whole one — the room was unavailable to anyone else for
 * it — so this rounds UP, and a stay always costs at least one night even if the
 * guest leaves an hour later.
 *
 *   10h → 1    24h → 1    30h → 2    48h → 2    72h → 3
 *
 * Note 24h is one night, not two: the boundary belongs to the period it closes.
 * Integer milliseconds divided by an exact power-of-two-friendly constant, so a
 * stay of exactly 48h can't land on 2.0000000001 and bill a third night.
 */
export function nightsFor(checkIn: Date | string, checkOut: Date | string): number {
  const from = new Date(checkIn).getTime();
  const to = new Date(checkOut).getTime();
  const ms = to - from;
  if (!Number.isFinite(ms) || ms <= 0) return 1;
  return Math.max(1, Math.ceil(ms / MS_PER_NIGHT));
}

/** "2 nights · 1d 6h" — the duration, spelled out, for a guest to check. */
export function stayDuration(checkIn: Date | string, checkOut: Date | string): string {
  const ms = Math.max(0, new Date(checkOut).getTime() - new Date(checkIn).getTime());
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  if (days === 0) return `${hours}h`;
  return rem === 0 ? `${days}d` : `${days}d ${rem}h`;
}

export type FolioLine = {
  key: string;
  label: string;
  /** The second line under the label — "3 × ₹2,500", "2 × Momo (Large)". */
  detail?: string;
  amount: number;
};

export type StayInput = {
  check_in_at: string;
  check_out_at: string | null;
  /** The nightly rate SNAPSHOT taken at check-in — not the room type's price today. */
  room_rate: number;
};

export type ExtraInput = {
  id: string;
  type: RoomChargeType;
  description: string;
  amount: number;
};

export type FoodInput = {
  id: string;
  item_name: string;
  item_price: number;
  quantity: number;
};

export type FolioConfig = {
  taxPercent?: number;
  servicePercent?: number;
  discount?: number;
};

export type RoomFolio = {
  checkIn: string;
  /** The checkout used for the maths: the real one, or NOW for a stay in progress. */
  checkOut: string;
  /** False once checked out — the bill is frozen and stops growing. */
  open: boolean;
  nights: number;
  duration: string;
  rate: number;

  room: FolioLine;
  extras: FolioLine[];
  food: FolioLine[];

  roomTotal: number;
  extrasTotal: number;
  foodTotal: number;

  subtotal: number;
  discount: number;
  taxPercent: number;
  tax: number;
  servicePercent: number;
  service: number;
  grandTotal: number;
};

const money = (n: number) => Math.round(n * 100) / 100;
const rupees = (n: number) => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

/**
 * The whole bill, in one object.
 *
 * The room charge is DERIVED from (check-in, check-out, rate) rather than stored,
 * so an in-progress stay re-prices itself as it lengthens — the folio a
 * receptionist is looking at is always current, with no job to run at midnight.
 * Once `check_out_at` is set the inputs stop moving, which freezes the bill
 * without needing a separate snapshot to go stale.
 *
 * `room_rate` is the rate captured AT CHECK-IN. An admin raising the room type's
 * price mid-stay must not retroactively re-bill a guest who is already in the bed.
 */
export function buildFolio(
  stay: StayInput,
  extras: ExtraInput[],
  food: FoodInput[],
  config: FolioConfig = {},
  now: Date = new Date()
): RoomFolio {
  const open = !stay.check_out_at;
  const checkOut = stay.check_out_at ?? now.toISOString();

  const nights = nightsFor(stay.check_in_at, checkOut);
  const rate = Number(stay.room_rate) || 0;
  const roomTotal = money(nights * rate);

  const room: FolioLine = {
    key: "room",
    label: "Room charge",
    detail: `${nights} × ${rupees(rate)} per night`,
    amount: roomTotal,
  };

  const extraLines: FolioLine[] = extras.map((e) => ({
    key: e.id,
    label: e.description || CHARGE_LABEL[e.type],
    detail: e.description ? CHARGE_LABEL[e.type] : undefined,
    amount: money(Number(e.amount) || 0),
  }));

  const foodLines: FolioLine[] = food.map((f) => ({
    key: f.id,
    label: f.item_name,
    detail: `${f.quantity} × ${rupees(Number(f.item_price))}`,
    amount: money(Number(f.item_price) * f.quantity),
  }));

  const extrasTotal = money(extraLines.reduce((s, l) => s + l.amount, 0));
  const foodTotal = money(foodLines.reduce((s, l) => s + l.amount, 0));
  const subtotal = money(roomTotal + extrasTotal + foodTotal);

  // Discount comes off before tax — you are not taxed on money you didn't pay.
  // It can never exceed the bill, or the guest would be owed money by arithmetic.
  const discount = money(Math.min(Math.max(config.discount ?? 0, 0), subtotal));
  const taxable = money(subtotal - discount);

  // Both percentages are taken on the discounted subtotal, matching how the
  // existing table bill ticket already computes them.
  const taxPercent = config.taxPercent ?? 0;
  const servicePercent = config.servicePercent ?? 0;
  const tax = money(taxable * (taxPercent / 100));
  const service = money(taxable * (servicePercent / 100));

  return {
    checkIn: stay.check_in_at,
    checkOut,
    open,
    nights,
    duration: stayDuration(stay.check_in_at, checkOut),
    rate,
    room,
    extras: extraLines,
    food: foodLines,
    roomTotal,
    extrasTotal,
    foodTotal,
    subtotal,
    discount,
    taxPercent,
    tax,
    servicePercent,
    service,
    grandTotal: money(taxable + tax + service),
  };
}
