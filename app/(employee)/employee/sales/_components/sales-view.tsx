"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { getSalesReport } from "@/app/actions/pos";
import type { SalesPeriod, SalesReport, SalesTxn } from "@/app/actions/pos";

function money(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  online: "Online",
  mixed: "Cash + Online",
  card: "Card",
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
      style={{
        background: active ? "var(--color-primary)" : "var(--color-canvas)",
        borderColor: active ? "var(--color-primary)" : "var(--color-hairline)",
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
  const symbol = txn.method === "cash" ? "₹" : txn.method === "mixed" ? "⬡₹" : "⬡";

  return (
    <div
      className="rounded-xl border px-4 py-3 flex items-center gap-3"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center text-xs font-medium shrink-0"
        style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
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
        <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          #{txn.id.slice(0, 8)} · {method} · {time}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-medium tabular-nums" style={{ color: "var(--color-ink)" }}>{money(txn.amount)}</p>
        <p className="text-[10px] uppercase tracking-wide" style={{ color: "#1a7a4a", letterSpacing: "0.06em" }}>Paid</p>
      </div>
    </div>
  );
}

export function SalesView({ initial }: { initial: SalesReport }) {
  const [report, setReport] = useState<SalesReport>(initial);
  const [period, setPeriod] = useState<SalesPeriod>(initial.period);
  const [customFrom, setCustomFrom] = useState<string>(initial.from ?? "");
  const [customTo, setCustomTo] = useState<string>(initial.to ?? "");
  const [loading, startTransition] = useTransition();
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

  const groups = useMemo(() => groupByDate(report.transactions), [report.transactions]);

  const breakdownItems = [
    { label: "Cash", value: report.breakdown.cash },
    { label: "Online", value: report.breakdown.online },
    { label: "Card", value: report.breakdown.card },
    { label: "Other", value: report.breakdown.other },
  ].filter((b) => b.value > 0);

  return (
    <div className="p-5 max-w-2xl">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h1 className="text-xl" style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}>
          Sales
        </h1>
        {loading && <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Updating…</span>}
      </div>
      <p className="text-sm mb-5" style={{ color: "var(--color-ink-mute)" }}>
        Showing <span style={{ color: "var(--color-ink)" }}>{PERIOD_LABEL[report.period]}</span>
        {" · "}
        {report.orderCount === 0
          ? "no bills in this period"
          : `${report.orderCount} bill${report.orderCount !== 1 ? "s" : ""}`}
      </p>

      {/* Period cards double as the filter — click one to scope everything below. */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-3">
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
      <div className="grid grid-cols-3 gap-3 mb-6">
        <StatTile label={`Sales · ${PERIOD_LABEL[report.period]}`} value={money(report.periodTotal)} />
        <StatTile label="Number of Orders" value={String(report.orderCount)} />
        <StatTile label="Avg. Order Value" value={money(report.avgOrderValue)} />
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
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--color-primary)" }} />
                  </div>
                  <span className="text-sm tabular-nums w-20 text-right" style={{ color: "var(--color-ink)" }}>{money(b.value)}</span>
                </div>
              );
            })}
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
