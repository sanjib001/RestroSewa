import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { businessDayBounds } from "@/lib/business-day";
import { stockStatus } from "@/lib/stock";
import { hasRooms, normalizeBusinessType } from "@/lib/business-type";
import { expenseCategoryLabel } from "@/lib/expenses";
import type { ExpenseCategoryTotal } from "@/lib/expenses";

// ─── Config (stored on restaurants.settings.daily_summary) ─────────────────────
// A restaurant opts in and lists up to three recipients. This module owns the
// shape so both the Settings action and the cron route normalise it identically.
// Kept in a PLAIN module (not the "use server" settings.ts) so the sync helpers
// below can be exported and imported without tripping the "server actions must be
// async" rule.

export const MAX_SUMMARY_EMAILS = 3;
// Deliberately loose — enough to catch a typo, not to arbitrate RFC 5322.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type DailySummaryConfig = { enabled: boolean; emails: string[] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeDailySummaryConfig(raw: any): DailySummaryConfig {
  const obj = raw && typeof raw === "object" ? raw : {};
  const emails: string[] = Array.isArray(obj.emails)
    ? obj.emails
        .filter((e: unknown): e is string => typeof e === "string")
        .map((e: string) => e.trim())
        .filter((e: string) => EMAIL_RE.test(e))
        .slice(0, MAX_SUMMARY_EMAILS)
    : [];
  return { enabled: !!obj.enabled, emails };
}

// ─── The report model ──────────────────────────────────────────────────────────

export type DailySummaryModel = {
  businessDate: string; // YYYY-MM-DD (Nepal business day)
  hasOpening: boolean;

  openingCash: number;
  openingOnline: number;
  openingCreditToUs: number;
  openingCreditByUs: number;

  salesCash: number;
  salesOnline: number;
  salesCard: number;
  /** Settled by a deposit taken earlier. Makes the sales rows add up to the total. */
  salesAdvance: number;
  /** …split by how that deposit was tendered. The two sum to `salesAdvance`. */
  salesAdvanceCash: number;
  salesAdvanceOnline: number;
  salesCredit: number;
  salesTotal: number;
  /**
   * Whether this client has the hotel side at all. Decides if the PDF splits Sales into
   * Restaurant and Room blocks — the SAME `hasRooms` rule the Finance screen uses, not
   * "did any room earn anything today", which would drop the block on a quiet day and
   * make the emailed report disagree with the screen.
   */
  showRooms: boolean;
  /** Sales cut by which side of the business earned them. Room + table = total. */
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
  discounts: number;

  purchasesCash: number;
  purchasesOnline: number;
  purchasesCredit: number;
  purchasesTotal: number;

  // Overheads: rent, electricity, water. No credit leg — an expense row IS the
  // payment, so everything here has already left the till.
  extraExpensesCash: number;
  extraExpensesOnline: number;
  extraExpensesTotal: number;
  extraExpensesByCategory: ExpenseCategoryTotal[];

  // Money in that isn't a sale — never folded into salesTotal. No category
  // taxonomy (unlike extra expenses): each entry prints as its own line, keyed
  // by its free-text description.
  incomeCash: number;
  incomeOnline: number;
  incomeCard: number;
  incomeTotal: number;
  incomeEntries: { description: string; amount: number }[];

  vendorPayments: number;          // paid against vendor credit
  customerCreditCollected: number; // repayments received
  customerCreditDiscounted: number; // debt written off as discount
  customerCreditCreated: number;
  vendorCreditCreated: number;
  customerCreditOutstanding: number;
  vendorCreditOutstanding: number;

  salaryPaid: number;    // salary_total (cash + online)
  salaryAdvance: number;

  closingCash: number;
  closingOnline: number;
  closingCreditToUs: number;
  closingCreditByUs: number;
  closingNet: number;    // cash + online

  // Room deposits. Cash movement with no sale behind it — the sale books at checkout.
  advancesReceived: number;
  advancesRefunded: number;
  /** Both split by tender, so a mixed deposit doesn't collapse into one figure. */
  advancesCash: number;
  advancesOnline: number;
  refundsCash: number;
  refundsOnline: number;
  // Guests' money included in the cash balance but not yet earned. A liability, and NOT
  // derivable from the two figures above: a deposit also leaves the held total when it is
  // applied to a bill, which neither of them records.
  advancesHeldOpening: number;
  advancesHeld: number;

  estimatedProfit: number; // sales − purchase cost − salaries paid − extra expenses

  totalBills: number;   // payments finalised in the day
  totalOrders: number;  // kitchen order batches placed in the day
  inventoryValue: number; // closing stock valued at each product's last cost
  lowStock: number;
  outOfStock: number;
};

