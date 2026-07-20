"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { STOCK_ACCESS } from "@/lib/permissions";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";
import {
  periodBounds,
  PERIOD_LABEL,
  purchaseStatus,
  PURCHASE_STATUS_LABEL,
  TX_LABEL,
} from "@/lib/finance";
import type {
  FinancePeriod,
  FinancePurchase,
  FinanceReport,
  FinanceTransaction,
  FinanceTxKind,
} from "@/lib/finance";

export type ActionResult = { error: string } | null;

const EMPTY = (period: FinancePeriod, from: string, to: string): FinanceReport => ({
  period,
  from,
  to,
  hasOpening: false,
  openingCash: 0,
  openingOnline: 0,
  openingCreditToUs: 0,
  openingCreditByUs: 0,
  salesCash: 0,
  salesOnline: 0,
  salesCard: 0,
  salesCredit: 0,
  salesTotal: 0,
  purchasesCash: 0,
  purchasesOnline: 0,
  purchasesCredit: 0,
  purchasesTotal: 0,
  customerCreditCreated: 0,
  customerCreditCollected: 0,
  vendorCreditCreated: 0,
  vendorCreditPaid: 0,
  customerCreditOutstanding: 0,
  vendorCreditOutstanding: 0,
  pendingCustomers: 0,
  pendingVendors: 0,
  salaryCash: 0,
  salaryOnline: 0,
  salaryAdvance: 0,
  salaryTotal: 0,
  salaryOutstanding: 0,
  closingCash: 0,
  closingOnline: 0,
  closingCreditToUs: 0,
  closingCreditByUs: 0,
  closingNet: 0,
});

// ─── The report ───────────────────────────────────────────────────────────────
// Everything comes from `finance_report`, which reads the existing bills,
// purchases and credit ledgers. Nothing is stored or duplicated; the only new
// state anywhere is the opening-balance seed.

