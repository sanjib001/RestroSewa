"use client";

import { useActionState, useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  exportFinanceCsv,
  getFinanceReport,
  getFinanceTransactions,
  getOpeningBalance,
  getPeriodPurchases,
  setOpeningBalance,
} from "@/app/actions/finance";
import type { ActionResult, OpeningBalance } from "@/app/actions/finance";
import { addExtraIncome, listExtraIncome } from "@/app/actions/income";
import type { ExtraIncome } from "@/app/actions/income";
import { updateExtraIncome, removeExtraIncome } from "@/app/actions/security";
import { getPayrollSummary } from "@/app/actions/payroll";
import {
  PERIOD_LABEL,
  PURCHASE_STATUS_COLOR,
  PURCHASE_STATUS_LABEL,
  txLabel,
  txFlow,
  txTone,
} from "@/lib/finance";
import type {
  FinancePeriod,
  FinancePurchase,
  FinanceReport,
  FinanceTransaction,
} from "@/lib/finance";
import type { PayrollSummary } from "@/lib/payroll";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "../../_components/modal";
import { SecurityPinDialog } from "@/components/security-pin-dialog";
import { PaymentMethodPicker, splitIsValid } from "@/components/ui/payment-method-picker";
import { Plus, Settings2, TriangleAlert, UserPlus, Pencil, X } from "lucide-react";
import { ImportCreditForm } from "./import-credit-form";
import { formatDateTime } from "@/lib/format-time";