const num = (v: unknown) => Number(v ?? 0);

/**
 * Build one restaurant's summary for a single business day, from the same sources
 * the on-screen Finance report uses (`finance_report` RPC) plus a couple of
 * lightweight counts. No user context — the cron caller has no session, so the
 * restaurant is passed explicitly and the service client is used throughout.
 */
export async function buildDailySummary(
  restaurantId: string,
  businessDate: string,
  closingHour: number
): Promise<DailySummaryModel> {
  const { from, to } = businessDayBounds(businessDate, closingHour);
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const service = createServiceClient();

  const [financeRes, paymentsRes, ordersRes, stockRes, productsRes, restRes, incomeRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).rpc("finance_report", {
      p_restaurant_id: restaurantId,
      p_from: fromIso,
      p_to: toIso,
    }),
    // Bills (count) + discounts (sum) for the day — the two figures finance_report
    // doesn't carry. Same source as the Sales screen: the `payments` rows.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("payments")
      .select("discount_amount")
      .eq("restaurant_id", restaurantId)
      .gte("created_at", fromIso)
      .lt("created_at", toIso),
    // Kitchen order batches placed in the day.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("session_orders")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .gte("created_at", fromIso)
      .lt("created_at", toIso),
    // Closing stock per product for the day, to flag low/out.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).rpc("stock_report", {
      p_restaurant_id: restaurantId,
      p_from: fromIso,
      p_to: toIso,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("products")
      .select("id, low_stock_threshold, last_unit_cost, is_active")
      .eq("restaurant_id", restaurantId),
    // Business type, so the PDF splits Restaurant vs Room sales on the SAME rule the
    // Finance screen uses. Gating on room activity instead would drop the Room block
    // from a hotel's report on a quiet day, and the emailed PDF would then disagree
    // with the screen — which is a support call.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).from("restaurants").select("type").eq("id", restaurantId).maybeSingle(),
    // Per-entry list for the PDF. finance_report carries only the totals — this
    // table has no category to group by (unlike extra_expenses' by-category
    // jsonb), so each entry is its own PDF line, keyed by its own description.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("extra_income")
      .select("description, amount")
      .eq("restaurant_id", restaurantId)
      .gte("created_at", fromIso)
      .lt("created_at", toIso)
      .order("created_at"),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const f = (Array.isArray(financeRes.data) ? financeRes.data[0] : financeRes.data) as any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payments = (paymentsRes.data ?? []) as any[];
  const totalBills = payments.length;
  // Read from `finance_report` rather than summed here, so the PDF, the screen
  // and the CSV all state one number from one place. The rows query stays — it
  // is still what counts the day's bills, which the report does not carry.
  const discounts = num(f?.discounts_total);

  const totalOrders = ordersRes.count ?? 0;

  // Low/out AND inventory value over ACTIVE products only, matching the Stock
  // screen's summary. Value what's on the shelf at what it last cost to buy;
  // negative (oversold) stock is valued at 0, never as a negative asset.
  const closingByProduct = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of ((stockRes.data ?? []) as any[])) {
    closingByProduct.set(r.product_id, num(r.closing));
  }
  let lowStock = 0;
  let outOfStock = 0;
  let inventoryValue = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const p of ((productsRes.data ?? []) as any[])) {
    if (!p.is_active) continue;
    const closing = closingByProduct.get(p.id) ?? 0;
    inventoryValue += Math.max(0, closing) * num(p.last_unit_cost);
    const st = stockStatus(closing, num(p.low_stock_threshold));
    if (st === "low") lowStock += 1;
    else if (st === "out") outOfStock += 1;
  }

  const salesTotal = num(f?.sales_total);
  const purchasesTotal = num(f?.purchases_total);
  const salaryPaid = num(f?.salary_total);
  const extraExpensesTotal = num(f?.extra_expenses_total);
  const incomeTotal = num(f?.income_total);
  const closingCash = num(f?.closing_cash);
  const closingOnline = num(f?.closing_online);

  return {
    businessDate,
    hasOpening: !!f?.has_opening,

    openingCash: num(f?.opening_cash),
    openingOnline: num(f?.opening_online),
    openingCreditToUs: num(f?.opening_credit_to_us),
    openingCreditByUs: num(f?.opening_credit_by_us),

    salesCash: num(f?.sales_cash),
    salesOnline: num(f?.sales_online),
    salesCard: num(f?.sales_card),
    salesAdvance: num(f?.sales_advance),
    salesAdvanceCash: num(f?.sales_advance_cash),
    salesAdvanceOnline: num(f?.sales_advance_online),
    salesCredit: num(f?.sales_credit),
    salesTotal,
    showRooms: hasRooms(normalizeBusinessType(restRes.data?.type)),
    salesRoomCash: num(f?.sales_room_cash),
    salesRoomOnline: num(f?.sales_room_online),
    salesRoomCard: num(f?.sales_room_card),
    salesRoomCredit: num(f?.sales_room_credit),
    salesRoomTotal: num(f?.sales_room_total),
    salesTableCash: num(f?.sales_table_cash),
    salesTableOnline: num(f?.sales_table_online),
    salesTableCard: num(f?.sales_table_card),
    salesTableCredit: num(f?.sales_table_credit),
    salesTableTotal: num(f?.sales_table_total),
    discounts,

    purchasesCash: num(f?.purchases_cash),
    purchasesOnline: num(f?.purchases_online),
    purchasesCredit: num(f?.purchases_credit),
    purchasesTotal,

    extraExpensesCash: num(f?.extra_expenses_cash),
    extraExpensesOnline: num(f?.extra_expenses_online),
    extraExpensesTotal,
    // The label resolves through lib/expenses.ts, the same map the screen uses, so
    // the PDF can never name a category differently from the report it mirrors.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    extraExpensesByCategory: ((f?.extra_expenses_by_category ?? []) as any[]).map((c) => ({
      category: String(c.category),
      label: expenseCategoryLabel(String(c.category)),
      cash: num(c.cash),
      online: num(c.online),
      total: num(c.total),
    })),

    incomeCash: num(f?.income_cash),
    incomeOnline: num(f?.income_online),
    incomeCard: num(f?.income_card),
    incomeTotal,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    incomeEntries: ((incomeRes.data ?? []) as any[]).map((r) => ({
      description: String(r.description),
      amount: num(r.amount),
    })),

    vendorPayments: num(f?.vendor_credit_paid),
    customerCreditCollected: num(f?.customer_credit_collected),
    customerCreditDiscounted: num(f?.customer_credit_discounted),
    customerCreditCreated: num(f?.customer_credit_created),
    vendorCreditCreated: num(f?.vendor_credit_created),
    customerCreditOutstanding: num(f?.customer_credit_outstanding),
    vendorCreditOutstanding: num(f?.vendor_credit_outstanding),

    salaryPaid,
    salaryAdvance: num(f?.salary_advance),

    closingCash,
    closingOnline,
    closingCreditToUs: num(f?.closing_credit_to_us),
    closingCreditByUs: num(f?.closing_credit_by_us),
    closingNet: closingCash + closingOnline,

    advancesReceived: num(f?.advances_received),
    advancesRefunded: num(f?.advances_refunded),
    advancesCash: num(f?.advances_cash),
    advancesOnline: num(f?.advances_online),
    refundsCash: num(f?.refunds_cash),
    refundsOnline: num(f?.refunds_online),
    advancesHeldOpening: num(f?.opening_advances_held),
    advancesHeld: num(f?.closing_advances_held),

    // Estimated, not booked: bought-stock cost is used, not stock consumed, so a
    // heavy-stocking day reads low and a run-down day reads high. Labelled as an
    // estimate in the email for exactly that reason. `+ incomeTotal`: real money
    // that isn't a sale still belongs in the bottom line, exactly as an extra
    // expense already counts against it — omitting it would understate a day
    // that included a genuine receipt.
    estimatedProfit: salesTotal + incomeTotal - purchasesTotal - salaryPaid - extraExpensesTotal,

    totalBills,
    totalOrders,
    inventoryValue,
    lowStock,
    outOfStock,
  };
}

