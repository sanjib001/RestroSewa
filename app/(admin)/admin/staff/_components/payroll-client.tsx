"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  getPayrollHistory,
  getPayrollSheet,
  recordSalaryPayment,
  setStaffSalary,
} from "@/app/actions/payroll";
import type { ActionResult } from "@/app/actions/payroll";
import {
  PAYMENT_KIND_LABEL,
  PAYROLL_STATUS_COLOR,
  PAYROLL_STATUS_LABEL,
  PAY_METHOD_LABEL,
  isCurrentMonth,
  monthLabel,
  shiftMonth,
} from "@/lib/payroll";
import type {
  PayMethod,
  PaymentKind,
  PayrollHistoryMonth,
  PayrollRow,
  PayrollSheet,
} from "@/lib/payroll";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "../../_components/modal";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Wallet,
} from "lucide-react";

const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const money2 = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

const day = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { dateStyle: "medium" });

// ── Status pill ───────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: PayrollRow["status"] }) {
  const tone = PAYROLL_STATUS_COLOR[status];
  return (
    <span
      className="text-[11px] px-2 py-0.5 rounded-full shrink-0"
      style={{ color: tone, background: `${tone}14`, border: `1px solid ${tone}33` }}
    >
      {PAYROLL_STATUS_LABEL[status]}
    </span>
  );
}

// ── Set / revise a salary ─────────────────────────────────────────────────────

function SalaryForm({
  staffId,
  staffName,
  currentSalary,
  joiningDate,
  month,
  onDone,
}: {
  staffId: string;
  staffName: string;
  currentSalary: number | null;
  joiningDate: string | null;
  month: string;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(setStaffSalary, null);

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !state?.error) onDone();
    wasPending.current = pending;
  }, [pending, state, onDone]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="staff_id" value={staffId} />

      <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
        Setting the salary for <span style={{ color: "var(--color-ink)" }}>{staffName}</span>.
      </p>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="p_salary"
          className="text-xs uppercase tracking-wide"
          style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
        >
          Monthly salary (₹)
        </label>
        <Input
          id="p_salary"
          name="monthly_salary"
          type="number"
          min="0"
          step="0.01"
          required
          autoFocus
          placeholder="25000.00"
          defaultValue={currentSalary ?? ""}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="p_joining"
          className="text-xs uppercase tracking-wide"
          style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
        >
          Joining date
        </label>
        <input
          id="p_joining"
          name="joining_date"
          type="date"
          required
          max={today}
          defaultValue={joiningDate ?? today}
          className="w-full text-sm rounded-lg border px-3 py-2"
          style={{
            background: "var(--color-canvas)",
            borderColor: "var(--color-hairline-input)",
            color: "var(--color-ink)",
          }}
        />
        <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          Payroll starts from the month they joined. Nothing is owed for any month before it.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="p_effective"
          className="text-xs uppercase tracking-wide"
          style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
        >
          Effective from
        </label>
        <input
          id="p_effective"
          name="effective_from"
          type="month"
          required
          defaultValue={month.slice(0, 7)}
          className="w-full text-sm rounded-lg border px-3 py-2"
          style={{
            background: "var(--color-canvas)",
            borderColor: "var(--color-hairline-input)",
            color: "var(--color-ink)",
          }}
        />
        {/* The whole reason salary is dated. Worth saying out loud on the form —
            an admin giving someone a raise needs to know it won't reopen a month
            they have already paid and closed. */}
        <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          A raise applies from this month onwards. Months already paid keep the salary that was
          in force for them and are not reopened.
        </p>
      </div>

      {state?.error && (
        <p
          className="text-sm rounded-md px-3 py-2"
          style={{ color: "var(--color-ruby)", background: "var(--color-danger-bg)" }}
        >
          {state.error}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Saving…" : currentSalary == null ? "Set salary" : "Update salary"}
      </Button>
    </form>
  );
}

// ── Pay a salary, or an advance against it ────────────────────────────────────

