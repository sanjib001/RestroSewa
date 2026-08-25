// Shared Finance vocabulary and period maths. Lives outside the "use server"
// action file so the screen, the report and the CSV export all resolve a period
// identically — the exported file can never disagree with what's on screen.

// Relative, with the extension, and NOT through the `@/` alias — the same
// deliberate choice lib/room-billing.ts makes. It is what lets this module be
// exercised under `node --test`, which resolves neither tsconfig paths nor
// extensionless specifiers. `business-day.ts` has no imports of its own.
import { businessPeriodBounds } from "./business-day.ts";
import type { ExpenseCategoryTotal } from "@/lib/expenses";

export type FinancePeriod =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "year"
  | "custom";

export const PERIOD_LABEL: Record<FinancePeriod, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "This Week",
  month: "This Month",
  year: "This Year",
  custom: "Custom Range",
};

/**
 * Resolve a period to [from, to) BUSINESS-day bounds.
 *
 * The day maths itself lives in `lib/business-day.ts` — there used to be four
 * separate copies of it in this codebase and they had already drifted apart
 * (Sales measured "this week" as a rolling 168 hours while this file measured
 * the last 7 days, so the two screens disagreed). One definition, one place.
 *
 * `hour` is the restaurant's business-day boundary, which every caller already
 * holds as `ru.closingHour`.
 */
export function periodBounds(
  period: FinancePeriod,
  hour: number,
  from?: string | null,
  to?: string | null
): { from: Date; to: Date } {
  return businessPeriodBounds(period, hour, from, to);
}