const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const money2 = (n: number) =>
  `${n < 0 ? "−" : ""}₹${Math.abs(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const PERIODS: FinancePeriod[] = ["today", "yesterday", "week", "month", "year"];

// Covers purchase methods and the ledger's derived ones ("partial" = part
// tendered part credit, "mixed" = cash and bank on the same bill).
const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  online: "Online",
  card: "Card",
  credit: "Credit",
  partial: "Part paid / part credit",
  mixed: "Cash + online",
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
  // `sub` indents a row beneath the one above it, for a breakdown that explains a
  // figure rather than adding to the section's own total.
  rows: { label: string; value: number; hint?: string; tone?: string; display?: string; sub?: boolean }[];
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
          className={
            "flex items-baseline justify-between gap-3 px-4 " + (r.sub ? "py-1.5" : "py-2.5")
          }
          // A sub-row explains the row above it, so it gets no rule of its own —
          // otherwise a four-category breakdown reads as four more expenses.
          style={{ borderTop: i === 0 || r.sub ? "none" : "1px solid var(--color-hairline)" }}
        >
          <span
            // min-w-0 is load-bearing: a flex child holding text defaults to
            // min-width:auto, so on a narrow phone a long hint (e.g. "Paid by
            // advance — cash") pushes the row wider than the card instead of
            // wrapping — silently clipped by the section's own overflow-hidden.
            className={(r.sub ? "text-xs pl-4" : "text-sm") + " min-w-0"}
            style={{ color: "var(--color-ink-mute)", opacity: r.sub ? 0.8 : 1 }}
          >
            {r.label}
            {r.hint && (
              <span className="block text-xs" style={{ color: "var(--color-ink-mute)", opacity: 0.75 }}>
                {r.hint}
              </span>
            )}
          </span>
          <span
            className={(r.sub ? "text-xs" : "text-sm") + " tabular-nums shrink-0"}
            style={{ color: r.tone ?? "var(--color-ink)", opacity: r.sub ? 0.8 : 1 }}
          >
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

// ── Transaction history ───────────────────────────────────────────────────────

/**
 * One movement, and what it did to the balances.
 *
 * Only the buckets a transaction actually touched are shown. A cash sale prints
 * one "Cash 1,200 → 2,200" line; a credit repayment prints two, because it moves
 * money in AND writes the receivable down — which is exactly the thing the old
 * report could not show.
 */
function LedgerRow({ t, showRooms }: { t: FinanceTransaction; showRooms: boolean }) {
  // Shared with the CSV export, so the two cannot name the same row differently.
  // It also distinguishes a refund from the deposit it reverses, and a saving
  // withdrawal from the saving it takes back — see `txLabel`.
  const label = txLabel(t, showRooms);
  // "Room 203 · Ram Bahadur" — the place first, then whoever the bill belongs to.
  // `party` is untouched by the migration, so a credit sale keeps its customer.
  const who = [t.sourceLabel, t.party].filter(Boolean).join(" · ");
  // Direction comes from what the row DID, never from what it is called. See
  // `txFlow` — a refund and a withdrawal both invert their kind's usual meaning.
  const flow = txFlow(t);
  const tone = txTone(flow);
  const moved = Math.abs(flow) > 0.005;
  // The headline is the money that actually changed hands, so its sign is always
  // truthful. Where the transaction is WORTH more than what moved — a part-cash
  // part-credit bill — the full value is printed beside it rather than dropped,
  // because "-3,000 of 5,000" is the honest reading and "-5,000" is not.
  const face = Math.abs(t.amount);
  const differs = moved && Math.abs(Math.abs(flow) - face) > 0.005;
  const when = new Date(t.at);

  const legs: { label: string; before: number; after: number; delta: number }[] = [];
  const leg = (label: string, delta: number, after: number) => {
    // 0.005 keeps a rounding crumb from printing an untouched bucket.
    if (Math.abs(delta) > 0.005) legs.push({ label, before: after - delta, after, delta });
  };
  leg("Cash", t.cashDelta, t.cashAfter);
  leg("Online", t.onlineDelta, t.onlineAfter);
  leg("Credit to us", t.creditToUsDelta, t.creditToUsAfter);
  leg("Credit by us", t.creditByUsDelta, t.creditByUsAfter);

  return (
    <div className="px-4 py-3" style={{ borderTop: "1px solid var(--color-hairline)" }}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-sm" style={{ color: "var(--color-ink)" }}>
            {label}
            {who && <span style={{ color: "var(--color-ink-mute)" }}> · {who}</span>}
          </span>
          <span className="block text-xs" style={{ color: "var(--color-ink-mute)" }}>
            {when.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}{" "}
            {when.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
            {" · "}
            {METHOD_LABEL[t.method] ?? t.method}
            {t.reference && <span> · {t.reference}</span>}
          </span>
        </span>
        <span className="text-sm tabular-nums shrink-0 text-right">
          <span style={{ color: tone }}>
            {moved
              ? `${flow > 0 ? "+" : "−"}${money2(Math.abs(flow))}`
              : money2(face)}
          </span>
          {differs && (
            <span className="block text-xs" style={{ color: "var(--color-ink-mute)" }}>
              of {money2(face)}
            </span>
          )}
          {!moved && (
            <span className="block text-xs" style={{ color: "var(--color-ink-mute)" }}>
              no money moved
            </span>
          )}
        </span>
      </div>

      {legs.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
          {legs.map((l) => (
            <span key={l.label} className="text-xs tabular-nums" style={{ color: "var(--color-ink-mute)" }}>
              {l.label}{" "}
              <span style={{ opacity: 0.8 }}>{money2(l.before)}</span>
              {" → "}
              <span style={{ color: "var(--color-ink)" }}>{money2(l.after)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function LedgerSection({
  rows,
  periodLabel,
  showRooms,
}: {
  rows: FinanceTransaction[];
  periodLabel: string;
  showRooms: boolean;
}) {
  // A busy month can run to thousands of movements; rendering them all would
  // stall the page for a number nobody reads to the end of.
  const [limit, setLimit] = useState(40);
  const shown = rows.slice(0, limit);

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
          Transaction history · {periodLabel}
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
          {rows.length === 0
            ? "No money moved in this period"
            : `${rows.length} movement${rows.length !== 1 ? "s" : ""} — newest first, with the balance after each`}
        </p>
      </div>

      {shown.map((t, i) => (
        <LedgerRow key={`${t.at}-${t.kind}-${t.reference ?? i}`} t={t} showRooms={showRooms} />
      ))}

      {rows.length > shown.length && (
        <button
          type="button"
          onClick={() => setLimit((n) => n + 100)}
          className="w-full text-sm px-4 py-3"
          style={{
            borderTop: "1px solid var(--color-hairline)",
            background: "var(--color-canvas-soft)",
            color: "var(--color-primary)",
          }}
        >
          Show more · {rows.length - shown.length} remaining
        </button>
      )}
    </section>
  );
}

// ── Opening balance ───────────────────────────────────────────────────────────

function OpeningForm({ current, onDone }: { current: OpeningBalance; onDone: () => void }) {
  const defaultDate = current
    ? new Date(current.effective_from).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const [cash, setCash] = useState(current?.cash != null ? String(current.cash) : "");
  const [online, setOnline] = useState(current?.online != null ? String(current.online) : "");
  const [date, setDate] = useState(defaultDate);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const cashNum = cash === "" ? 0 : parseFloat(cash);
  const onlineNum = online === "" ? 0 : parseFloat(online);

  const validate = () => {
    if (isNaN(cashNum) || cashNum < 0) return "Cash on hand must be zero or more.";
    if (isNaN(onlineNum) || onlineNum < 0) return "Bank balance must be zero or more.";
    if (!date) return "Choose the date your books start from.";
    return null;
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const err = validate();
        setFormError(err);
        if (!err) setConfirming(true);
      }}
      className="flex flex-col gap-3"
    >
      <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
        The money you had before the system started tracking it. Set this once — every day
        after it carries forward automatically, so you never type a balance again.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="f_cash" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
            Cash in hand (₹)
          </label>
          <Input id="f_cash" type="number" min="0" step="0.01" placeholder="0.00" value={cash} onChange={(e) => setCash(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="f_online" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
            Bank / online (₹)
          </label>
          <Input id="f_online" type="number" min="0" step="0.01" placeholder="0.00" value={online} onChange={(e) => setOnline(e.target.value)} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="f_date" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
          Books start from
        </label>
        <input
          id="f_date"
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
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
          style={{ background: "var(--color-warning-bg)", borderColor: "color-mix(in srgb, var(--color-warning) 27%, transparent)" }}
        >
          <TriangleAlert size={14} className="mt-0.5 shrink-0" style={{ color: "var(--color-warning)" }} />
          <p className="text-xs" style={{ color: "var(--color-warning)" }}>
            Changing this re-bases every balance from the new start date. Only adjust it if the
            original figures were wrong.
          </p>
        </div>
      )}

      {formError && (
        <p className="text-sm rounded-md px-3 py-2" style={{ color: "var(--color-ruby)", background: "var(--color-danger-bg)" }}>
          {formError}
        </p>
      )}

      <Button type="submit" variant="primary">
        {current ? "Update opening balance" : "Set opening balance"}
      </Button>

      <SecurityPinDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onSuccess={() => {
          setConfirming(false);
          onDone();
        }}
        title={current ? "Update opening balance" : "Set opening balance"}
        description="Every later day's balance is carried forward from this figure — confirm with your Security PIN."
        confirmLabel={current ? "Update" : "Set"}
        onConfirm={(pin) => setOpeningBalance(pin, { cash: cashNum, online: onlineNum, effective_from: date })}
      />
    </form>
  );
}

// ── Extra income ────────────────────────────────────────────────────────────────

type IncomeMethod = "cash" | "online" | "card" | "mixed";

function AddIncomeForm({ onDone }: { onDone: () => void }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(addExtraIncome, null);
  const [method, setMethod] = useState<IncomeMethod>("cash");
  const [amount, setAmount] = useState("");
  const [cash, setCash] = useState("");
  const [online, setOnline] = useState("");

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !state?.error) onDone();
    wasPending.current = pending;
  }, [pending, state, onDone]);

  const amountNum = parseFloat(amount) || 0;
  const mixedOk = method !== "mixed" || amountNum === 0 || splitIsValid("mixed", amountNum, cash, online);
  const valid = amountNum > 0 && mixedOk;

  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="i_desc" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
          Description / reason
        </label>
        <Input id="i_desc" name="description" placeholder="e.g. Miscellaneous income" required maxLength={200} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="i_amount" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
          Amount (₹)
        </label>
        <Input
          id="i_amount"
          name="amount"
          type="number"
          min="0.01"
          step="0.01"
          placeholder="0.00"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setCash("");
            setOnline("");
          }}
          required
        />
      </div>

      <input type="hidden" name="method" value={method} />
      <input type="hidden" name="cash_amount" value={method === "mixed" ? cash : ""} />
      <input type="hidden" name="online_amount" value={method === "mixed" ? online : ""} />

      <PaymentMethodPicker
        methods={["cash", "online", "card", "mixed"]}
        value={method}
        onChange={(m) => {
          setMethod(m as IncomeMethod);
          setCash("");
          setOnline("");
        }}
        total={amountNum}
        cash={cash}
        online={online}
        onSplitChange={(s) => {
          setCash(s.cash);
          setOnline(s.online);
        }}
        mixedLabel="Cash + Online"
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="i_when" className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
          Date &amp; time
        </label>
        <input
          id="i_when"
          name="occurred_at"
          type="datetime-local"
          defaultValue={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
          className="w-full text-sm rounded-lg border px-3 py-2"
          style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline-input)", color: "var(--color-ink)" }}
        />
        <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          Defaults to now. Change it to log income received earlier.
        </p>
      </div>

      {state?.error && (
        <p className="text-sm rounded-md px-3 py-2" style={{ color: "var(--color-ruby)", background: "var(--color-danger-bg)" }}>
          {state.error}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={pending || !valid}>
        {pending ? "Saving…" : "Add income"}
      </Button>
    </form>
  );
}

/**
 * One recorded entry, with the SAME correction lane every other settled financial
 * row in this app uses: admin-only, Security-PIN-gated edit/delete
 * (updateExtraIncome/removeExtraIncome), audit-logged server-side. Not a fresh
 * design — it is `EditAdvanceButton`/`RemoveAdvanceButton` from the room folio,
 * re-shaped for a flat amount instead of a room stay's advance.
 */
function IncomeRow({ entry, canManage, onChanged }: { entry: ExtraIncome; canManage: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);

  const [description, setDescription] = useState(entry.description);
  const [amount, setAmount] = useState(String(entry.amount));
  const [method, setMethod] = useState<IncomeMethod>((entry.method as IncomeMethod) || "cash");
  const [cash, setCash] = useState(entry.method === "mixed" ? String(entry.cash) : "");
  const [online, setOnline] = useState(entry.method === "mixed" ? String(entry.online) : "");

  const [removePin, setRemovePin] = useState("");
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const amountNum = parseFloat(amount) || 0;
  const valid =
    description.trim().length > 0 &&
    amountNum > 0 &&
    (method !== "mixed" || splitIsValid("mixed", amountNum, cash, online));

  const openEdit = () => {
    setDescription(entry.description);
    setAmount(String(entry.amount));
    setMethod((entry.method as IncomeMethod) || "cash");
    setCash(entry.method === "mixed" ? String(entry.cash) : "");
    setOnline(entry.method === "mixed" ? String(entry.online) : "");
    setEditing(true);
  };

  const resolvedSplit = () => {
    if (method === "cash") return { cash: amountNum, online: 0, card: 0 };
    if (method === "online") return { cash: 0, online: amountNum, card: 0 };
    if (method === "card") return { cash: 0, online: 0, card: amountNum };
    return { cash: parseFloat(cash) || 0, online: parseFloat(online) || 0, card: 0 };
  };

  return (
    <div
      className="flex items-center gap-2 px-4 py-2.5 border-t"
      style={{ borderColor: "var(--color-hairline)" }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate" style={{ color: "var(--color-ink)" }}>
          {entry.description}
          <span className="text-xs ml-1.5" style={{ color: "var(--color-ink-mute)" }}>
            {METHOD_LABEL[entry.method] ?? entry.method}
          </span>
        </p>
        <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          {formatDateTime(entry.createdAt)}
          {entry.createdByName ? ` · ${entry.createdByName}` : ""}
          {entry.updatedAt ? " · corrected" : ""}
        </p>
      </div>
      <span className="text-sm tabular-nums" style={{ color: "var(--color-ink)" }}>
        {money2(entry.amount)}
      </span>
      {canManage && (
        <div className="flex items-center gap-1.5 shrink-0">
          <button type="button" onClick={openEdit} aria-label="Edit this income entry" style={{ color: "var(--color-ink-mute)" }}>
            <Pencil size={13} />
          </button>
          {removing ? (
            <div className="flex items-center gap-1.5">
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                placeholder="PIN"
                value={removePin}
                onChange={(e) => setRemovePin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                className="h-8 w-16 rounded-sm border px-2 text-xs text-right tracking-[0.3em]"
                style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
              />
              <button
                type="button"
                disabled={removeBusy || removePin.length !== 4}
                onClick={async () => {
                  setRemoveBusy(true);
                  const res = await removeExtraIncome(removePin, entry.id);
                  if (res && "error" in res) {
                    setRemoveError(res.error);
                    setRemovePin("");
                  } else {
                    setRemoving(false);
                    setRemovePin("");
                    setRemoveError(null);
                    onChanged();
                  }
                  setRemoveBusy(false);
                }}
                className="text-xs px-2 py-1 rounded-pill border"
                style={{ borderColor: "var(--color-ruby)", color: "var(--color-ruby)" }}
              >
                {removeBusy ? "…" : "Remove"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRemoving(false);
                  setRemovePin("");
                  setRemoveError(null);
                }}
                style={{ color: "var(--color-ink-mute)" }}
              >
                <X size={13} />
              </button>
              {removeError && (
                <span className="text-xs" style={{ color: "var(--color-ruby)" }}>{removeError}</span>
              )}
            </div>
          ) : (
            <button type="button" onClick={() => setRemoving(true)} aria-label="Remove this income entry" style={{ color: "var(--color-ink-mute)" }}>
              <X size={13} />
            </button>
          )}
        </div>
      )}

      <SecurityPinDialog
        open={editing}
        onClose={() => setEditing(false)}
        onSuccess={() => {
          setEditing(false);
          onChanged();
        }}
        title="Edit income entry"
        description="Correct the description, amount or how it was received."
        confirmLabel="Save"
        extraValid={valid}
        onConfirm={(pin) => {
          const s = resolvedSplit();
          return updateExtraIncome(pin, entry.id, {
            description: description.trim(),
            amount: amountNum,
            cash: s.cash,
            online: s.online,
            card: s.card,
            method,
          });
        }}
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
              Description
            </span>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
              Amount
            </span>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setCash("");
                setOnline("");
              }}
            />
          </label>
          <PaymentMethodPicker
            methods={["cash", "online", "card", "mixed"]}
            value={method}
            onChange={(m) => {
              setMethod(m as IncomeMethod);
              setCash("");
              setOnline("");
            }}
            total={amountNum}
            cash={cash}
            online={online}
            onSplitChange={(s) => {
              setCash(s.cash);
              setOnline(s.online);
            }}
            mixedLabel="Cash + Online"
          />
        </div>
      </SecurityPinDialog>
    </div>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export function FinanceClient({
  initial,
  initialOpening,
  initialPurchases,
  initialPayroll,
  initialLedger,
  initialIncome,
  canManage,
  showRooms = false,
}: {
  initial: FinanceReport;
  initialOpening: OpeningBalance;
  initialPurchases: FinancePurchase[];
  initialPayroll: PayrollSummary;
  initialLedger: FinanceTransaction[];
  initialIncome: ExtraIncome[];
  canManage: boolean;
  /** Hotel side of the sheet. False for a restaurant-only client, which has no rooms
   *  and so no room sales and no deposits — the blocks are not rendered at all. */
  showRooms?: boolean;
}) {
  const [report, setReport] = useState(initial);
  const [opening, setOpening] = useState(initialOpening);
  const [purchases, setPurchases] = useState(initialPurchases);
  const [payroll, setPayroll] = useState(initialPayroll);
  const [ledger, setLedger] = useState(initialLedger);
  const [income, setIncome] = useState(initialIncome);
  const [period, setPeriod] = useState<FinancePeriod>(initial.period);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [loading, startTransition] = useTransition();
  const [exporting, setExporting] = useState(false);
  const [settingOpening, setSettingOpening] = useState(false);
  const [importingCredit, setImportingCredit] = useState(false);
  const [addingIncome, setAddingIncome] = useState(false);

  const load = useCallback((p: FinancePeriod, from?: string, to?: string) => {
    startTransition(async () => {
      try {
        const args = { period: p, from: from ?? null, to: to ?? null };
        const [next, list, pay, tx, inc] = await Promise.all([
          getFinanceReport(args),
          getPeriodPurchases(args),
          getPayrollSummary(args),
          getFinanceTransactions(args),
          listExtraIncome(args),
        ]);
        setReport(next);
        setPurchases(list);
        setPayroll(pay);
        setLedger(tx);
        setIncome(inc);
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
    const args = { period, from: customFrom || null, to: customTo || null };
    // The ledger's running balances start from the opening figures, so re-seeding
    // moves every row in it — it has to come back too, or the history would
    // still be reconciling to the old opening balance.
    const [rep, op, tx] = await Promise.all([
      getFinanceReport(args),
      getOpeningBalance(),
      getFinanceTransactions(args),
    ]);
    setReport(rep);
    setOpening(op);
    setLedger(tx);
  }, [period, customFrom, customTo]);

  // Sales, purchases, credit, vendor payments and payroll all move these figures.
  const resync = useCallback(
    () => load(period, customFrom || undefined, customTo || undefined),
    [load, period, customFrom, customTo]
  );
  useRealtime(["billing", "credits", "purchases", "vendors", "finance", "payroll"], resync);

  const netMovement = report.closingNet - (report.openingCash + report.openingOnline);
  const periodLabel = PERIOD_LABEL[report.period];
  const netCredit = report.customerCreditOutstanding - report.vendorCreditOutstanding;

  // What was actually handed over, as opposed to what was billed on credit.
  const purchasesPaid = report.purchasesCash + report.purchasesOnline;
  // A "salary payment" on the Expenses list means the settlement, so the advances
  // are shown on their own line rather than counted twice.
  const salaryFinal = report.salaryTotal - report.salaryAdvance;
  const totalExpenses =
    purchasesPaid + report.vendorCreditPaid + report.salaryTotal + report.extraExpensesTotal;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <div>
          <h1 className="text-2xl" style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}>
            Daily Finance
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
            Showing <span style={{ color: "var(--color-ink)" }}>{periodLabel}</span>
            {loading && <span className="ml-2">Updating…</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canManage && (
            <Button variant="secondary" size="sm" onClick={() => setSettingOpening(true)}>
              <Settings2 size={14} /> Opening balance
            </Button>
          )}
          {canManage && (
            <Button variant="secondary" size="sm" onClick={() => setImportingCredit(true)}>
              <UserPlus size={14} /> Import credit
            </Button>
          )}
          {canManage && (
            <Button variant="secondary" size="sm" onClick={() => setAddingIncome(true)}>
              <Plus size={14} /> Add income
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
          style={{ background: "var(--color-warning-bg)", borderColor: "color-mix(in srgb, var(--color-warning) 27%, transparent)" }}
        >
          <TriangleAlert size={14} className="mt-0.5 shrink-0" style={{ color: "var(--color-warning)" }} />
          <p className="text-xs" style={{ color: "var(--color-warning)" }}>
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
        {/* The two credit positions sit alongside cash, not buried further down:
            an owner reading "Net balance ₹5,000" needs to see in the same glance
            that ₹20,000 is owed out. Colour separates asset from liability. */}
        <div className="rounded-xl border px-4 py-3" style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}>
          <p className="text-xs mb-1" style={{ color: "var(--color-ink-mute)" }}>Credit to us</p>
          <p className="text-lg font-medium tabular-nums" style={{ color: report.closingCreditToUs > 0 ? OWED_TO_US : "var(--color-ink)" }}>
            {money(report.closingCreditToUs)}
          </p>
          <p className="text-[10px]" style={{ color: "var(--color-ink-mute)" }}>Customers owe us</p>
        </div>
        <div className="rounded-xl border px-4 py-3" style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}>
          <p className="text-xs mb-1" style={{ color: "var(--color-ink-mute)" }}>Credit by us</p>
          <p className="text-lg font-medium tabular-nums" style={{ color: report.closingCreditByUs > 0 ? WE_OWE : "var(--color-ink)" }}>
            {money(report.closingCreditByUs)}
          </p>
          <p className="text-[10px]" style={{ color: "var(--color-ink-mute)" }}>We owe vendors</p>
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
        {/* Four components, not two. Cash and bank are money; the two credit
            lines are promises — shown on the same sheet because an owner needs
            both to know where they stand, but never added into the money total. */}
        <Section
          title="Opening balance"
          note="Carried forward from the previous period"
          rows={[
            { label: "Cash", value: report.openingCash },
            { label: "Online / bank", value: report.openingOnline },
            {
              label: "Credit to us",
              hint: "Owed by customers at the start",
              value: report.openingCreditToUs,
              tone: report.openingCreditToUs > 0 ? OWED_TO_US : undefined,
            },
            {
              label: "Credit by us",
              hint: "Owed to vendors at the start",
              value: report.openingCreditByUs,
              tone: report.openingCreditByUs > 0 ? WE_OWE : undefined,
            },
            // Only shown once a hotel actually holds one — a restaurant-only client
            // never sees a row it can't produce.
            ...(report.openingAdvancesHeld > 0
              ? [
                  {
                    label: "Advance held",
                    hint: "Guests' deposits, not yet billed",
                    value: report.openingAdvancesHeld,
                    tone: WE_OWE,
                  },
                ]
              : []),
          ]}
          total={{ label: "Cash + bank", value: report.openingCash + report.openingOnline }}
        />

        {/* Two businesses under one roof get two blocks. A restaurant-only client sees
            just this one, still headed "Sales", so nothing changes for them. */}
        <Section
          title={`${showRooms ? "Restaurant sales" : "Sales"} · ${periodLabel}`}
          note={
            showRooms
              ? "Tables and walk-ins. Total is the full value billed — credit included (accrual)"
              : "Total is the full value billed — credit included (accrual)"
          }
          rows={[
            { label: "Cash sales", value: report.salesTableCash, tone: "#1a7a4a" },
            { label: "Online sales", value: report.salesTableOnline, tone: "#1a7a4a" },
            ...(report.salesTableCard > 0
              ? [{ label: "Card sales", value: report.salesTableCard, tone: "#1a7a4a" }]
              : []),
            {
              label: "Credit sales",
              value: report.salesTableCredit,
              hint: "Billed but not collected",
              tone: "#f97316",
            },
          ]}
          total={{
            label: showRooms ? "Total restaurant sales" : "Total sales",
            value: report.salesTableTotal,
          }}
        />

        {showRooms && (
          <Section
            title={`Room sales · ${periodLabel}`}
            note="Hotel stays — room charge, extras and room service"
            rows={[
              { label: "Cash sales", value: report.salesRoomCash, tone: "#1a7a4a" },
              { label: "Online sales", value: report.salesRoomOnline, tone: "#1a7a4a" },
              ...(report.salesRoomCard > 0
                ? [{ label: "Card sales", value: report.salesRoomCard, tone: "#1a7a4a" }]
                : []),
              // Settled by a deposit taken earlier. Advances are room-only by
              // construction, so these belong here and appear nowhere else in Sales.
              // Without them a fully prepaid stay showed a total with no sale beneath
              // it. The money itself was banked under Room advances, on the day it
              // arrived — split by tender so a mixed deposit isn't one opaque figure.
              ...(report.salesAdvanceCash > 0
                ? [
                    {
                      label: "Paid by advance — cash",
                      hint: "Deposit taken earlier in the stay",
                      value: report.salesAdvanceCash,
                      tone: "#1a7a4a",
                    },
                  ]
                : []),
              ...(report.salesAdvanceOnline > 0
                ? [
                    {
                      label: "Paid by advance — online",
                      hint: "Deposit taken earlier in the stay",
                      value: report.salesAdvanceOnline,
                      tone: "#1a7a4a",
                    },
                  ]
                : []),
              {
                label: "Credit sales",
                value: report.salesRoomCredit,
                hint: "Billed but not collected",
                tone: "#f97316",
              },
            ]}
            total={{ label: "Total room sales", value: report.salesRoomTotal }}
          />
        )}

        {/* The two blocks above always sum to this, so it is stated once rather than
            left for the reader to add up. */}
        {showRooms && (
          <Section
            title={`All sales · ${periodLabel}`}
            note="Restaurant and rooms together"
            rows={[
              { label: "Restaurant", value: report.salesTableTotal },
              { label: "Rooms", value: report.salesRoomTotal },
            ]}
            total={{ label: "Total sales", value: report.salesTotal, tone: "var(--color-primary)" }}
          />
        )}

        {/* Deliberately its OWN section rather than a Sales line. A deposit is money in
            with NO sale behind it yet — the sale books in full at checkout — so folding
            it into Room sales would count the same rupee twice and make that total
            untrue. Hidden entirely for a restaurant, which has no rooms to deposit
            against. */}
        {showRooms &&
          (report.advancesReceived > 0 ||
            report.advancesRefunded > 0 ||
            report.closingAdvancesHeld > 0) && (
          <Section
            title={`Room advances · ${periodLabel}`}
            note="Deposits taken before billing — cash movement, not sales"
            rows={[
              { label: "Advances received", value: report.advancesReceived, tone: "#1a7a4a" },
              // The split behind that headline. A deposit can be taken part in cash and
              // part by transfer, and an owner reconciling a till needs to know which.
              ...(report.advancesCash > 0
                ? [{ label: "— cash", value: report.advancesCash }]
                : []),
              ...(report.advancesOnline > 0
                ? [{ label: "— online", value: report.advancesOnline }]
                : []),
              ...(report.advancesRefunded > 0
                ? [
                    {
                      label: "Advances refunded",
                      hint: "Unused deposits handed back at checkout",
                      value: report.advancesRefunded,
                      tone: WE_OWE,
                    },
                  ]
                : []),
              ...(report.refundsCash > 0
                ? [{ label: "— cash", value: report.refundsCash, tone: WE_OWE }]
                : []),
              ...(report.refundsOnline > 0
                ? [{ label: "— online", value: report.refundsOnline, tone: WE_OWE }]
                : []),
            ]}
            total={{ label: "Held at period end", value: report.closingAdvancesHeld }}
          />
        )}

        {/* Money in that is NOT a sale. Its OWN section, never a Sales line — the
            same reasoning Room Advances gets, above — so the two can never be
            confused for what the business actually sold. */}
        {(report.incomeTotal > 0 || income.length > 0) && (
          <Section
            title={`Extra income · ${periodLabel}`}
            note="Misc/service/other income received by hand — not a sale"
            rows={[
              ...(report.incomeCash > 0 ? [{ label: "Cash", value: report.incomeCash }] : []),
              ...(report.incomeOnline > 0 ? [{ label: "Online", value: report.incomeOnline }] : []),
              ...(report.incomeCard > 0 ? [{ label: "Card", value: report.incomeCard }] : []),
            ]}
            total={{ label: "Total extra income", value: report.incomeTotal, tone: "#1a7a4a" }}
          >
            {income.length > 0 && (
              <div className="border-t" style={{ borderColor: "var(--color-hairline)" }}>
                {income.map((i) => (
                  <IncomeRow key={i.id} entry={i} canManage={canManage} onChanged={resync} />
                ))}
              </div>
            )}
          </Section>
        )}

        {/* Everything that left the business, gathered in one place. The figures
            are already on this page — spread across Purchases, Vendor credits and
            Payroll — and an admin asking "where did the cash go today" should not
            have to add up three sections to find out. */}
        <Section
          title={`Expenses · ${periodLabel}`}
          note="All money out — purchases, vendors, staff and overheads"
          rows={[
            {
              label: "Product purchases",
              hint: "Paid at the time of purchase",
              value: purchasesPaid,
              tone: purchasesPaid > 0 ? WE_OWE : undefined,
            },
            {
              label: "Vendor payments",
              hint: "Settling earlier credit purchases",
              value: report.vendorCreditPaid,
              tone: report.vendorCreditPaid > 0 ? WE_OWE : undefined,
            },
            {
              label: "Staff salary payments",
              value: salaryFinal,
              tone: salaryFinal > 0 ? WE_OWE : undefined,
            },
            {
              label: "Salary advances",
              hint: "Paid ahead of the month ending",
              value: report.salaryAdvance,
              tone: report.salaryAdvance > 0 ? "#f97316" : undefined,
            },
            {
              label: "Extra expenses",
              hint: "Rent, electricity and other overheads",
              value: report.extraExpensesTotal,
              tone: report.extraExpensesTotal > 0 ? WE_OWE : undefined,
            },
            // The breakdown answers "where did it go" without opening another
            // page. Categories with no spend never reach here, so a quiet period
            // simply shows the one line above.
            ...report.extraExpensesByCategory.map((c) => ({
              label: c.label,
              value: c.total,
              sub: true,
            })),
          ]}
          total={{ label: "Total money out", value: totalExpenses, tone: totalExpenses > 0 ? WE_OWE : undefined }}
        />

        {/* Payroll's own line: what was paid, how it left, and what is still owed. */}
        <Section
          title={`Staff salary · ${periodLabel}`}
          note={
            report.salaryOutstanding > 0.005
              ? "Outstanding is salary accrued but not yet paid"
              : "Every salary accrued so far has been paid"
          }
          rows={[
            { label: "Salary paid today", value: payroll.todayTotal },
            { label: "Salary paid this month", value: payroll.monthTotal },
            {
              label: `Paid in cash · ${periodLabel}`,
              value: report.salaryCash,
              tone: report.salaryCash > 0 ? WE_OWE : undefined,
            },
            {
              label: `Paid online · ${periodLabel}`,
              value: report.salaryOnline,
              tone: report.salaryOnline > 0 ? WE_OWE : undefined,
            },
            {
              label: `Advances · ${periodLabel}`,
              value: report.salaryAdvance,
              tone: report.salaryAdvance > 0 ? "#f97316" : undefined,
            },
            { label: "Total salary expense", hint: "All time", value: payroll.allTimeTotal },
          ]}
          total={{
            label: "Outstanding salary liability",
            value: report.salaryOutstanding,
            tone: report.salaryOutstanding > 0.005 ? WE_OWE : undefined,
          }}
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
                label: `Collected (Cash/Online) · ${periodLabel}`,
                value: report.customerCreditCollected,
                tone: report.customerCreditCollected > 0 ? "#1a7a4a" : undefined,
              },
              {
                label: `Discount written off · ${periodLabel}`,
                value: report.customerCreditDiscounted,
                tone: report.customerCreditDiscounted > 0 ? "#6366f1" : undefined,
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
              // "Right now", not "at the end of the period" — this figure and
              // the count beside it are for chasing people today, so they stay
              // live even when a past period is selected. The period-accurate
              // number is in the closing balance above.
              label: "Outstanding right now",
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
              // "Right now", not "at the end of the period" — this figure and
              // the count beside it are for chasing people today, so they stay
              // live even when a past period is selected. The period-accurate
              // number is in the closing balance above.
              label: "Outstanding right now",
              value: report.vendorCreditOutstanding,
              tone: report.vendorCreditOutstanding > 0 ? WE_OWE : undefined,
            }}
          />
        </div>

        {/* The receivable / payable pair, as one more row of the sheet. */}
        <Section
          title="Credit position right now"
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

        {/* Sits immediately before Closing so the last thing read before the
            balances is what was given away to earn them.

            Deliberately its OWN block and NOT part of Sales: the net amount IS
            the sale everywhere in this app, so the discount has already been
            taken off every figure above. Listing it as a Sales row would invite
            subtracting it twice. It moves no balance at all, which is why it has
            no ledger row and no effect on Closing. */}
        <Section
          title={`Discounts · ${periodLabel}`}
          note="Given away at the till or on credit clearance"
          rows={[
            {
              label: "Transactions discounted",
              value: report.discountedBills,
              display:
                report.discountedBills === 1 ? "1 transaction" : `${report.discountedBills} transactions`,
            },
            {
              label: "Till / sales discounts",
              value: report.discountsTotal - report.creditDiscountsTotal,
            },
            {
              label: "Credit clearance discounts",
              value: report.creditDiscountsTotal,
              tone: report.creditDiscountsTotal > 0 ? "#6366f1" : undefined,
            },
          ]}
          total={{
            label: "Discount given (Total)",
            value: report.discountsTotal,
            tone: report.discountsTotal > 0 ? "#f97316" : undefined,
          }}
        />

        <Section
          title="Closing balance"
          note="Opening + money collected − money spent"
          rows={[
            { label: "Cash balance", value: report.closingCash },
            { label: "Online / bank balance", value: report.closingOnline },
            {
              label: "Credit to us",
              hint: "Still owed by customers",
              value: report.closingCreditToUs,
              tone: report.closingCreditToUs > 0 ? OWED_TO_US : undefined,
            },
            {
              label: "Credit by us",
              hint: "Still owed to vendors",
              value: report.closingCreditByUs,
              tone: report.closingCreditByUs > 0 ? WE_OWE : undefined,
            },
            // Part of the cash balance above is NOT yours yet. Saying so is the whole
            // reason this figure exists — otherwise the till simply looks fuller.
            ...(report.closingAdvancesHeld > 0
              ? [
                  {
                    label: "Advance held",
                    hint: "Included in cash above, but owed to guests",
                    value: report.closingAdvancesHeld,
                    tone: WE_OWE,
                  },
                ]
              : []),
          ]}
          total={{ label: "Net balance (cash + bank)", value: report.closingNet, tone: "var(--color-primary)" }}
        />

        {/* The ledger behind every figure above. Deliberately last: the summary
            answers "where do I stand", this answers "why". */}
        <LedgerSection rows={ledger} periodLabel={periodLabel} showRooms={showRooms} />
      </div>

      <Modal
        open={importingCredit}
        onClose={() => setImportingCredit(false)}
        title="Import an existing credit"
        subtitle="Money a customer owed you before HRestroSewa"
      >
        <ImportCreditForm
          onDone={() => {
            setImportingCredit(false);
            // The receivable and the ledger both move, so pull the whole report
            // back rather than patching a figure locally.
            refreshAll();
          }}
        />
      </Modal>

      <Modal
        open={settingOpening}
        onClose={() => setSettingOpening(false)}
        title={opening ? "Update opening balance" : "Set opening balance"}
        subtitle="The money you started with"
      >
        <OpeningForm current={opening} onDone={() => { setSettingOpening(false); refreshAll(); }} />
      </Modal>

      <Modal
        open={addingIncome}
        onClose={() => setAddingIncome(false)}
        title="Add extra income"
        subtitle="Money in that isn't a sale"
      >
        <AddIncomeForm onDone={() => { setAddingIncome(false); resync(); }} />
      </Modal>
    </div>
  );
}
