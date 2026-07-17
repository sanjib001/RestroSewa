"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { getSalesReport, exportSalesCsv } from "@/app/actions/pos";
import type { SalesPeriod, SalesReport, SalesTxn } from "@/app/actions/pos";
import { SETTLEMENT_COLOR, SETTLEMENT_LABEL } from "@/lib/credits";
import type { CreditStats } from "@/lib/credits";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { PaidBillButton } from "./paid-bill";

// Fallback for a report that predates credits (a stale client-router payload).
const EMPTY_CREDIT_STATS: CreditStats = {
  outstanding: 0,
  collected: 0,
  created: 0,
  pendingCount: 0,
  fullyPaidCount: 0,
  openCount: 0,
};

function money(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  online: "Online",
  mixed: "Cash + Online",
  card: "Card",
  credit: "Credit",
  upi: "UPI",
  other: "Other",
};

// The selectable periods, in display order. The card total for each comes from
// the always-computed overview; "all" and "custom" don't get an overview card.
const PERIOD_CARDS: { key: Exclude<SalesPeriod, "custom">; label: string; overviewKey?: keyof SalesReport["overview"] }[] = [
  { key: "today", label: "Today", overviewKey: "today" },
  { key: "week", label: "This Week", overviewKey: "week" },
  { key: "month", label: "This Month", overviewKey: "month" },
  { key: "year", label: "This Year", overviewKey: "year" },
  { key: "all", label: "All Time", overviewKey: "total" },
];

const PERIOD_LABEL: Record<SalesPeriod, string> = {
  today: "Today",
  week: "This Week",
  month: "This Month",
  year: "This Year",
  all: "All Time",
  custom: "Custom Range",
};