/** Every figure on the Daily Finance Report. All derived — nothing is stored. */
export type FinanceReport = {
  period: FinancePeriod;
  from: string;
  to: string;
  /** False until the admin seeds the books; balances are then relative to zero. */
  hasOpening: boolean;

  openingCash: number;
  openingOnline: number;
  /**
   * The two credit positions AS OF the period's start — money customers owed us
   * and money we owed vendors. Derived from the same ledgers as the closing
   * figures, so one period's closing credit IS the next period's opening credit.
   */
  openingCreditToUs: number;
  openingCreditByUs: number;

  salesCash: number;
  salesOnline: number;
  salesCard: number;
  /**
   * The part of the period's sales settled by a deposit taken EARLIER (a room advance).
   * Not new cash — that was banked on the day the deposit was taken and is reported under
   * advances. It is here so the Sales block adds up:
   *   cash + online + card + advance + credit = total
   * Without it a fully prepaid stay showed a total with no sale beneath it.
   */
  salesAdvance: number;
  /**
   * How that applied advance was originally tendered. Derived from the stay's NET
   * advance rows (refunds already netted off, because they are negative), so it is the
   * cash actually retained rather than the cash first taken. The two always sum to
   * `salesAdvance`, which is what keeps the Sales block adding up.
   */
  salesAdvanceCash: number;
  salesAdvanceOnline: number;
  /** Billed but not collected — the unpaid part of bills closed on credit. */
  salesCredit: number;

  /**
   * The same sales, cut by which side of the business earned them: rooms (a hotel
   * stay) vs tables and walk-ins. Room + table always equals the corresponding total.
   *
   * Advances are ROOM-ONLY by construction (`room_advances.stay_id` references
   * `room_stays`), so `salesAdvanceCash`/`salesAdvanceOnline` belong to the room block
   * and are not repeated here. The two blocks each add up on their own:
   *   room:  cash + online + card + advanceCash + advanceOnline + credit = roomTotal
   *   table: cash + online + card + credit = tableTotal
   */
  salesRoomCash: number;
  salesRoomOnline: number;
  salesRoomCard: number;
  salesRoomCredit: number;
  salesRoomTotal: number;
  salesTableCash: number;
  salesTableOnline: number;
  salesTableCard: number;
  salesTableCredit: number;
  salesTableTotal: number;
  /** Accrual: the full value of every bill raised, credit included. */
  salesTotal: number;

  /**
   * Money given away, and how many transactions carried it. TWO kinds are summed
   * here — a discount at the till, and a debt written off when a customer clears
   * their credit — so `discountsTotal - creditDiscountsTotal` is the till figure.
   *
   * ⚠️ `salesTotal + discountsTotal` is NOT what the bills would have come to, and
   * used to be: a till discount never entered `salesTotal` (the net amount IS the
   * sale everywhere in this app), but a credit write-off forgives a bill that was
   * already booked at FULL value on an earlier day. Adding both back would count
   * the credit half twice. Nothing should reconstruct a gross sales figure from
   * this — the Finance screen and the CSV deliberately stopped trying.
   *
   * A till discount is not a balance movement and has no ledger row. A credit
   * write-off IS one: it moves `customerCreditDiscounted` and the receivable, via
   * the credit leg of the repayment's `finance_transactions` row.
   */
  discountsTotal: number;
  discountedBills: number;
  /**
   * The credit-clearance half of `discountsTotal`. Broken out because the staff
   * Sales screen reports only till discounts (it reads `getSalesReport`, which
   * sums `payments.discount_amount` alone) — so the two screens will disagree by
   * exactly this figure, and that is expected, not drift.
   */
  creditDiscountsTotal: number;

  purchasesCash: number;
  purchasesOnline: number;
  /** Bought on credit — a debt, not money spent. */
  purchasesCredit: number;
  purchasesTotal: number;

  /**
   * Overheads: rent, electricity, water, internet — everything that is neither
   * bought stock nor wages. Always money that has ALREADY left, so there is no
   * credit leg: an expense row IS the payment (see the table's own migration).
   */
  extraExpensesCash: number;
  extraExpensesOnline: number;
  extraExpensesTotal: number;
  /**
   * The same total cut by category, biggest first. Categories with no spend in
   * the period are absent, so a quiet day stays short rather than printing ten
   * zeroes. Built as jsonb inside `finance_report` rather than fetched
   * separately — this app is latency-bound, so a round trip costs more than the
   * payload.
   */
  extraExpensesByCategory: ExpenseCategoryTotal[];

  /**
   * Money in that isn't a sale — misc/service/other income recorded by hand.
   * NEVER folds into `salesTotal`: it never touches `payments`, so nothing here
   * can double-count. Card is its own leg (unlike extra expenses, which never
   * offered it); the balance formulas fold it into "online" like every other
   * balance in this app, but it is reported separately so the split the form
   * captured isn't lost.
   */
  incomeCash: number;
  incomeOnline: number;
  incomeCard: number;
  incomeTotal: number;

  customerCreditCreated: number;
  customerCreditCollected: number;
  /** Debt forgiven / written off as discount when clearing customer credit. */
  customerCreditDiscounted: number;
  vendorCreditCreated: number;
  vendorCreditPaid: number;
  customerCreditOutstanding: number;
  vendorCreditOutstanding: number;
  /** How many customers are behind the outstanding total. */
  pendingCustomers: number;
  /** How many vendors are behind the outstanding total. */
  pendingVendors: number;

  /** Staff salary — real money out, on the day it was handed over. */
  salaryCash: number;
  salaryOnline: number;
  /** The part of `salaryTotal` paid ahead of the month ending. */
  salaryAdvance: number;
  salaryTotal: number;
  /** Salary accrued but not yet paid, across every month since each hire. */
  salaryOutstanding: number;

  closingCash: number;
  closingOnline: number;
  /**
   * The credit positions AS OF the period's end. For the current period these
   * equal the live outstanding totals above; for a past period they are what was
   * owed back THEN, which is what belongs on that period's balance sheet.
   */
  closingCreditToUs: number;
  closingCreditByUs: number;
  /** Cash + bank. Deliberately EXCLUDES credit — it is money, not a promise. */
  closingNet: number;

  /**
   * Room deposits taken in the period, and any handed back. Real cash movement, but
   * NOT sales — the sale books in full when the guest checks out (accrual, the same
   * rule credit follows, pointed the other way).
   */
  advancesReceived: number;
  advancesRefunded: number;
  /** The same two figures split by tender. Card rides with online — it is bank money. */
  advancesCash: number;
  advancesOnline: number;
  refundsCash: number;
  refundsOnline: number;
  /**
   * Guests' money sitting in the till: taken, but not yet applied to a bill. A
   * LIABILITY, derived like the two credit balances, so one period's closing figure
   * IS the next period's opening figure and it cannot drift.
   */
  openingAdvancesHeld: number;
  closingAdvancesHeld: number;
};