function PaymentForm({
  row,
  month,
  kind,
  onDone,
}: {
  row: PayrollRow;
  month: string;
  kind: PaymentKind;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(recordSalaryPayment, null);
  const [method, setMethod] = useState<PayMethod>("cash");

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !state?.error) onDone();
    wasPending.current = pending;
  }, [pending, state, onDone]);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="staff_id" value={row.staff_id} />
      <input type="hidden" name="salary_month" value={month} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="method" value={method} />

      {/* Where the number comes from, before they type one. */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: "var(--color-hairline)" }}
      >
        {[
          { label: `Salary · ${monthLabel(month)}`, value: money2(row.monthly_salary ?? 0) },
          ...(row.advancePaid > 0
            ? [{ label: "Advance already paid", value: `− ${money2(row.advancePaid)}` }]
            : []),
          ...(row.salaryPaid > 0
            ? [{ label: "Salary already paid", value: `− ${money2(row.salaryPaid)}` }]
            : []),
        ].map((r, i) => (
          <div
            key={r.label}
            className="flex items-baseline justify-between gap-3 px-4 py-2 text-sm"
            style={{ borderTop: i === 0 ? "none" : "1px solid var(--color-hairline)" }}
          >
            <span style={{ color: "var(--color-ink-mute)" }}>{r.label}</span>
            <span className="tabular-nums" style={{ color: "var(--color-ink)" }}>{r.value}</span>
          </div>
        ))}
        <div
          className="flex items-center justify-between gap-3 px-4 py-2.5 border-t"
          style={{ background: "var(--color-canvas-soft)", borderColor: "var(--color-hairline)" }}
        >
          <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
            Remaining
          </span>
          <span
            className="text-base font-medium tabular-nums"
            style={{ color: "var(--color-primary)" }}
          >
            {money2(row.remaining)}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="pay_amount"
          className="text-xs uppercase tracking-wide"
          style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
        >
          {kind === "advance" ? "Advance amount (₹)" : "Amount to pay (₹)"}
        </label>
        <Input
          id="pay_amount"
          name="amount"
          type="number"
          min="0.01"
          step="0.01"
          max={row.remaining}
          required
          autoFocus
          placeholder="0.00"
          // A final payment almost always clears the balance, so offer it. An
          // advance is by nature a part payment, so don't presume the amount.
          defaultValue={kind === "salary" ? row.remaining.toFixed(2) : ""}
        />
        <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          At most {money2(row.remaining)} — the rest of this month&apos;s salary.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span
          className="text-xs uppercase tracking-wide"
          style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
        >
          Paid by
        </span>
        <div className="flex gap-2">
          {(["cash", "online"] as PayMethod[]).map((m) => {
            const active = method === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className="flex-1 text-sm px-3 py-2 rounded-lg border transition-colors"
                style={{
                  borderColor: active ? "var(--color-primary)" : "var(--color-hairline)",
                  background: active ? "var(--color-primary)" : "var(--color-canvas)",
                  color: active ? "#fff" : "var(--color-ink)",
                }}
              >
                {PAY_METHOD_LABEL[m]}
              </button>
            );
          })}
        </div>
        <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          This comes straight out of your {method === "cash" ? "cash" : "bank"} balance on the
          Finance sheet.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="pay_notes"
          className="text-xs uppercase tracking-wide"
          style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
        >
          Note (optional)
        </label>
        <Input id="pay_notes" name="notes" placeholder="e.g. paid at the counter" autoComplete="off" />
      </div>

      {state?.error && (
        <p
          className="text-sm rounded-md px-3 py-2"
          style={{ color: "var(--color-ruby)", background: "var(--color-danger-bg)" }}
        >
          {state.error}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={pending}>
        {pending
          ? "Recording…"
          : kind === "advance"
            ? "Record advance"
            : "Record salary payment"}
      </Button>
    </form>
  );
}

// ── Payroll history, in place ─────────────────────────────────────────────────
// Expands under the row rather than opening a page: the admin is comparing this
// month against the last few, and a navigation would take the comparison away.
// Fetched only when opened — a restaurant with 40 staff must not load 40 people's
// payment history to render a list.