// ─── Email rendering ───────────────────────────────────────────────────────────

const money = (n: number) =>
  `NPR ${(Math.round(n * 100) / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function prettyDate(businessDate: string): string {
  // businessDate is already the Nepal business day; format it as a plain date
  // (no timezone maths — it's a wall-clock day string).
  const [y, m, d] = businessDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  return dt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * A SHORT, professional covering email. The full report is the attached PDF, so
 * the body just orients the reader and highlights two headline numbers. Subject
 * follows the requested format exactly. Self-contained inline styles (no external
 * CSS/images — clients strip both); plain-text fallback included.
 */
export function renderDailySummaryEmail(
  m: DailySummaryModel,
  restaurantName: string
): { subject: string; html: string; text: string } {
  const date = prettyDate(m.businessDate);
  // En-dash separators, per the requested subject format.
  const subject = `Daily Financial Summary – ${restaurantName} – ${date}`;
  const profitColor = m.estimatedProfit >= 0 ? "#15803d" : "#b91c1c";

  const highlight = (label: string, value: string, color = "#0f172a") => `
    <td style="padding:12px 14px;background:#f8fafc;border-radius:10px;">
      <div style="font-size:12px;color:#64748b;">${label}</div>
      <div style="font-size:18px;font-weight:700;color:${color};margin-top:2px;white-space:nowrap;">${value}</div>
    </td>`;

  const html = `<div style="margin:0;padding:24px 12px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">
    <tr>
      <td style="padding:22px 24px;background:#0d253d;">
        <div style="font-size:17px;font-weight:600;color:#ffffff;">${restaurantName}</div>
        <div style="font-size:13px;color:#93c5fd;margin-top:2px;">Daily Financial Summary · ${date}</div>
      </td>
    </tr>
    <tr>
      <td style="padding:22px 24px 6px;">
        <p style="margin:0 0 12px;font-size:14px;color:#334155;line-height:1.55;">Hello,</p>
        <p style="margin:0 0 16px;font-size:14px;color:#334155;line-height:1.55;">
          Your financial report for <strong>${date}</strong> is ready. The attached PDF has the full day's
          figures — opening &amp; closing balances, sales, purchases, credit, estimated profit and stock —
          formatted for printing or your accountant.
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            ${highlight("Total sales", money(m.salesTotal))}
            <td style="width:12px;"></td>
            ${highlight("Estimated profit", money(m.estimatedProfit), profitColor)}
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:14px 24px 22px;">
        <p style="margin:0;font-size:11px;color:#94a3b8;">Sent automatically by HRestroSewa after your business day closed. Estimated profit is based on stock purchased, not stock consumed.</p>
      </td>
    </tr>
  </table>
</div>`;

  const text = [
    `${restaurantName} — Daily Financial Summary`,
    date,
    "",
    `Your financial report for ${date} is ready. The full breakdown is in the attached PDF.`,
    "",
    `Total sales:      ${money(m.salesTotal)}`,
    `Estimated profit: ${money(m.estimatedProfit)}`,
    "",
    "Sent automatically by HRestroSewa after your business day closed.",
  ].join("\n");

  return { subject, html, text };
}