/**
 * One movement on the finance ledger.
 *
 * Each row carries what it did to all four balances and what they stood at
 * afterwards. "Balance before" is not stored — it is the previous row's `after`,
 * i.e. `after − delta` — so the two can never drift apart.
 */
export type FinanceTxKind =
  | "sale"
  | "room_advance"
  | "credit_repayment"
  | "purchase"
  | "extra_expense"
  | "extra_income"
  | "vendor_payment"
  | "salary"
  | "salary_advance"
  | "vendor_opening"
  | "customer_opening";

export const TX_LABEL: Record<FinanceTxKind, string> = {
  sale: "Sale",
  // Money in with no sale behind it yet — a room deposit. A negative amount on this
  // kind is the unused part handed back at checkout.
  room_advance: "Room Advance",
  credit_repayment: "Customer Credit Payment",
  purchase: "Purchase",
  // An overhead. `party` carries the category ("Electricity") where a purchase
  // carries the vendor's name.
  extra_expense: "Extra Expense",
  // Money in, NOT a sale. `party` carries the free-text description where an
  // extra expense carries its category — this table has no category at all.
  extra_income: "Extra Income",
  vendor_payment: "Vendor Credit Repayment",
  salary: "Salary Payment",
  salary_advance: "Salary Advance",
  // Not a movement of money — an account opened carrying a debt from paper
  // books. It still belongs on the ledger: it is why the credit balance jumped.
  vendor_opening: "Vendor Opening Balance",
  customer_opening: "Customer Opening Balance",
};

/**
 * What a ledger row is CALLED, for one row.
 *
 * `TX_LABEL` alone is not enough, because two kinds carry a signed amount and so
 * mean opposite things depending on which way the row points:
 *
 *   room_advance   > 0  a deposit taken     < 0  a REFUND handed back
 *   extra_expense  > 0  money spent         < 0  a saving WITHDRAWAL
 *
 * Both used to print their kind's name in either direction, so a ₹1,500 refund
 * read "Room Advance" — identical to the deposit that created it, and the only
 * clue it was a refund was the minus sign the colour fix had just added. Naming
 * it is the fix; the colour was only ever half the story.
 *
 * The SIGN of `amount` is the signal, not the deltas. For these two kinds the
 * sign IS the design (see `room_advances.amount` and the `extra_expenses` amount
 * CHECK) and it is guaranteed by database constraints, whereas the deltas answer
 * a different question — "which way did the money go" — that `txTone` already
 * asks for the colour.
 *
 * ONE function, used by the screen AND the CSV. Those two had already drifted to
 * "Room sale" and "Room Sale"; a shared label is what stops the next divergence
 * being a meaningful one.
 */
export function txLabel(
  t: Pick<FinanceTransaction, "kind" | "amount" | "source">,
  showRooms: boolean
): string {
  // A sale says which side of the business raised it — but only for a client
  // that HAS both sides. For a restaurant-only client every sale is a restaurant
  // sale, so the qualifier would be noise on every row; it stays plain "Sale",
  // matching the Sales block, which collapses to one heading the same way.
  if (t.kind === "sale" && t.source && showRooms) {
    return t.source === "room" ? "Room Sale" : "Restaurant Sale";
  }
  if (t.kind === "room_advance" && t.amount < 0) return "Room Advance Refund";
  // A negative extra expense can ONLY be a saving withdrawal: the CHECK
  // constraint permits a negative amount for the `saving` category and no other.
  if (t.kind === "extra_expense" && t.amount < 0) return "Saving Withdrawal";
  return TX_LABEL[t.kind] ?? t.kind;
}