function History({ staffId }: { staffId: string }) {
  const [months, setMonths] = useState<PayrollHistoryMonth[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    getPayrollHistory(staffId)
      .then((m) => { if (live) setMonths(m); })
      .catch(() => { if (live) setMonths([]); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [staffId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6" style={{ color: "var(--color-ink-mute)" }}>
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (!months || months.length === 0) {
    return (
      <p className="px-4 py-4 text-sm" style={{ color: "var(--color-ink-mute)" }}>
        No payroll history yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      {months.map((m) => (
        <div key={m.month} style={{ borderTop: "1px solid var(--color-hairline)" }}>
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 flex-wrap">
            <span className="flex items-center gap-2 min-w-0">
              <span className="text-sm" style={{ color: "var(--color-ink)" }}>
                {monthLabel(m.month)}
              </span>
              <StatusPill status={m.status} />
            </span>
            <span className="text-xs tabular-nums" style={{ color: "var(--color-ink-mute)" }}>
              {m.monthly_salary == null ? (
                "No salary set"
              ) : (
                <>
                  Salary {money(m.monthly_salary)} · Paid{" "}
                  <span style={{ color: "var(--color-ink)" }}>{money(m.totalPaid)}</span>
                  {m.remaining > 0.005 && (
                    <>
                      {" "}
                      · Remaining{" "}
                      <span style={{ color: PAYROLL_STATUS_COLOR.partial }}>
                        {money(m.remaining)}
                      </span>
                    </>
                  )}
                </>
              )}
            </span>
          </div>

          {/* Advances and the final payment, each with when, how and who. */}
          {m.payments.length > 0 && (
            <div className="px-4 pb-2.5 flex flex-col gap-1">
              {m.payments.map((p) => (
                <div
                  key={p.id}
                  className="flex items-baseline justify-between gap-3 text-xs px-3 py-1.5 rounded-lg"
                  style={{ background: "var(--color-canvas-soft)" }}
                >
                  <span className="min-w-0">
                    <span style={{ color: "var(--color-ink)" }}>
                      {PAYMENT_KIND_LABEL[p.kind]}
                    </span>
                    <span style={{ color: "var(--color-ink-mute)" }}>
                      {" · "}
                      {when(p.created_at)}
                      {" · "}
                      {PAY_METHOD_LABEL[p.method]}
                      {p.paid_by_name && ` · by ${p.paid_by_name}`}
                    </span>
                    {p.notes && (
                      <span className="block truncate" style={{ color: "var(--color-ink-mute)" }}>
                        {p.notes}
                      </span>
                    )}
                  </span>
                  <span
                    className="tabular-nums shrink-0"
                    style={{ color: p.kind === "advance" ? PAYROLL_STATUS_COLOR.partial : "var(--color-ink)" }}
                  >
                    {money2(p.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── One staff member on the payroll sheet ─────────────────────────────────────

function PayrollLine({
  row,
  month,
  canManage,
  expanded,
  onToggle,
  onPay,
  onSetSalary,
}: {
  row: PayrollRow;
  month: string;
  canManage: boolean;
  expanded: boolean;
  onToggle: () => void;
  onPay: (kind: PaymentKind) => void;
  onSetSalary: () => void;
}) {
  const noSalary = row.monthly_salary == null;
  const settled = row.remaining <= 0.005;

  return (
    <div style={{ borderTop: "1px solid var(--color-hairline)" }}>
      <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
        {/* The whole row toggles the history — the brief's "clicking a staff
            member expands". The buttons beside it stopPropagation. */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
        >
          <ChevronDown
            size={14}
            className="shrink-0 transition-transform"
            style={{
              color: "var(--color-ink-mute)",
              transform: expanded ? "none" : "rotate(-90deg)",
            }}
          />
          <span className="min-w-0">
            <span className="flex items-center gap-2 flex-wrap">
              <span
                className="text-sm truncate"
                style={{ color: "var(--color-ink)", opacity: row.is_active ? 1 : 0.55 }}
              >
                {row.display_name}
              </span>
              {!noSalary && <StatusPill status={row.status} />}
              {!row.is_active && (
                <span className="text-[11px]" style={{ color: "var(--color-ink-mute)" }}>
                  Inactive
                </span>
              )}
            </span>
            <span className="block text-xs truncate" style={{ color: "var(--color-ink-mute)" }}>
              {row.title ? `${row.title} · ` : ""}
              Joined {day(row.joining_date)}
            </span>
          </span>
        </button>

        {/* Salary → advance → paid → remaining, in the order the money moves. */}
        <div className="flex items-center gap-4 sm:gap-6 shrink-0 ml-6 sm:ml-0">
          {noSalary ? (
            <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
              No salary set for {monthLabel(month)}
            </span>
          ) : (
            <>
              <span className="text-right">
                <span className="block text-[10px]" style={{ color: "var(--color-ink-mute)" }}>
                  Salary
                </span>
                <span className="block text-sm tabular-nums" style={{ color: "var(--color-ink)" }}>
                  {money(row.monthly_salary ?? 0)}
                </span>
              </span>
              <span className="text-right hidden sm:block">
                <span className="block text-[10px]" style={{ color: "var(--color-ink-mute)" }}>
                  Advance
                </span>
                <span
                  className="block text-sm tabular-nums"
                  style={{
                    color: row.advancePaid > 0
                      ? PAYROLL_STATUS_COLOR.partial
                      : "var(--color-ink-mute)",
                  }}
                >
                  {row.advancePaid > 0 ? money(row.advancePaid) : "—"}
                </span>
              </span>
              <span className="text-right">
                <span className="block text-[10px]" style={{ color: "var(--color-ink-mute)" }}>
                  Paid
                </span>
                <span
                  className="block text-sm tabular-nums"
                  style={{
                    color: row.totalPaid > 0
                      ? PAYROLL_STATUS_COLOR.paid
                      : "var(--color-ink-mute)",
                  }}
                >
                  {row.totalPaid > 0 ? money(row.totalPaid) : "—"}
                </span>
              </span>
              <span className="text-right">
                <span className="block text-[10px]" style={{ color: "var(--color-ink-mute)" }}>
                  Remaining
                </span>
                <span
                  className="block text-sm tabular-nums font-medium"
                  style={{ color: settled ? PAYROLL_STATUS_COLOR.paid : "var(--color-ink)" }}
                >
                  {money(row.remaining)}
                </span>
              </span>
            </>
          )}
        </div>

        {canManage && (
          <div className="flex items-center gap-1.5 shrink-0 ml-auto sm:ml-0">
            {noSalary ? (
              <Button variant="secondary" size="sm" onClick={onSetSalary}>
                Set salary
              </Button>
            ) : (
              <>
                {!settled && (
                  <>
                    <Button variant="secondary" size="sm" onClick={() => onPay("advance")}>
                      Advance
                    </Button>
                    <Button variant="primary" size="sm" onClick={() => onPay("salary")}>
                      Pay
                    </Button>
                  </>
                )}
                <button
                  type="button"
                  onClick={onSetSalary}
                  className="text-xs px-2 py-1 rounded-lg"
                  style={{ color: "var(--color-ink-mute)" }}
                >
                  Edit
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {expanded && (
        <div style={{ background: "var(--color-canvas-soft)" }}>
          <History staffId={row.staff_id} />
        </div>
      )}
    </div>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export function PayrollClient({
  initial,
  canManage,
}: {
  initial: PayrollSheet;
  canManage: boolean;
}) {
  const [sheet, setSheet] = useState(initial);
  const [month, setMonth] = useState(initial.month);
  const [loading, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<string | null>(null);

  // Which modal is open, and for whom.
  const [paying, setPaying] = useState<{ row: PayrollRow; kind: PaymentKind } | null>(null);
  const [editing, setEditing] = useState<{
    staffId: string;
    name: string;
    salary: number | null;
    joining: string | null;
  } | null>(null);

  const load = useCallback((m: string) => {
    startTransition(async () => {
      try {
        setSheet(await getPayrollSheet(m));
      } catch {
        // keep the last known sheet on a transient failure
      }
    });
  }, []);

  const go = (by: number) => {
    // Never past the month we're in: you cannot pay a salary that hasn't accrued.
    const next = shiftMonth(month, by);
    if (by > 0 && next > initial.month && isCurrentMonth(month)) return;
    setMonth(next);
    setExpanded(null);
    load(next);
  };

  const refresh = useCallback(() => load(month), [load, month]);
  useRealtime(["payroll"], refresh);

  const atCurrentMonth = isCurrentMonth(month);

  return (
    <section className="mt-10">
      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <div>
          <h2
            className="text-lg flex items-center gap-2"
            style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.3px" }}
          >
            <Wallet size={16} strokeWidth={1.5} style={{ color: "var(--color-ink-mute)" }} />
            Payroll
          </h2>
          <p className="text-sm mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
            Salaries, advances and payments. Every payment posts straight to Finance.
            {loading && <span className="ml-2">Updating…</span>}
          </p>
        </div>

        {/* Month stepper. Forward stops at the current month. */}
        <div
          className="flex items-center gap-1 rounded-full border px-1 py-0.5 shrink-0"
          style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
        >
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous month"
            className="w-7 h-7 rounded-full flex items-center justify-center"
            style={{ color: "var(--color-ink-mute)" }}
          >
            <ChevronLeft size={15} />
          </button>
          <span
            className="text-sm px-2 min-w-[104px] text-center"
            style={{ color: "var(--color-ink)" }}
          >
            {monthLabel(month)}
          </span>
          <button
            type="button"
            onClick={() => go(1)}
            disabled={atCurrentMonth}
            aria-label="Next month"
            className="w-7 h-7 rounded-full flex items-center justify-center disabled:opacity-30"
            style={{ color: "var(--color-ink-mute)" }}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      {/* Where the month stands, before any names. */}
      <div
        className="grid gap-3 my-4"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}
      >
        {[
          { label: "Total salary", value: sheet.totalSalary, tone: "var(--color-ink)" },
          { label: "Advances", value: sheet.totalAdvance, tone: PAYROLL_STATUS_COLOR.partial },
          { label: "Total paid", value: sheet.totalPaid, tone: PAYROLL_STATUS_COLOR.paid },
          { label: "Remaining", value: sheet.totalRemaining, tone: PAYROLL_STATUS_COLOR.unpaid },
        ].map((c) => (
          <div
            key={c.label}
            className="rounded-xl border px-4 py-3"
            style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
          >
            <p className="text-xs mb-1" style={{ color: "var(--color-ink-mute)" }}>{c.label}</p>
            <p className="text-lg font-medium tabular-nums" style={{ color: c.tone }}>
              {money(c.value)}
            </p>
          </div>
        ))}
      </div>

      <div
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
            {monthLabel(month)}
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
            Select a staff member to see their payroll history
          </p>
        </div>

        {sheet.rows.length === 0 ? (
          <p className="px-4 py-6 text-sm" style={{ color: "var(--color-ink-mute)" }}>
            Nobody is on payroll for {monthLabel(month)} yet.
            {canManage && " Set a salary below to start."}
          </p>
        ) : (
          sheet.rows.map((r) => (
            <PayrollLine
              key={r.staff_id}
              row={r}
              month={month}
              canManage={canManage}
              expanded={expanded === r.staff_id}
              onToggle={() => setExpanded(expanded === r.staff_id ? null : r.staff_id)}
              onPay={(kind) => setPaying({ row: r, kind })}
              onSetSalary={() =>
                setEditing({
                  staffId: r.staff_id,
                  name: r.display_name,
                  salary: r.monthly_salary,
                  joining: r.joining_date,
                })
              }
            />
          ))
        )}
      </div>

      {/* Staff the Super Admin has created who have no salary yet. Listed rather
          than hidden: an employee silently missing from payroll is the failure
          mode this section exists to prevent. */}
      {canManage && sheet.notOnPayroll.length > 0 && (
        <div
          className="rounded-xl border overflow-hidden mt-4"
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
              Not on payroll
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
              {sheet.notOnPayroll.length} staff member
              {sheet.notOnPayroll.length !== 1 ? "s" : ""} with no salary set
            </p>
          </div>
          {sheet.notOnPayroll.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-3 px-4 py-2.5"
              style={{ borderTop: "1px solid var(--color-hairline)" }}
            >
              <span className="min-w-0">
                <span className="block text-sm truncate" style={{ color: "var(--color-ink)" }}>
                  {s.display_name}
                </span>
                {s.title && (
                  <span className="block text-xs truncate" style={{ color: "var(--color-ink-mute)" }}>
                    {s.title}
                  </span>
                )}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  setEditing({ staffId: s.id, name: s.display_name, salary: null, joining: null })
                }
              >
                Set salary
              </Button>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={!!paying}
        onClose={() => setPaying(null)}
        title={paying?.kind === "advance" ? "Pay a salary advance" : "Pay salary"}
        subtitle={paying ? `${paying.row.display_name} · ${monthLabel(month)}` : undefined}
      >
        {paying && (
          <PaymentForm
            row={paying.row}
            month={month}
            kind={paying.kind}
            onDone={() => { setPaying(null); refresh(); }}
          />
        )}
      </Modal>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.salary == null ? "Set salary" : "Update salary"}
        subtitle={editing?.name}
      >
        {editing && (
          <SalaryForm
            staffId={editing.staffId}
            staffName={editing.name}
            currentSalary={editing.salary}
            joiningDate={editing.joining}
            month={month}
            onDone={() => { setEditing(null); refresh(); }}
          />
        )}
      </Modal>
    </section>
  );
}
