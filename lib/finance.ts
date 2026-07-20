// Shared Finance vocabulary and period maths. Lives outside the "use server"
// action file so the screen, the report and the CSV export all resolve a period
// identically — the exported file can never disagree with what's on screen.

import { businessPeriodBounds } from "@/lib/business-day";

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
  /** Billed but not collected — the unpaid part of bills closed on credit. */
  salesCredit: number;
  /** Accrual: the full value of every bill raised, credit included. */
  salesTotal: number;

  purchasesCash: number;
  purchasesOnline: number;
  /** Bought on credit — a debt, not money spent. */
  purchasesCredit: number;
  purchasesTotal: number;

  customerCreditCreated: number;
  customerCreditCollected: number;
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
  | "credit_repayment"
  | "purchase"
  | "vendor_payment"
  | "salary"
  | "salary_advance"
  | "vendor_opening"
  | "customer_opening";

export const TX_LABEL: Record<FinanceTxKind, string> = {
  sale: "Sale",
  credit_repayment: "Customer Credit Payment",
  purchase: "Purchase",
  vendor_payment: "Vendor Credit Repayment",
  salary: "Salary Payment",
  salary_advance: "Salary Advance",
  // Not a movement of money — an account opened carrying a debt from paper
  // books. It still belongs on the ledger: it is why the credit balance jumped.
  vendor_opening: "Vendor Opening Balance",
  customer_opening: "Customer Opening Balance",
};

/** Money in reads green, money out red — the same language as the rest of the sheet. */
export const TX_TONE: Record<FinanceTxKind, string> = {
  sale: "#1a7a4a",
  credit_repayment: "#1a7a4a",
  purchase: "#dc2626",
  vendor_payment: "#dc2626",
  salary: "#dc2626",
  salary_advance: "#f97316",
  // Amber: a balance appearing, not money changing hands.
  vendor_opening: "#f97316",
  customer_opening: "#f97316",
};

export type FinanceTransaction = {
  at: string;
  kind: FinanceTxKind;
  /** Customer, vendor or staff name — null for an ordinary walk-in bill. */
  party: string | null;
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