/**
 * Money in reads green, money out red — the same language as the rest of the sheet.
 *
 * Direction is DERIVED from what the row actually did to cash and bank
 * (`cashDelta + onlineDelta`), never from its kind. A fixed colour per kind was
 * wrong for every row that can point both ways, and there are now three:
 *   • a room-advance REFUND is a negative `room_advance` — money out, once green
 *   • a saving WITHDRAWAL is a negative `extra_expense` — money in, once red
 *   • a CREDIT sale moves no money at all, yet read as money in
 * A kind cannot know which way its own row went; only the deltas can.
 */
export const MONEY_IN = "#1a7a4a";
export const MONEY_OUT = "#dc2626";
/** Amber: a real event that moved no money — a credit sale, a carried balance. */
export const MONEY_NONE = "#f97316";

/** What a ledger row did to cash + bank: > 0 in, < 0 out, 0 no movement. */
export function txFlow(t: Pick<FinanceTransaction, "cashDelta" | "onlineDelta">): number {
  return t.cashDelta + t.onlineDelta;
}

export function txTone(flow: number): string {
  if (flow > 0.005) return MONEY_IN;
  if (flow < -0.005) return MONEY_OUT;
  return MONEY_NONE;
}

export type FinanceTransaction = {
  at: string;
  kind: FinanceTxKind;
  /** Customer, vendor or staff name — null for an ordinary walk-in bill. */
  party: string | null;
  /**
   * Which side of the business raised a SALE, and where it came from. Null on
   * every other kind.
   *
   * `kind` stays `"sale"` for both: the ledger groups and reconciles by kind, so
   * splitting it would ripple through `FinanceTxKind`, `TX_LABEL` and every
   * reader to say something these two fields say on their own. The room test is
   * the same one `finance_report`'s `paysrc` uses — the ledger and the Sales
   * block must never classify the same bill differently.
   */
  source: "room" | "table" | "walkin" | null;
  /** "Room 203", "Table 5", "Walk-in 1". Null on every non-sale row. */
  sourceLabel: string | null;
  /** cash | online | card | credit | partial | mixed */
  method: string;
  /** The headline value of the transaction, always positive. */
  amount: number;
  /** Bill number, purchase code, credit ID or salary month. */
  reference: string | null;
  cashDelta: number;
  onlineDelta: number;
  creditToUsDelta: number;
  creditByUsDelta: number;
  cashAfter: number;
  onlineAfter: number;
  creditToUsAfter: number;
  creditByUsAfter: number;
};

/** How a supplier bill was settled — drives the badge on the purchases list. */
export type PurchaseStatus = "paid" | "partial" | "credit";

export const PURCHASE_STATUS_LABEL: Record<PurchaseStatus, string> = {
  paid: "Paid",
  partial: "Partially Paid",
  credit: "Credit",
};

export const PURCHASE_STATUS_COLOR: Record<PurchaseStatus, string> = {
  paid: "#1a7a4a",
  partial: "#f97316",
  credit: "#dc2626",
};

/**
 * A purchase is `paid` when nothing is owed, `credit` when nothing was handed
 * over, and `partial` in between — derived from the bill's own split, so it can
 * never disagree with the vendor's balance.
 */
export function purchaseStatus(total: number, credit: number): PurchaseStatus {
  if (credit <= 0.005) return "paid";
  if (credit >= total - 0.005) return "credit";
  return "partial";
}

/** One line of the Purchases list on the Finance page. */
export type FinancePurchase = {
  id: string;
  purchase_code: string;
  vendor_id: string;
  vendor_name: string;
  vendor_code: string;
  created_at: string;
  productCount: number;
  total: number;
  /** cash | online | credit */
  method: string;
  status: PurchaseStatus;
  /** Still owed on this bill. */
  creditAmount: number;
};
