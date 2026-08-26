"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ShieldCheck, ShieldX, ShieldAlert, Clock } from "lucide-react";
import type { SecurityAuditRow } from "@/lib/security/authorize";
import { getSecurityAuditLog } from "@/app/actions/security";
import { PeriodFilter } from "@/components/ui/period-filter";
import type { HistoryPeriod } from "@/lib/history-period";

// Read-only "Security activity" log for the owner: every attempt to edit a money record —
// success, a wrong-PIN failure, or a PIN-was-right-but-refused block. The PIN itself never
// appears here (it never leaves the DB). Newest first.

const OP_LABEL: Record<string, string> = {
  edit_payment_tender: "Edited payment tender",
  edit_purchase: "Edited purchase",
  set_opening_balance: "Set opening balance",
};

const OUTCOME = {
  success: { label: "Success", color: "var(--color-success)", bg: "var(--color-success-bg)", Icon: ShieldCheck },
  failure: { label: "Wrong PIN", color: "var(--color-ruby)", bg: "var(--color-ruby-bg, color-mix(in srgb, var(--color-ruby) 12%, transparent))", Icon: ShieldX },
  blocked: { label: "Blocked", color: "var(--color-amber, #b45309)", bg: "color-mix(in srgb, var(--color-amber, #b45309) 12%, transparent)", Icon: ShieldAlert },
} as const;

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

const money = (n: unknown) =>
  n == null || Number.isNaN(Number(n)) ? "—" : `Rs ${Number(n).toLocaleString()}`;

// A compact one-line "what changed" for a successful edit. Best-effort: unknown shapes
// simply render nothing rather than breaking the row.
function changeSummary(row: SecurityAuditRow): string | null {
  if (row.outcome !== "success" || !row.detail?.after) return null;
  // Every operation except the FIRST opening-balance set always has a `before` —
  // there is no prior balance to compare against the very first time one is seeded.
  if (!row.detail?.before && row.operation !== "set_opening_balance") return null;
  const b = row.detail.before, a = row.detail.after;
  if (row.operation === "edit_payment_tender") {
    return `${b.payment_method} → ${a.payment_method}  ·  cash ${money(b.cash_amount)}→${money(a.cash_amount)}, online ${money(b.online_amount)}→${money(a.online_amount)}, card ${money(b.card_amount)}→${money(a.card_amount)}`;
  }
  if (row.operation === "edit_purchase") {
    const parts: string[] = [];
    if (String(b.total_amount) !== String(a.total_amount)) parts.push(`total ${money(b.total_amount)}→${money(a.total_amount)}`);
    if (b.payment_method !== a.payment_method) parts.push(`${b.payment_method}→${a.payment_method}`);
    if (String(b.vendor_id) !== String(a.vendor_id)) parts.push("vendor changed");
    parts.push("items updated");
    return parts.join("  ·  ");
  }
  if (row.operation === "set_opening_balance") {
    const beforeLabel = b ? `cash ${money(b.cash)}, online ${money(b.online)} (from ${b.effective_from ?? "—"})` : "not set";
    return `${beforeLabel} → cash ${money(a.cash)}, online ${money(a.online)} (from ${a.effective_from})`;
  }
  return null;
}

export function SecurityActivityClient({ rows: initialRows }: { rows: SecurityAuditRow[] }) {
  const [period, setPeriod] = useState<HistoryPeriod>("today");
  const [date, setDate] = useState("");
  const [rows, setRows] = useState(initialRows);
  const [pending, startTransition] = useTransition();

  // Skip the redundant fetch on first mount — the server already sent "today".
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    startTransition(async () => setRows(await getSecurityAuditLog(period, date || null)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, date]);

  return (
    <div
      className="rounded-xl border px-5 py-5 max-w-3xl"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
    >
      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <p className="text-sm font-medium flex items-center gap-2" style={{ color: "var(--color-ink)" }}>
          <Clock size={15} /> Security activity
        </p>
        <PeriodFilter value={period} onChange={setPeriod} date={date} onDateChange={setDate} />
      </div>
      <p className="text-xs mb-4" style={{ color: "var(--color-ink-mute)" }}>
        Every attempt to edit a completed payment or purchase — including wrong-PIN attempts.
      </p>

      {pending ? (
        <p className="text-sm py-3" style={{ color: "var(--color-ink-mute)" }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm py-3" style={{ color: "var(--color-ink-mute)" }}>
          No security activity yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y" style={{ borderColor: "var(--color-hairline)" }}>
          {rows.map((r) => {
            const o = OUTCOME[r.outcome] ?? OUTCOME.blocked;
            const change = changeSummary(r);
            return (
              <li key={r.id} className="py-3 flex items-start gap-3">
                <span
                  className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs shrink-0 mt-0.5"
                  style={{ color: o.color, background: o.bg }}
                >
                  <o.Icon size={12} /> {o.label}
                </span>
                <div className="min-w-0">
                  <p className="text-sm" style={{ color: "var(--color-ink)" }}>
                    {OP_LABEL[r.operation] ?? r.operation}
                    {r.actorName ? <span style={{ color: "var(--color-ink-mute)" }}> · {r.actorName}</span> : null}
                  </p>
                  {change && (
                    <p className="text-xs mt-0.5 break-words" style={{ color: "var(--color-ink-mute)" }}>{change}</p>
                  )}
                  <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>{fmtTime(r.createdAt)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
