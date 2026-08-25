import "server-only";
import { ReportPdf, type ReportLogo } from "./pdf/report-document";
import type { DailySummaryModel } from "./daily-summary";

// The daily report's PDF layout. All financial figures the owner asked for, grouped
// into sections, rendered through the reusable ReportPdf chrome (branded header +
// page-numbered HRestroSewa footer). A weekly/monthly report is the same shape with
// its own model + groups — the chrome and page-numbering are shared.

const money = (n: number) =>
  `NPR ${(Math.round(n * 100) / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function prettyDate(businessDate: string): string {
  const [y, m, d] = businessDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  return dt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export async function renderDailySummaryPdf(
  m: DailySummaryModel,
  opts: { restaurantName: string; logo?: ReportLogo | null }
): Promise<Uint8Array> {
  const pdf = await ReportPdf.create({
    title: "Daily Financial Summary",
    restaurantName: opts.restaurantName,
    subtitle: `Business date: ${prettyDate(m.businessDate)}`,
    logo: opts.logo ?? null,
  });

  pdf.sectionTitle("Opening Balance");
  pdf.row("Cash", money(m.openingCash));
  pdf.row("Online / Bank", money(m.openingOnline));
  pdf.row("Credit to us (receivable)", money(m.openingCreditToUs));
  pdf.row("Credit by us (payable)", money(m.openingCreditByUs));
  if (m.advancesHeldOpening > 0) {
    pdf.row("Advance held (guests' money)", money(m.advancesHeldOpening));
  }

  // A mixed (cash + online) bill is NOT its own line: its cash part is already in
  // "Cash sales" and its online part in "Online sales" (finance_report sums the
  // cash_amount / online_amount columns across every payment, mixed included). A
  // separate "Mixed" row would double-count it and break the section's total.
  // Two businesses under one roof get two blocks, on the SAME `hasRooms` rule the
  // Finance screen uses. Deliberately NOT "did any room earn anything today" — that
  // would drop the Room block from a hotel's report on a quiet day, and the emailed
  // PDF would then disagree with the screen for the same period.
  const showRooms = m.showRooms;


  pdf.sectionTitle(showRooms ? "Restaurant Sales (tables & walk-ins)" : "Sales");
  pdf.row("Cash sales", money(m.salesTableCash));
  pdf.row("Online sales", money(m.salesTableOnline));
  pdf.row("Card sales", money(m.salesTableCard));
  pdf.row("Credit sales (billed, not collected)", money(m.salesTableCredit));
  pdf.row(
    showRooms ? "Total restaurant sales" : "Total sales",
    money(m.salesTableTotal),
    { strong: true }
  );

  if (showRooms) {
    pdf.sectionTitle("Room Sales");
    pdf.row("Cash sales", money(m.salesRoomCash));
    pdf.row("Online sales", money(m.salesRoomOnline));
    pdf.row("Card sales", money(m.salesRoomCard));
    // Settled by a deposit taken earlier, split by how that deposit was tendered, so the
    // rows add up. Advances are room-only, so they appear here and nowhere else. The
    // money itself was banked under Room Advances on the day it arrived.
    pdf.row("Paid by advance - cash", money(m.salesAdvanceCash));
    pdf.row("Paid by advance - online", money(m.salesAdvanceOnline));
    pdf.row("Credit sales (billed, not collected)", money(m.salesRoomCredit));
    pdf.row("Total room sales", money(m.salesRoomTotal), { strong: true });

    pdf.sectionTitle("All Sales");
    pdf.row("Restaurant", money(m.salesTableTotal));
    pdf.row("Rooms", money(m.salesRoomTotal));
    pdf.row("Total sales", money(m.salesTotal), { strong: true });
  }

  pdf.row("Total discounts", money(m.discounts));

  // Its OWN section, never a Sales line: a room deposit is money in with no sale behind
  // it yet — the sale books in full at checkout. Folding it into Sales would count the
  // same rupee twice. Omitted entirely for a restaurant that never takes one.
  // Same two-part gate the Finance screen uses: the hotel side must exist, and there
  // must be something to report.
  if (showRooms && (m.advancesReceived > 0 || m.advancesRefunded > 0 || m.advancesHeld > 0)) {
    pdf.sectionTitle("Room Advances");
    pdf.row("Advances received", money(m.advancesReceived));
    pdf.row("  - cash", money(m.advancesCash));
    pdf.row("  - online", money(m.advancesOnline));
    pdf.row("Advances refunded", money(m.advancesRefunded));
    pdf.row("  - cash", money(m.refundsCash));
    pdf.row("  - online", money(m.refundsOnline));
    pdf.row("Advance held at close", money(m.advancesHeld), { strong: true });
  }

  // Money in that isn't a sale — its own section, never a Sales line, so it can
  // never be mistaken for what the business actually sold. Omitted entirely on a
  // day with none, same two-part gate the other optional sections use.
  if (m.incomeTotal > 0) {
    pdf.sectionTitle("Extra Income");
    pdf.row("Cash", money(m.incomeCash));
    pdf.row("Online", money(m.incomeOnline));
    pdf.row("Card", money(m.incomeCard));
    pdf.row("Total Extra Income", money(m.incomeTotal), { strong: true });
    // Same rhythm as extra expenses' by-category breakdown: printed AFTER the
    // total, one line per entry, keyed by whatever the admin typed as the reason.
    for (const e of m.incomeEntries) {
      pdf.row(`  - ${e.description}`, money(e.amount));
    }
  }

  pdf.sectionTitle("Purchases & Expenses");
  pdf.row("Purchases - cash", money(m.purchasesCash));
  pdf.row("Purchases - online", money(m.purchasesOnline));
  pdf.row("Purchases - credit", money(m.purchasesCredit));
  pdf.row("Total purchases", money(m.purchasesTotal), { strong: true });
  pdf.row("Vendor payments", money(m.vendorPayments));
  pdf.row("New vendor credit", money(m.vendorCreditCreated));
  pdf.row("Salaries paid", money(m.salaryPaid));
  pdf.row("Salary advances", money(m.salaryAdvance));
  // Overheads. Printed with the same wording and the same breakdown as
  // /admin/finance — a PDF that disagrees with the screen is a support call.
  pdf.row("Extra expenses - cash", money(m.extraExpensesCash));
  pdf.row("Extra expenses - online", money(m.extraExpensesOnline));
  pdf.row("Total extra expenses", money(m.extraExpensesTotal), { strong: true });
  for (const c of m.extraExpensesByCategory) {
    pdf.row(`  - ${c.label}`, money(c.total));
  }

  pdf.sectionTitle("Credit");
  pdf.row("Customer credit collected", money(m.customerCreditCollected));
  if (m.customerCreditDiscounted > 0) {
    pdf.row("Customer credit discounted", money(m.customerCreditDiscounted));
  }
  pdf.row("New customer credit", money(m.customerCreditCreated));
  pdf.row("Customer credit outstanding", money(m.customerCreditOutstanding));
  pdf.row("Vendor credit outstanding", money(m.vendorCreditOutstanding));

  pdf.sectionTitle("Closing Balance");
  pdf.row("Cash", money(m.closingCash));
  pdf.row("Online / Bank", money(m.closingOnline));
  pdf.row("Credit to us (receivable)", money(m.closingCreditToUs));
  pdf.row("Credit by us (payable)", money(m.closingCreditByUs));
  // Part of the cash above is not yours yet. Saying so is the whole point of the figure.
  if (m.advancesHeld > 0) {
    pdf.row("Advance held (included in cash)", money(m.advancesHeld));
  }
  pdf.row("Net balance (cash + bank)", money(m.closingNet), { strong: true });

  pdf.sectionTitle("Estimated Profit");
  pdf.row(
    "Sales + extra income - purchases - salaries - expenses",
    money(m.estimatedProfit),
    { strong: true }
  );

  pdf.sectionTitle("Operations");
  pdf.row("Total bills", String(m.totalBills));
  pdf.row("Total orders", String(m.totalOrders));

  pdf.sectionTitle("Inventory");
  pdf.row("Inventory value", money(m.inventoryValue));
  pdf.row("Low stock items", String(m.lowStock));
  pdf.row("Out of stock items", String(m.outOfStock));

  if (!m.hasOpening) {
    pdf.spacer(10);
    pdf.note(
      "Note: no opening balance is set for this restaurant, so balances start from zero. Set one in Finance for accurate carry-forward."
    );
  }
  pdf.spacer(8);
  pdf.note(
    "Estimated profit is based on stock purchased during the day, not stock consumed, so a heavy-stocking day reads low and a run-down day reads high."
  );

  return pdf.finalize();
}
