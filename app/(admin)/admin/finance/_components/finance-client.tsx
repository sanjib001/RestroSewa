"use client";

import { useActionState, useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  exportFinanceCsv,
  getFinanceReport,
  getOpeningBalance,
  getPeriodPurchases,
  setOpeningBalance,
} from "@/app/actions/finance";
import type { ActionResult, OpeningBalance } from "@/app/actions/finance";
import {
  PERIOD_LABEL,
  PURCHASE_STATUS_COLOR,
  PURCHASE_STATUS_LABEL,
} from "@/lib/finance";
import type { FinancePeriod, FinancePurchase, FinanceReport } from "@/lib/finance";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "../../_components/modal";
import { Settings2, TriangleAlert } from "lucide-react";

const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const money2 = (n: number) =>
  `${n < 0 ? "−" : ""}₹${Math.abs(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const PERIODS: FinancePeriod[] = ["today", "yesterday", "week", "month", "year"];

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  online: "Online",
  credit: "Credit",
};

// Used only on the outstanding figures, so a receivable never reads as a
// payable. Deliberately the same weight as every other value on the sheet —
// colour carries the meaning, not size.
const OWED_TO_US = "#0f766e"; // teal — an asset
const WE_OWE = "#dc2626"; // red — a liability

// ── Generic balance-sheet section ─────────────────────────────────────────────

function Section({
  title,
  note,
  rows,
  total,
  children,
}: {
  title: string;
  note?: string;
  // `display` overrides the money formatting — used for counts ("3 customers").
  rows: { label: string; value: number; hint?: string; tone?: string; display?: string }[];
  total?: { label: string; value: number; tone?: string };
  children?: React.ReactNode;
}) {
  return (
    <section
      className="rounded-xl border overflow-hidden"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
    >
      <div
        className="px-4 py-2.5 border-b"
        style={{ background: "var(--color-canvas-soft)", borderColor: "var(--color-hairline)" }}
      >
        <p
          className="text-xs uppercase tracking-wide font-medium"
          style={{ color: "var(--color-ink)", letterSpacing: "0.06em" }}
        >
          {title}
        </p>
        {note && <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>{note}</p>}
      </div>

      {rows.map((r, i) => (
        <div
          key={r.label}
          className="flex items-baseline justify-between gap-3 px-4 py-2.5"
          style={{ borderTop: i === 0 ? "none" : "1px solid var(--color-hairline)" }}
        >
          <span className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
            {r.label}
            {r.hint && (
              <span className="block text-xs" style={{ color: "var(--color-ink-mute)", opacity: 0.75 }}>
                {r.hint}
              </span>
            )}
          </span>
          <span className="text-sm tabular-nums shrink-0" style={{ color: r.tone ?? "var(--color-ink)" }}>
            {r.display ?? money2(r.value)}
          </span>
        </div>
      ))}

      {children}

      {total && (
        <div
          className="flex items-center justify-between gap-3 px-4 py-3 border-t"
          style={{ background: "var(--color-canvas-soft)", borderColor: "var(--color-hairline)" }}
        >
          <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{total.label}</span>
          <span
            className="text-lg font-medium tabular-nums"
            style={{ color: total.tone ?? "var(--color-ink)" }}
          >
            {money2(total.value)}
          </span>
        </div>
      )}
    </section>
  );
}

// ── Purchases: who we bought from ─────────────────────────────────────────────

// A purchase reads as another row of the Purchases section — same rhythm as the
// figures above it, with a small status pill (the same pill the Stock and Vendors
// screens already use). No icon tile: it is a line item, not a headline.
function PurchaseLine({ p }: { p: FinancePurchase }) {
  const tone = PURCHASE_STATUS_COLOR[p.status];
  const time = new Date(p.created_at).toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <Link
      href="/admin/purchases"
      className="flex items-baseline justify-between gap-3 px-4 py-2.5"
      style={{ borderTop: "1px solid var(--color-hairline)" }}
    >
      <span className="min-w-0">
        <span className="block text-sm truncate" style={{ color: "var(--color-ink)" }}>
          {p.vendor_name}
        </span>
        {/* The whole story on one line: when, how big, how settled. */}
        <span className="block text-xs" style={{ color: "var(--color-ink-mute)" }}>
          {time} · {p.productCount} product{p.productCount !== 1 ? "s" : ""} ·{" "}
          {METHOD_LABEL[p.method] ?? p.method}
          {p.vendor_code && <span className="hidden sm:inline"> · {p.vendor_code}</span>}
        </span>
      </span>

      <span className="text-right shrink-0">
        <span className="block text-sm tabular-nums" style={{ color: "var(--color-ink)" }}>
          {money2(p.total)}
        </span>
        <span className="block text-xs" style={{ color: tone }}>
          {PURCHASE_STATUS_LABEL[p.status]}
          {p.status === "partial" && (
            <span style={{ color: "var(--color-ink-mute)" }}> · {money(p.creditAmount)} owed</span>
          )}
        </span>
      </span>
    </Link>
  );
}

// ── Opening balance ───────────────────────────────────────────────────────────

function OpeningForm({ current, onDone }: { current: OpeningBalance; onDone: () => void }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(setOpeningBalance, null);

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !state?.error) onDone();
    wasPending.current = pending;
  }, [pending, state, onDone]);

  const defaultDate = current
    ? new Date(current.effective_from).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
        The money you had before the system started tracking it. Set this once — every day
        after it carries forward automatically, so you never type a balance again.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="f_cash" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
            Cash in hand (₹)
          </label>
          <Input id="f_cash" name="cash" type="number" min="0" step="0.01" placeholder="0.00" defaultValue={current?.cash ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="f_online" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
            Bank / online (₹)
          </label>
          <Input id="f_online" name="online" type="number" min="0" step="0.01" placeholder="0.00" defaultValue={current?.online ?? ""} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="f_date" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
          Books start from
        </label>
        <input
          id="f_date"
          name="effective_from"
          type="date"
          required
          defaultValue={defaultDate}
          className="w-full text-sm rounded-lg border px-3 py-2"
          style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline-input)", color: "var(--color-ink)" }}
        />
        <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          Sales and purchases recorded before this date are treated as already included in the
          figures above, so they are not counted twice.
        </p>
      </div>

      {current && (
        <div
          className="rounded-lg border px-3 py-2.5 flex items-start gap-2"
          style={{ background: "#fff7ed", borderColor: "#f9731644" }}
        >
          <TriangleAlert size={14} className="mt-0.5 shrink-0" style={{ color: "#9a3412" }} />
          <p className="text-xs" style={{ color: "#9a3412" }}>
            Changing this re-bases every balance from the new start date. Only adjust it if the
            original figures were wrong.
          </p>
        </div>
      )}

      {state?.error && (
        <p className="text-sm rounded-md px-3 py-2" style={{ color: "var(--color-ruby)", background: "#fff0f4" }}>
          {state.error}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Saving…" : current ? "Update opening balance" : "Set opening balance"}
      </Button>
    </form>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export function FinanceClient({
  initial,
  initialOpening,
  initialPurchases,
  canManage,
}: {
  initial: FinanceReport;
  initialOpening: OpeningBalance;
  initialPurchases: FinancePurchase[];
  canManage: boolean;
}) {
  const [report, setReport] = useState(initial);
  const [opening, setOpening] = useState(initialOpening);
  const [purchases, setPurchases] = useState(initialPurchases);
  const [period, setPeriod] = useState<FinancePeriod>(initial.period);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [loading, startTransition] = useTransition();
  const [exporting, setExporting] = useState(false);
  const [settingOpening, setSettingOpening] = useState(false);

  const load = useCallback((p: FinancePeriod, from?: string, to?: string) => {
    startTransition(async () => {
      try {
        const args = { period: p, from: from ?? null, to: to ?? null };
        const [next, list] = await Promise.all([
          getFinanceReport(args),
          getPeriodPurchases(args),
        ]);
        setReport(next);
        setPurchases(list);
      } catch {
        // keep the last known report on a transient failure
      }
    });
  }, []);

  const selectPeriod = (p: FinancePeriod) => {
    setPeriod(p);
    if (p !== "custom") load(p);
  };

  const applyCustom = () => {
    if (!customFrom && !customTo) return;
    setPeriod("custom");
    load("custom", customFrom || undefined, customTo || undefined);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await exportFinanceCsv({
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
      alert("Could not export the report. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  // Re-seeding the opening balance re-bases every figure, so pull both back.
  const refreshAll = useCallback(async () => {
    const [rep, op] = await Promise.all([
      getFinanceReport({ period, from: customFrom || null, to: customTo || null }),
      getOpeningBalance(),
    ]);
    setReport(rep);
    setOpening(op);
  }, [period, customFrom, customTo]);

  // Sales, purchases, credit and vendor payments all move these figures.
  const resync = useCallback(
    () => load(period, customFrom || undefined, customTo || undefined),
    [load, period, customFrom, customTo]
  );
  useRealtime(["billing", "credits", "purchases", "vendors", "finance"], resync);

  const netMovement = report.closingNet - (report.openingCash + report.openingOnline);
  const periodLabel = PERIOD_LABEL[report.period];
  const netCredit = report.customerCreditOutstanding - report.vendorCreditOutstanding;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <div>
          <h1 className="text-xl" style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}>
            Daily Finance
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
            Showing <span style={{ color: "var(--color-ink)" }}>{periodLabel}</span>
            {loading && <span className="ml-2">Updating…</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <Button variant="secondary" size="sm" onClick={() => setSettingOpening(true)}>
              <Settings2 size={14} /> Opening balance
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={exportCsv} disabled={exporting}>
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        </div>
      </div>

      {!report.hasOpening && (
        <div
          className="rounded-lg border px-3 py-2.5 flex items-start gap-2 mt-4"
          style={{ background: "#fff7ed", borderColor: "#f9731644" }}
        >
          <TriangleAlert size={14} className="mt-0.5 shrink-0" style={{ color: "#9a3412" }} />
          <p className="text-xs" style={{ color: "#9a3412" }}>
            <span className="font-medium">No opening balance set.</span> Balances below start from
            zero and count every transaction ever recorded.
            {canManage && " Set your opening balance so they reflect real money."}
          </p>
        </div>
      )}

      {/* Period picker */}
      <div className="flex gap-2 overflow-x-auto my-4" style={{ scrollbarWidth: "none" }}>
        {PERIODS.map((p) => {
          const active = period === p;
          return (
            <button
              key={p}
              type="button"
              onClick={() => selectPeriod(p)}
              className="shrink-0 text-sm px-3 py-1.5 rounded-full border transition-colors"
              style={{
                borderColor: active ? "var(--color-primary)" : "var(--color-hairline)",
                background: active ? "var(--color-primary)" : "var(--color-canvas)",
                color: active ? "#fff" : "var(--color-ink)",
              }}
            >
              {PERIOD_LABEL[p]}
            </button>
          );
        })}
      </div>

      {/* Custom range */}
      <div
        className="rounded-xl border px-4 py-3 mb-5"
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

      {/* Where the money ended up */}
      <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <div className="rounded-xl border px-4 py-3" style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}>
          <p className="text-xs mb-1" style={{ color: "var(--color-ink-mute)" }}>Closing cash</p>
          <p className="text-lg font-medium tabular-nums" style={{ color: "var(--color-ink)" }}>{money(report.closingCash)}</p>
        </div>
        <div className="rounded-xl border px-4 py-3" style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}>
          <p className="text-xs mb-1" style={{ color: "var(--color-ink-mute)" }}>Closing online / bank</p>
          <p className="text-lg font-medium tabular-nums" style={{ color: "var(--color-ink)" }}>{money(report.closingOnline)}</p>
        </div>
        <div className="rounded-xl border px-4 py-3" style={{ background: "var(--color-primary)", borderColor: "var(--color-primary)" }}>
          <p className="text-xs mb-1" style={{ color: "rgba(255,255,255,0.75)" }}>Net balance</p>
          <p className="text-lg font-medium tabular-nums" style={{ color: "#fff" }}>{money(report.closingNet)}</p>
          <p className="text-[10px] tabular-nums" style={{ color: "rgba(255,255,255,0.7)" }}>
            {netMovement >= 0 ? "+" : "−"}{money(Math.abs(netMovement))} this period
          </p>
        </div>
      </div>

      {/* Opening → Sales → Purchases → Credit → Closing, as one sheet. */}
      <div className="flex flex-col gap-4">
        <Section
          title="Opening balance"
          note="Carried forward from the previous period"
          rows={[
            { label: "Cash", value: report.openingCash },
            { label: "Online / bank", value: report.openingOnline },
          ]}
          total={{ label: "Total", value: report.openingCash + report.openingOnline }}
        />

        <Section
          title={`Sales · ${periodLabel}`}
          note="Total is the full value billed — credit included (accrual)"
          rows={[
            { label: "Cash sales", value: report.salesCash, tone: "#1a7a4a" },
            { label: "Online sales", value: report.salesOnline, tone: "#1a7a4a" },
            ...(report.salesCard > 0
              ? [{ label: "Card sales", value: report.salesCard, tone: "#1a7a4a" }]
              : []),
            {
              label: "Credit sales",
              value: report.salesCredit,
              hint: "Billed but not collected",
              tone: "#f97316",
            },
          ]}
          total={{ label: "Total sales", value: report.salesTotal }}
        />

        <Section
          title={`Purchases · ${periodLabel}`}
          note={
            purchases.length === 0
              ? undefined
              : `${purchases.length} purchase${purchases.length !== 1 ? "s" : ""} — who you bought from`
          }
          rows={[
            { label: "Cash purchases", value: report.purchasesCash, tone: "#dc2626" },
            { label: "Online purchases", value: report.purchasesOnline, tone: "#dc2626" },
            {
              label: "Credit purchases",
              value: report.purchasesCredit,
              hint: "Owed to vendors, not yet paid",
              tone: "#f97316",
            },
          ]}
          total={{ label: "Total purchase cost", value: report.purchasesTotal }}
        >
          {/* Each supplier bill behind the total — so the admin never has to leave
              the page to find out who a purchase was from. */}
          {purchases.length > 0 && (
            <>
              <div
                className="px-4 py-1.5"
                style={{ borderTop: "1px solid var(--color-hairline)", background: "var(--color-canvas-soft)" }}
              >
                <p
                  className="text-[11px] uppercase tracking-wide"
                  style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
                >
                  Bought from
                </p>
              </div>
              {purchases.map((p) => <PurchaseLine key={p.id} p={p} />)}
            </>
          )}
        </Section>

        {/* Credit — the two halves of the ledger, side by side on wide screens.
            Same section chrome as the rest of the sheet; the outstanding figure
            sits in the emphasised total row, where the eye already goes. */}
        <div className="grid gap-4 md:grid-cols-2">
          <Section
            title="Customer credits"
            note="Owed to us"
            rows={[
              {
                label: `Collected · ${periodLabel}`,
                value: report.customerCreditCollected,
                tone: report.customerCreditCollected > 0 ? "#1a7a4a" : undefined,
              },
              {
                label: `New credits · ${periodLabel}`,
                value: report.customerCreditCreated,
                tone: report.customerCreditCreated > 0 ? "#f97316" : undefined,
              },
              {
                label: "Pending customers",
                value: report.pendingCustomers,
                display: String(report.pendingCustomers),
              },
            ]}
            total={{
              label: "Total outstanding",
              value: report.customerCreditOutstanding,
              tone: report.customerCreditOutstanding > 0 ? OWED_TO_US : undefined,
            }}
          />

          <Section
            title="Vendor credits"
            note="Owed by us"
            rows={[
              {
                label: `Paid · ${periodLabel}`,
                value: report.vendorCreditPaid,
                tone: report.vendorCreditPaid > 0 ? "#1a7a4a" : undefined,
              },
              {
                label: `New credit purchases · ${periodLabel}`,
                value: report.vendorCreditCreated,
                tone: report.vendorCreditCreated > 0 ? "#f97316" : undefined,
              },
              {
                label: "Pending vendors",
                value: report.pendingVendors,
                display: String(report.pendingVendors),
              },
            ]}
            total={{
              label: "Total outstanding",
              value: report.vendorCreditOutstanding,
              tone: report.vendorCreditOutstanding > 0 ? WE_OWE : undefined,
            }}
          />
        </div>

        {/* The receivable / payable pair, as one more row of the sheet. */}
        <Section
          title="Credit position"
          note="Credit moves no cash until it is collected or paid"
          rows={[
            {
              label: "Amount owed to us",
              hint:
                report.pendingCustomers > 0
                  ? `${report.pendingCustomers} customer${report.pendingCustomers !== 1 ? "s" : ""}`
                  : undefined,
              value: report.customerCreditOutstanding,
              tone: report.customerCreditOutstanding > 0 ? OWED_TO_US : undefined,
            },
            {
              label: "Amount we owe",
              hint:
                report.pendingVendors > 0
                  ? `${report.pendingVendors} vendor${report.pendingVendors !== 1 ? "s" : ""}`
                  : undefined,
              value: report.vendorCreditOutstanding,
              tone: report.vendorCreditOutstanding > 0 ? WE_OWE : undefined,
            },
          ]}
          total={{
            label: netCredit >= 0 ? "Net owed to us" : "Net we owe",
            value: Math.abs(netCredit),
            tone: netCredit >= 0 ? OWED_TO_US : WE_OWE,
          }}
        />

        <Section
          title="Closing balance"
          note="Opening + money collected − money spent"
          rows={[
            { label: "Cash balance", value: report.closingCash },
            { label: "Online / bank balance", value: report.closingOnline },
          ]}
          total={{ label: "Net balance", value: report.closingNet, tone: "var(--color-primary)" }}
        />
      </div>

      <Modal
        open={settingOpening}
        onClose={() => setSettingOpening(false)}
        title={opening ? "Update opening balance" : "Set opening balance"}
        subtitle="The money you started with"
      >
        <OpeningForm current={opening} onDone={() => { setSettingOpening(false); refreshAll(); }} />
      </Modal>
    </div>
  );
}