export async function getFinanceReport(params?: {
  period?: FinancePeriod;
  from?: string | null;
  to?: string | null;
}): Promise<FinanceReport> {
  const ru = await getRestaurantUser();
  const period = params?.period ?? "today";
  const { from, to } = periodBounds(period, ru.closingHour, params?.from, params?.to);
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  // Stricter than the rest of the module: the report exposes takings, margins and
  // every outstanding debt.
  if (!STOCK_ACCESS.canViewFinance(ru)) return EMPTY(period, fromIso, toIso);

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (service as any).rpc("finance_report", {
    p_restaurant_id: ru.restaurant_id,
    p_from: fromIso,
    p_to: toIso,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = (Array.isArray(data) ? data[0] : data) as any;
  if (error || !row) return EMPTY(period, fromIso, toIso);

  const num = (v: unknown) => Number(v ?? 0);
  const closingCash = num(row.closing_cash);
  const closingOnline = num(row.closing_online);

  return {
    period,
    from: fromIso,
    to: toIso,
    hasOpening: !!row.has_opening,

    openingCash: num(row.opening_cash),
    openingOnline: num(row.opening_online),
    openingCreditToUs: num(row.opening_credit_to_us),
    openingCreditByUs: num(row.opening_credit_by_us),

    salesCash: num(row.sales_cash),
    salesOnline: num(row.sales_online),
    salesCard: num(row.sales_card),
    salesCredit: num(row.sales_credit),
    salesTotal: num(row.sales_total),

    purchasesCash: num(row.purchases_cash),
    purchasesOnline: num(row.purchases_online),
    purchasesCredit: num(row.purchases_credit),
    purchasesTotal: num(row.purchases_total),

    customerCreditCreated: num(row.customer_credit_created),
    customerCreditCollected: num(row.customer_credit_collected),
    vendorCreditCreated: num(row.vendor_credit_created),
    vendorCreditPaid: num(row.vendor_credit_paid),
    customerCreditOutstanding: num(row.customer_credit_outstanding),
    vendorCreditOutstanding: num(row.vendor_credit_outstanding),
    pendingCustomers: Number(row.pending_customers ?? 0),
    pendingVendors: Number(row.pending_vendors ?? 0),

    salaryCash: num(row.salary_cash),
    salaryOnline: num(row.salary_online),
    salaryAdvance: num(row.salary_advance),
    salaryTotal: num(row.salary_total),
    salaryOutstanding: num(row.salary_outstanding),

    closingCash,
    closingOnline,
    closingCreditToUs: num(row.closing_credit_to_us),
    closingCreditByUs: num(row.closing_credit_by_us),
    closingNet: closingCash + closingOnline,
  };
}

// ─── The transaction ledger ───────────────────────────────────────────────────
// Every movement in the period with a running balance on all four buckets. The
// last row's running balances land exactly on the report's closing figures —
// that is what makes the ledger an explanation of the balance rather than a
// second, independently-drifting version of it.

export async function getFinanceTransactions(params?: {
  period?: FinancePeriod;
  from?: string | null;
  to?: string | null;
}): Promise<FinanceTransaction[]> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canViewFinance(ru)) return [];

  const period = params?.period ?? "today";
  const { from, to } = periodBounds(period, ru.closingHour, params?.from, params?.to);

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (service as any).rpc("finance_transactions", {
    p_restaurant_id: ru.restaurant_id,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  if (error || !Array.isArray(data)) return [];

  const num = (v: unknown) => Number(v ?? 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map((r) => ({
    at: r.occurred_at,
    kind: r.kind as FinanceTxKind,
    party: r.party ?? null,
    method: r.method ?? "",
    amount: num(r.amount),
    reference: r.reference ?? null,
    cashDelta: num(r.cash_delta),
    onlineDelta: num(r.online_delta),
    creditToUsDelta: num(r.credit_to_us_delta),
    creditByUsDelta: num(r.credit_by_us_delta),
    cashAfter: num(r.cash_after),
    onlineAfter: num(r.online_after),
    creditToUsAfter: num(r.credit_to_us_after),
    creditByUsAfter: num(r.credit_by_us_after),
  }));
}

// ─── Purchases in the period ──────────────────────────────────────────────────
// The totals alone don't tell an admin WHO they bought from. This lists each
// supplier bill behind the "Purchases" figure, so the vendor, the time, the
// basket size and how it was settled are all readable without leaving the page.

export async function getPeriodPurchases(params?: {
  period?: FinancePeriod;
  from?: string | null;
  to?: string | null;
}): Promise<FinancePurchase[]> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canViewFinance(ru)) return [];

  const period = params?.period ?? "today";
  const { from, to } = periodBounds(period, ru.closingHour, params?.from, params?.to);

  const service = createServiceClient();
  // `purchase_items ( id )` is only counted, not read — one round trip instead of
  // a query per purchase.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("purchases")
    .select(
      "id, purchase_code, vendor_id, payment_method, total_amount, credit_amount, created_at, vendors ( name, vendor_code ), purchase_items ( id )"
    )
    .eq("restaurant_id", ru.restaurant_id)
    .gte("created_at", from.toISOString())
    .lt("created_at", to.toISOString())
    .order("created_at", { ascending: false })
    .limit(100);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((p) => {
    const total = Number(p.total_amount);
    const credit = Number(p.credit_amount);
    return {
      id: p.id,
      purchase_code: p.purchase_code,
      vendor_id: p.vendor_id,
      vendor_name: p.vendors?.name ?? "—",
      vendor_code: p.vendors?.vendor_code ?? "",
      created_at: p.created_at,
      productCount: Array.isArray(p.purchase_items) ? p.purchase_items.length : 0,
      total,
      method: p.payment_method,
      status: purchaseStatus(total, credit),
      creditAmount: credit,
    };
  });
}

// ─── Opening balance seed ─────────────────────────────────────────────────────
// The one number the database cannot derive: the money on hand before the system
// existed. Set once; every later day's opening is carried forward from it.

export type OpeningBalance = {
  cash: number;
  online: number;
  effective_from: string;
} | null;

export async function getOpeningBalance(): Promise<OpeningBalance> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canViewFinance(ru)) return null;

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("finance_openings")
    .select("opening_cash, opening_online, effective_from")
    .eq("restaurant_id", ru.restaurant_id)
    .maybeSingle();

  if (!data) return null;
  return {
    cash: Number(data.opening_cash),
    online: Number(data.opening_online),
    effective_from: data.effective_from,
  };
}