// ── Date-bucketing for the transaction list (Today / Yesterday / Month Year) ──
function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function bucketLabel(iso: string): string {
  const d = new Date(iso);
  const today = startOfDay(new Date());
  const day = startOfDay(d);
  const oneDay = 24 * 60 * 60 * 1000;
  if (day === today) return "Today";
  if (day === today - oneDay) return "Yesterday";
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function groupByDate(txns: SalesTxn[]): { label: string; items: SalesTxn[] }[] {
  const groups: { label: string; items: SalesTxn[] }[] = [];
  const index = new Map<string, { label: string; items: SalesTxn[] }>();
  for (const t of txns) {
    const label = bucketLabel(t.created_at);
    let g = index.get(label);
    if (!g) {
      g = { label, items: [] };
      index.set(label, g);
      groups.push(g);
    }
    g.items.push(t);
  }
  return groups;
}

function StatTile({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const clickable = !!onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      className="rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-default"
      // The selected period wears Sales' green. Constant green FILL (not the flipping accent):
      // in dark the accent goes light-green and the white text on this tile can't sit on it.
      style={{
        background: active ? "var(--fill-green)" : "var(--color-canvas)",
        borderColor: active ? "var(--fill-green)" : "var(--color-hairline)",
      }}
    >
      <p className="text-xs mb-1" style={{ color: active ? "rgba(255,255,255,0.75)" : "var(--color-ink-mute)" }}>
        {label}
      </p>
      <p className="text-lg font-medium tabular-nums" style={{ color: active ? "#fff" : "var(--color-ink)" }}>
        {value}
      </p>
    </button>
  );
}

function TxnCard({ txn }: { txn: SalesTxn }) {
  const location = txn.table_number
    ? `Table ${txn.table_number}`
    : txn.room_number
    ? `Room ${txn.room_number}`
    : txn.session_type === "walk_in"
    ? "Walk-in"
    : "—";

  const time = new Date(txn.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const method = METHOD_LABEL[txn.method] ?? txn.method;
  // Default to "paid": a transaction from a stale (pre-credits) payload carries
  // no settlement, and treating that as unpaid would brand old bills as credit.
  const settlement = txn.settlement ?? "paid";
  const onCredit = settlement !== "paid";
  const symbol = onCredit ? "◷" : txn.method === "cash" ? "₹" : txn.method === "mixed" ? "⬡₹" : "⬡";
  const tone = SETTLEMENT_COLOR[settlement];

  return (
    <div
      className="rounded-xl border px-4 py-3 flex items-center gap-3"
      style={{
        background: "var(--color-canvas)",
        borderColor: onCredit ? `${tone}44` : "var(--color-hairline)",
      }}
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center text-xs font-medium shrink-0"
        style={{
          background: onCredit ? `${tone}14` : "var(--color-canvas-soft)",
          color: onCredit ? tone : "var(--color-ink-mute)",
        }}
      >
        {symbol}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
          {location}
          {txn.customer_name && (
            <span className="ml-2 text-xs font-normal" style={{ color: "var(--color-ink-mute)" }}>{txn.customer_name}</span>
          )}
        </p>
        <p className="text-xs truncate" style={{ color: "var(--color-ink-mute)" }}>
          #{txn.id.slice(0, 8)} · {method} · {time}
          {txn.credit_number && ` · ${txn.credit_number}`}
        </p>
      </div>
      <div className="text-right shrink-0">
        {/* The full bill value — a credit bill is billed in full, so this is what
            it contributed to Sales. What's still owed is called out below it. */}
        <p className="text-sm font-medium tabular-nums" style={{ color: "var(--color-ink)" }}>{money(txn.amount)}</p>
        <p className="text-[10px] uppercase tracking-wide" style={{ color: tone, letterSpacing: "0.06em" }}>
          {SETTLEMENT_LABEL[settlement]}
        </p>
        {onCredit && txn.credit_unpaid > 0 && (
          <p className="text-[10px] tabular-nums" style={{ color: "var(--color-ink-mute)" }}>
            {money(txn.credit_unpaid)} on credit
          </p>
        )}
      </div>
      {/* Reprint the bill on demand — reuses the payment record. */}
      <PaidBillButton paymentId={txn.id} />
    </div>
  );
}

export function SalesView({ initial, embedded = false }: { initial: SalesReport; embedded?: boolean }) {
  const [report, setReport] = useState<SalesReport>(initial);
  const [period, setPeriod] = useState<SalesPeriod>(initial.period);
  const [customFrom, setCustomFrom] = useState<string>(initial.from ?? "");
  const [customTo, setCustomTo] = useState<string>(initial.to ?? "");
  const [loading, startTransition] = useTransition();
  const [exporting, setExporting] = useState(false);
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    return () => { activeRef.current = false; };
  }, []);

  const load = useCallback((p: SalesPeriod, from?: string, to?: string) => {
    startTransition(async () => {
      try {
        const next = await getSalesReport({ period: p, from: from ?? null, to: to ?? null });
        if (activeRef.current) setReport(next);
      } catch {
        // keep last known report on transient failure
      }
    });
  }, []);

  const selectPeriod = useCallback((p: SalesPeriod) => {
    setPeriod(p);
    if (p !== "custom") load(p);
  }, [load]);

  const applyCustom = useCallback(() => {
    if (!customFrom && !customTo) return;
    load("custom", customFrom || undefined, customTo || undefined);
  }, [customFrom, customTo, load]);

  // Export the CURRENT filter (period or custom range) as CSV — the server
  // re-runs the same query (uncapped) so the file matches what's on screen.
  const exportCsv = useCallback(async () => {
    setExporting(true);
    try {
      const res = await exportSalesCsv({
        period,
        from: customFrom || null,
        to: customTo || null,
      });
      if ("error" in res) {
        alert(res.error);
        return;
      }
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert("Could not export sales. Please try again.");
    } finally {
      setExporting(false);
    }
  }, [period, customFrom, customTo]);

  // A bill closed at any till updates takings here at once.
  const resync = useCallback(
    () => load(period, customFrom || undefined, customTo || undefined),
    [load, period, customFrom, customTo]
  );
  useRealtime(["billing", "credits"], resync);

  const groups = useMemo(() => groupByDate(report.transactions), [report.transactions]);

  // A report cached by the client router from before credits existed has no
  // `credit` field, so don't assume it's there — an undefined read would take the
  // whole Sales screen down until that cache expires.
  const credit = report.credit ?? EMPTY_CREDIT_STATS;
  const breakdownCredit = report.breakdown?.credit ?? 0;
  const hasCredit = credit.outstanding > 0 || credit.created > 0 || credit.collected > 0;

  // "Credit" is the part of the period's billed value that was NOT collected, so
  // the bars add up to the whole of Sales rather than only the money taken.
  const breakdownItems = [
    { label: "Cash", value: report.breakdown.cash, tone: "var(--color-primary)" },
    { label: "Online", value: report.breakdown.online, tone: "var(--color-primary)" },
    { label: "Card", value: report.breakdown.card, tone: "var(--color-primary)" },
    { label: "Credit", value: breakdownCredit, tone: "#f97316" },
    { label: "Other", value: report.breakdown.other, tone: "var(--color-primary)" },
  ].filter((b) => b.value > 0);

  return (
    <div className={embedded ? "" : "p-4 sm:p-5 max-w-2xl mx-auto"}>
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-baseline gap-3">
          {!embedded && (
            <h1 className="text-xl" style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}>
              Sales
            </h1>
          )}
          {loading && <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Updating…</span>}
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={exporting}
          className="text-sm px-3 py-1.5 rounded-lg font-medium border transition-colors disabled:opacity-50"
          style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
        >
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>
      <p className="text-sm mb-5" style={{ color: "var(--color-ink-mute)" }}>
        Showing <span style={{ color: "var(--color-ink)" }}>{PERIOD_LABEL[report.period]}</span>
        {" · "}
        {report.orderCount === 0
          ? "no bills in this period"
          : `${report.orderCount} bill${report.orderCount !== 1 ? "s" : ""}`}
      </p>

      {/* Period cards double as the filter — click one to scope everything below.
          Auto-fit so they reflow to the available width instead of cramming into
          a fixed 5 columns. */}
      <div
        className="grid gap-3 mb-3"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}
      >
        {PERIOD_CARDS.map((c) => (
          <StatTile
            key={c.key}
            label={c.label}
            value={money(c.overviewKey ? report.overview[c.overviewKey] : 0)}
            active={period === c.key}
            onClick={() => selectPeriod(c.key)}
          />
        ))}
      </div>

      {/* Custom date range */}
      <div
        className="rounded-xl border px-4 py-3 mb-4"
        style={{
          background: period === "custom" ? "var(--color-canvas-soft)" : "var(--color-canvas)",
          borderColor: period === "custom" ? "var(--color-primary)" : "var(--color-hairline)",
        }}
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[130px]">
            <label className="block text-xs mb-1" style={{ color: "var(--color-ink-mute)" }}>From</label>
            <input
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="w-full text-sm rounded-lg border px-2.5 py-1.5"
              style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
            />
          </div>
          <div className="flex-1 min-w-[130px]">
            <label className="block text-xs mb-1" style={{ color: "var(--color-ink-mute)" }}>To</label>
            <input
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={(e) => setCustomTo(e.target.value)}
              className="w-full text-sm rounded-lg border px-2.5 py-1.5"
              style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
            />
          </div>
          <button
            type="button"
            onClick={applyCustom}
            disabled={!customFrom && !customTo}
            className="text-sm px-4 py-1.5 rounded-lg font-medium disabled:opacity-50"
            style={{ background: "var(--color-primary)", color: "#fff" }}
          >
            Apply
          </button>
        </div>
      </div>

      {/* Period stats */}
      <div
        className="grid gap-3 mb-6"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}
      >
        <StatTile label={`Sales · ${PERIOD_LABEL[report.period]}`} value={money(report.periodTotal)} />
        <StatTile label="Number of Orders" value={String(report.orderCount)} />
        <StatTile label="Avg. Order Value" value={money(report.avgOrderValue)} />
        {/* Sales above is already net of this — it's shown so a manager can see how much
            was given away, not so it can be added back on. */}
        {report.discountsTotal > 0 && (
          <StatTile label="Discounts Given" value={money(report.discountsTotal)} />
        )}
      </div>

      {/* Payment method breakdown */}
      {breakdownItems.length > 0 && (
        <section className="mb-6">
          <p className="text-xs uppercase tracking-wide mb-2 font-medium" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
            Payment methods
          </p>
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--color-hairline)" }}>
            {breakdownItems.map((b, i) => {
              const pct = report.periodTotal > 0 ? (b.value / report.periodTotal) * 100 : 0;
              return (
                <div
                  key={b.label}
                  className="flex items-center gap-3 px-4 py-2.5"
                  style={{ background: "var(--color-canvas)", borderTop: i === 0 ? "none" : "1px solid var(--color-hairline)" }}
                >
                  <span className="text-sm w-16 shrink-0" style={{ color: "var(--color-ink)" }}>{b.label}</span>
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--color-canvas-soft)" }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: b.tone }} />
                  </div>
                  <span className="text-sm tabular-nums w-20 text-right" style={{ color: "var(--color-ink)" }}>{money(b.value)}</span>
                </div>
              );
            })}
          </div>
          {breakdownCredit > 0 && (
            <p className="text-xs mt-1.5 px-1" style={{ color: "var(--color-ink-mute)" }}>
              Credit is billed but not yet collected — it counts as sales, and is chased in Credits.
            </p>
          )}
        </section>
      )}

      {/* Credits — only shown once there's something to show. Outstanding and the
          status counts are as-of-now; collected/created follow the period filter. */}
      {hasCredit && (
        <section className="mb-6">
          <p className="text-xs uppercase tracking-wide mb-2 font-medium" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
            Credits
          </p>
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}
          >
            <StatTile
              label="Outstanding (now)"
              value={money(credit.outstanding)}
            />
            <StatTile
              label={`Collected · ${PERIOD_LABEL[report.period]}`}
              value={money(credit.collected)}
            />
            <StatTile
              label={`Credit created · ${PERIOD_LABEL[report.period]}`}
              value={money(credit.created)}
            />
            {/* Counted over CUSTOMERS now — one person with three unpaid bills is
                one debtor to chase, not three. */}
            <StatTile label="Customers owing" value={String(credit.pendingCount)} />
            <StatTile label="Settled customers" value={String(credit.fullyPaidCount)} />
          </div>
        </section>
      )}

      {/* Recent transactions, grouped by date like a banking app */}
      <section>
        <p className="text-xs uppercase tracking-wide mb-2 font-medium" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
          Transactions
        </p>
        {report.transactions.length === 0 ? (
          <div
            className="rounded-xl border px-6 py-12 text-center"
            style={{ borderStyle: "dashed", borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
          >
            <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>No payments in this period.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map((g) => (
              <div key={g.label}>
                <div className="flex items-center justify-between mb-2 px-1">
                  <p className="text-xs font-medium" style={{ color: "var(--color-ink)" }}>{g.label}</p>
                  <p className="text-xs tabular-nums" style={{ color: "var(--color-ink-mute)" }}>
                    {money(g.items.reduce((sum, t) => sum + t.amount, 0))}
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  {g.items.map((t) => <TxnCard key={t.id} txn={t} />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