export async function setOpeningBalance(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  // Seeding the books rewrites every balance from that date on — writer-level.
  if (!STOCK_ACCESS.canManageStock(ru) || !STOCK_ACCESS.canViewFinance(ru)) {
    return { error: "You don't have permission to set the opening balance." };
  }

  const cashRaw = (formData.get("cash") as string) || "";
  const onlineRaw = (formData.get("online") as string) || "";
  const dateRaw = ((formData.get("effective_from") as string) || "").trim();

  const cash = cashRaw === "" ? 0 : parseFloat(cashRaw);
  const online = onlineRaw === "" ? 0 : parseFloat(onlineRaw);

  if (isNaN(cash) || cash < 0) return { error: "Cash on hand must be zero or more." };
  if (isNaN(online) || online < 0) return { error: "Bank balance must be zero or more." };
  if (!dateRaw) return { error: "Choose the date your books start from." };

  const effectiveFrom = new Date(`${dateRaw}T00:00:00`);
  if (isNaN(effectiveFrom.getTime())) return { error: "Invalid start date." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("set_finance_opening", {
    p_restaurant_id: ru.restaurant_id,
    p_cash: cash,
    p_online: online,
    p_effective_from: effectiveFrom.toISOString(),
    p_created_by: ru.id,
  });

  if (error) {
    return { error: "Could not save the opening balance. Please try again." };
  }

  revalidatePath("/admin/finance");
  return null;
}

// ─── CSV export ───────────────────────────────────────────────────────────────
// Re-runs the SAME report for the SAME period, so the file always matches the
// screen exactly.

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

// Covers both purchase methods and the ledger's derived ones ("partial" = part
// tendered part credit, "mixed" = cash and bank on one bill).
const PURCHASE_METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  online: "Online",
  card: "Card",
  credit: "Credit",
  partial: "Part Paid / Part Credit",
  mixed: "Cash + Online",
};

export async function exportFinanceCsv(params?: {
  period?: FinancePeriod;
  from?: string | null;
  to?: string | null;
}): Promise<{ filename: string; csv: string } | { error: string }> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canViewFinance(ru)) {
    return { error: "You don't have permission to export the finance report." };
  }

  // The screen lists the individual purchases and the full ledger, so the file
  // does too — an export that says less than the page it came from is a trap.
  const [report, purchases, ledger] = await Promise.all([
    getFinanceReport(params),
    getPeriodPurchases(params),
    getFinanceTransactions(params),
  ]);
  const period = report.period;

  const fmt = (n: number) => n.toFixed(2);
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString("en-IN", { dateStyle: "medium" });

  const rows: (string | number)[][] = [
    ["Daily Finance Report"],
    ["Period", PERIOD_LABEL[period]],
    // `to` is exclusive, so step back a day to show the last day actually covered.
    ["From", day(report.from)],
    ["To", day(new Date(new Date(report.to).getTime() - 1).toISOString())],
    [],
    ["OPENING BALANCE"],
    ["Cash", fmt(report.openingCash)],
    ["Online / Bank", fmt(report.openingOnline)],
    ["Credit to Us (receivable)", fmt(report.openingCreditToUs)],
    ["Credit by Us (payable)", fmt(report.openingCreditByUs)],
    [],
    ["SALES"],
    ["Cash Sales", fmt(report.salesCash)],
    ["Online Sales", fmt(report.salesOnline)],
    ["Card Sales", fmt(report.salesCard)],
    ["Credit Sales (billed, not collected)", fmt(report.salesCredit)],
    ["Total Sales", fmt(report.salesTotal)],
    [],
    ["PURCHASES"],
    ["Cash Purchases", fmt(report.purchasesCash)],
    ["Online Purchases", fmt(report.purchasesOnline)],
    ["Credit Purchases (owed, not paid)", fmt(report.purchasesCredit)],
    ["Total Purchase Cost", fmt(report.purchasesTotal)],
    [],
    // Each supplier bill behind that total — who, when, how much, how settled.
    ...(purchases.length > 0
      ? [
          ["PURCHASES — DETAIL"],
          ["Date & Time", "Purchase ID", "Vendor", "Vendor ID", "Products", "Amount", "Payment Method", "Payment Status", "On Credit"],
          ...purchases.map((p) => [
            new Date(p.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
            p.purchase_code,
            p.vendor_name,
            p.vendor_code,
            p.productCount,
            fmt(p.total),
            PURCHASE_METHOD_LABEL[p.method] ?? p.method,
            PURCHASE_STATUS_LABEL[p.status],
            fmt(p.creditAmount),
          ]),
          [],
        ]
      : []),
    // Every rupee that left the business in the period, in one block — the
    // question "where did the cash go today" answered without adding up four
    // sections by hand.
    ["EXPENSES"],
    ["Product Purchases (paid)", fmt(report.purchasesCash + report.purchasesOnline)],
    ["Vendor Payments (against credit)", fmt(report.vendorCreditPaid)],
    ["Staff Salary Payments", fmt(report.salaryTotal - report.salaryAdvance)],
    ["Salary Advances", fmt(report.salaryAdvance)],
    ["Total Money Out", fmt(
      report.purchasesCash + report.purchasesOnline + report.vendorCreditPaid + report.salaryTotal
    )],
    [],
    ["STAFF SALARY"],
    ["Salary Paid (cash)", fmt(report.salaryCash)],
    ["Salary Paid (online)", fmt(report.salaryOnline)],
    ["Salary Advances", fmt(report.salaryAdvance)],
    ["Total Salary Paid", fmt(report.salaryTotal)],
    ["Outstanding Salary Liability", fmt(report.salaryOutstanding)],
    [],
    ["CUSTOMER CREDITS (owed to us)"],
    ["Total Outstanding", fmt(report.customerCreditOutstanding)],
    ["Collected", fmt(report.customerCreditCollected)],
    ["New Credits", fmt(report.customerCreditCreated)],
    ["Pending Customers", report.pendingCustomers],
    [],
    ["VENDOR CREDITS (owed by us)"],
    ["Total Outstanding", fmt(report.vendorCreditOutstanding)],
    ["Paid", fmt(report.vendorCreditPaid)],
    ["New Credit Purchases", fmt(report.vendorCreditCreated)],
    ["Pending Vendors", report.pendingVendors],
    [],
    ["NET POSITION"],
    ["Amount Owed to Us", fmt(report.customerCreditOutstanding)],
    ["Amount We Owe", fmt(report.vendorCreditOutstanding)],
    ["Net", fmt(report.customerCreditOutstanding - report.vendorCreditOutstanding)],
    [],
    ["CLOSING BALANCE"],
    ["Cash Balance", fmt(report.closingCash)],
    ["Online / Bank Balance", fmt(report.closingOnline)],
    ["Credit to Us (receivable)", fmt(report.closingCreditToUs)],
    ["Credit by Us (payable)", fmt(report.closingCreditByUs)],
    ["Net Balance (cash + bank)", fmt(report.closingNet)],
    [],
    // The movement-by-movement explanation of every figure above. Balance
    // "before" is the row's after minus its own delta, so the two columns can
    // never contradict each other.
    ...(ledger.length > 0
      ? [
          ["TRANSACTION HISTORY"],
          [
            "Date & Time", "Transaction Type", "Person", "Payment Method", "Amount", "Reference",
            "Cash Before", "Cash After",
            "Online Before", "Online After",
            "Credit to Us Before", "Credit to Us After",
            "Credit by Us Before", "Credit by Us After",
          ],
          // Oldest first: a ledger reads forwards, even though the screen shows
          // the newest movement at the top.
          ...[...ledger].reverse().map((t) => [
            new Date(t.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
            TX_LABEL[t.kind] ?? t.kind,
            t.party ?? "",
            PURCHASE_METHOD_LABEL[t.method] ?? t.method,
            fmt(t.amount),
            t.reference ?? "",
            fmt(t.cashAfter - t.cashDelta), fmt(t.cashAfter),
            fmt(t.onlineAfter - t.onlineDelta), fmt(t.onlineAfter),
            fmt(t.creditToUsAfter - t.creditToUsDelta), fmt(t.creditToUsAfter),
            fmt(t.creditByUsAfter - t.creditByUsDelta), fmt(t.creditByUsAfter),
          ]),
        ]
      : []),
  ];

  // Leading BOM so Excel reads UTF-8; CRLF line endings for Windows.
  const csv = "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const stamp = new Date().toISOString().slice(0, 10);
  return { filename: `finance_${period}_${stamp}.csv`, csv };
}
