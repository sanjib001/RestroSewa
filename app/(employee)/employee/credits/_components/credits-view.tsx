"use client";

import { createPortal } from "react-dom";
import { useActionState, useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  addCreditPayment,
  getCreditDetail,
  getCredits,
  getCreditSummary,
} from "@/app/actions/credits";
import type {
  ActionResult,
  CreditCustomer,
  CreditCustomerDetail,
  CreditFilter,
} from "@/app/actions/credits";
import type { CreditStats } from "@/lib/credits";
import { CREDIT_STATUS_COLOR, CREDIT_STATUS_LABEL } from "@/lib/credits";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CreditReceiptButton } from "./credit-receipt";
import { Loader2, Search, X } from "lucide-react";

function money(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}
function money2(n: number) {
  return `₹${n.toFixed(2)}`;
}

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  online: "Online",
  card: "Card",
  mixed: "Mixed",
  credit: "Credit",
  upi: "UPI",
  other: "Other",
};

const FILTERS: { key: CreditFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "owing", label: "Owes money" },
  { key: "settled", label: "Settled" },
];

const REPAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "online", label: "Online" },
  { value: "card", label: "Card" },
];

function StatTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div
      className="rounded-xl border px-4 py-3"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
    >
      <p className="text-xs mb-1" style={{ color: "var(--color-ink-mute)" }}>{label}</p>
      <p className="text-lg font-medium tabular-nums" style={{ color: tone ?? "var(--color-ink)" }}>
        {value}
      </p>
    </div>
  );
}

// One row per CUSTOMER — their single Credit ID and their whole balance.
function CustomerCard({
  customer,
  onOpen,
  highlight,
}: {
  customer: CreditCustomer;
  onOpen: () => void;
  highlight?: boolean;
}) {
  const settled = customer.balance <= 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-xl border px-4 py-3 text-left transition-colors"
      style={{
        background: highlight ? "var(--color-warning-bg)" : "var(--color-canvas)",
        borderColor: highlight ? "var(--color-warning)" : "var(--color-hairline)",
        borderWidth: highlight ? 1.5 : 1,
        opacity: settled && !highlight ? 0.7 : 1,
      }}
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink)" }}>
              {customer.name}
            </p>
            <span
              className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border shrink-0"
              style={{
                color: settled ? CREDIT_STATUS_COLOR.fully_paid : CREDIT_STATUS_COLOR.pending,
                borderColor: `${settled ? CREDIT_STATUS_COLOR.fully_paid : CREDIT_STATUS_COLOR.pending}44`,
                background: `${settled ? CREDIT_STATUS_COLOR.fully_paid : CREDIT_STATUS_COLOR.pending}11`,
                letterSpacing: "0.06em",
              }}
            >
              {settled ? CREDIT_STATUS_LABEL.fully_paid : "Owes"}
            </span>
          </div>
          <p className="text-xs mt-0.5 truncate" style={{ color: "var(--color-ink-mute)" }}>
            {customer.customer_code}
            {customer.phone ? ` · ${customer.phone}` : ""}
            {" · "}
            {customer.bill_count} bill{customer.bill_count !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p
            className="text-sm font-medium tabular-nums"
            style={{ color: settled ? "var(--color-ink-mute)" : "#dc2626" }}
          >
            {settled ? "Settled" : money(customer.balance)}
          </p>
          {!settled && (
            <p className="text-[10px]" style={{ color: "var(--color-ink-mute)" }}>outstanding</p>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Account detail: balance, bills, payments, take money ──────────────────────

function CustomerDetailModal({
  customerId,
  onClose,
  onChanged,
}: {
  customerId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<CreditCustomerDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [state, action, pending] = useActionState<ActionResult, FormData>(addCreditPayment, null);

  // The modal is portaled to <body> (see the return). `document` doesn't exist during
  // SSR, and createPortal must run only after mount, so gate on this.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const load = useCallback(async () => {
    const res = await getCreditDetail(customerId);
    if ("error" in res) setLoadError(res.error);
    else setDetail(res);
  }, [customerId]);

  useEffect(() => { load(); }, [load]);

  // `addCreditPayment` returns null both before the first submit and after a
  // successful one, so success can't be read from `state` alone — watch the
  // falling edge of `pending`.
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !state?.error) {
      setAmount("");
      load();
      onChanged();
    }
    wasPending.current = pending;
  }, [pending, state, load, onChanged]);

  const balance = detail?.balance ?? 0;
  const settled = balance <= 0;
  const amountNum = parseFloat(amount) || 0;
  const amountValid = amountNum > 0 && amountNum <= balance + 0.005;

  if (!mounted) return null;

  // Portaled to <body>, NOT rendered inline. A modal that stays in the page tree is a
  // hostage to every ancestor: any one of them with a `transform` (the .rs-page entry
  // animation, a pull-to-refresh drag), a `filter`, or `contain` becomes the containing
  // block for this `position: fixed`, and the modal anchors to THAT box instead of the
  // viewport — landing off-screen while its backdrop still dims the page. That is exactly
  // the "only the dimmed overlay shows, the dialog is missing" bug. At <body> there is no
  // such ancestor, so `fixed inset-0` always means the viewport. The React tree is
  // unchanged (state, the payment form, onClose all live here); only the DOM host moves.
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-start sm:items-center justify-center overflow-y-auto"
      style={{ background: "rgba(13,37,61,0.45)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md my-6 mx-3 rounded-2xl overflow-hidden"
        style={{ background: "var(--color-canvas)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: "var(--color-hairline)" }}
        >
          <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
            {detail ? `${detail.name} · ${detail.customer_code}` : "Credit account"}
          </p>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-4 max-h-[75vh] overflow-y-auto flex flex-col gap-4">
          {loadError && (
            <p className="text-sm rounded-md px-3 py-2" style={{ color: "var(--color-ruby)", background: "var(--color-danger-bg)" }}>
              {loadError}
            </p>
          )}

          {!detail && !loadError && (
            <div className="flex items-center justify-center py-8" style={{ color: "var(--color-ink-mute)" }}>
              <Loader2 size={18} className="animate-spin" />
            </div>
          )}

          {detail && (
            <>
              {/* One balance for the whole account, however many bills sit under it. */}
              <div
                className="rounded-xl border px-4 py-3 flex flex-col gap-1.5"
                style={{
                  background: settled ? "var(--color-success-bg)" : "var(--color-warning-bg)",
                  borderColor: settled ? "color-mix(in srgb, var(--color-success) 27%, transparent)" : "color-mix(in srgb, var(--color-warning) 27%, transparent)",
                }}
              >
                <div className="flex items-center justify-between text-sm">
                  <span style={{ color: "var(--color-ink-mute)" }}>Billed on credit</span>
                  <span className="tabular-nums" style={{ color: "var(--color-ink)" }}>
                    {money2(detail.total_billed)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span style={{ color: "var(--color-ink-mute)" }}>Paid so far</span>
                  <span className="tabular-nums" style={{ color: "var(--color-ink)" }}>
                    − {money2(detail.total_paid)}
                  </span>
                </div>
                <div
                  className="flex items-center justify-between pt-1.5 border-t"
                  style={{ borderColor: settled ? "color-mix(in srgb, var(--color-success) 13%, transparent)" : "color-mix(in srgb, var(--color-warning) 20%, transparent)" }}
                >
                  <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                    {settled ? "Settled" : "Outstanding"}
                  </span>
                  <span
                    className="text-lg font-medium tabular-nums"
                    style={{ color: settled ? "var(--color-success)" : "#9a3412" }}
                  >
                    {money2(detail.balance)}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-1 text-xs" style={{ color: "var(--color-ink-mute)" }}>
                <div className="flex justify-between gap-3">
                  <span>Credit ID</span>
                  <span style={{ color: "var(--color-ink)" }}>{detail.customer_code}</span>
                </div>
                {detail.phone && (
                  <div className="flex justify-between gap-3">
                    <span>Phone</span>
                    <a href={`tel:${detail.phone}`} style={{ color: "var(--color-primary)" }}>
                      {detail.phone}
                    </a>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <span>Customer since</span>
                  <span style={{ color: "var(--color-ink)" }}>
                    {new Date(detail.created_at).toLocaleDateString("en-IN", { dateStyle: "medium" })}
                  </span>
                </div>
              </div>

              {/* Take money against the ACCOUNT — it settles their oldest bills first. */}
              {!settled && (
                <form
                  action={action}
                  className="rounded-xl border px-4 py-4 flex flex-col gap-3"
                  style={{ background: "var(--color-canvas-soft)", borderColor: "var(--color-hairline)" }}
                >
                  <input type="hidden" name="customer_id" value={detail.id} />
                  <input type="hidden" name="method" value={method} />

                  <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                    Record a payment
                  </p>

                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="credit_pay_amount"
                      className="text-xs uppercase tracking-wide"
                      style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
                    >
                      Amount received (₹)
                    </label>
                    <div className="relative">
                      <span
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none"
                        style={{ color: "var(--color-ink-mute)" }}
                      >
                        ₹
                      </span>
                      <Input
                        id="credit_pay_amount"
                        name="amount"
                        type="number"
                        min="0.01"
                        max={detail.balance}
                        step="0.01"
                        required
                        placeholder="0.00"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="pl-7"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setAmount(detail.balance.toFixed(2))}
                      className="self-start text-xs underline"
                      style={{ color: "var(--color-primary)" }}
                    >
                      Settle in full ({money2(detail.balance)})
                    </button>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <p
                      className="text-xs uppercase tracking-wide"
                      style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
                    >
                      Received as
                    </p>
                    <div className="grid grid-cols-3 gap-1">
                      {REPAYMENT_METHODS.map((m) => {
                        const active = method === m.value;
                        return (
                          <button
                            key={m.value}
                            type="button"
                            onClick={() => setMethod(m.value)}
                            className="py-1.5 rounded-lg border text-sm transition-colors"
                            style={{
                              borderColor: active ? "var(--color-primary)" : "var(--color-hairline-input)",
                              background: active ? "rgba(99,102,241,0.06)" : "var(--color-canvas)",
                              color: "var(--color-ink)",
                            }}
                          >
                            {m.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <Input name="notes" type="text" placeholder="Note (optional)" autoComplete="off" />

                  {amount !== "" && !amountValid && (
                    <p className="text-xs" style={{ color: "var(--color-ruby)" }}>
                      {amountNum > balance
                        ? `That's more than the ${money2(balance)} they owe.`
                        : "Enter an amount greater than zero."}
                    </p>
                  )}

                  {state?.error && (
                    <p
                      className="text-sm rounded-md px-3 py-2"
                      style={{ color: "var(--color-ruby)", background: "var(--color-danger-bg)" }}
                    >
                      {state.error}
                    </p>
                  )}

                  <Button type="submit" variant="primary" disabled={pending || !amountValid}>
                    {pending ? "Recording…" : `Record ${amountNum > 0 ? money2(amountNum) : "payment"}`}
                  </Button>
                </form>
              )}

              {/* Bills under this ONE account */}
              <div>
                <p
                  className="text-xs uppercase tracking-wide mb-2 font-medium"
                  style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
                >
                  Bills on credit ({detail.bills.length})
                </p>
                <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--color-hairline)" }}>
                  {detail.bills.map((b, i) => (
                    <div
                      key={b.id}
                      className="flex items-start gap-3 px-4 py-2.5"
                      style={{
                        borderTop: i === 0 ? "none" : "1px solid var(--color-hairline)",
                        background: "var(--color-canvas)",
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm" style={{ color: "var(--color-ink)" }}>
                          {b.credit_number}
                          <span className="ml-1.5 text-xs" style={{ color: "var(--color-ink-mute)" }}>
                            {b.location}
                          </span>
                        </p>
                        <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                          {new Date(b.created_at).toLocaleString("en-IN", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm tabular-nums" style={{ color: "var(--color-ink)" }}>
                          {money2(b.bill_amount)}
                        </p>
                        <p
                          className="text-[10px] uppercase tracking-wide"
                          style={{ color: CREDIT_STATUS_COLOR[b.status], letterSpacing: "0.06em" }}
                        >
                          {CREDIT_STATUS_LABEL[b.status]}
                          {b.balance > 0 && ` · ${money(b.balance)} left`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Payment history for the account */}
              <div>
                <p
                  className="text-xs uppercase tracking-wide mb-2 font-medium"
                  style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
                >
                  Payment history
                </p>
                {detail.payments.length === 0 ? (
                  <div
                    className="rounded-xl border px-4 py-6 text-center"
                    style={{ borderStyle: "dashed", borderColor: "var(--color-hairline)" }}
                  >
                    <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
                      No payments received yet.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--color-hairline)" }}>
                    {detail.payments.map((p, i) => (
                      <div
                        key={p.id}
                        className="flex items-start gap-3 px-4 py-2.5"
                        style={{
                          borderTop: i === 0 ? "none" : "1px solid var(--color-hairline)",
                          background: "var(--color-canvas)",
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm" style={{ color: "var(--color-ink)" }}>
                            {METHOD_LABEL[p.method] ?? p.method}
                          </p>
                          <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                            {new Date(p.created_at).toLocaleString("en-IN", {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                            {p.staff_name ? ` · ${p.staff_name}` : ""}
                          </p>
                          {p.notes && (
                            <p className="text-xs italic mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
                              {p.notes}
                            </p>
                          )}
                        </div>
                        <p className="text-sm font-medium tabular-nums shrink-0" style={{ color: "var(--color-success)" }}>
                          {money2(p.amount)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <CreditReceiptButton customerId={detail.id} />
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export function CreditsView({
  initialCredits,
  initialSummary,
  initialOpenId = null,
  embedded = false,
}: {
  initialCredits: CreditCustomer[];
  initialSummary: CreditStats;
  /** The account to open on arrival — set after a bill is closed on credit. */
  initialOpenId?: string | null;
  embedded?: boolean;
}) {
  const [customers, setCustomers] = useState(initialCredits);
  const [summary, setSummary] = useState(initialSummary);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<CreditFilter>("all");
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [loading, startTransition] = useTransition();

  // The account just billed stays highlighted in the list behind the modal.
  const [highlightId] = useState<string | null>(initialOpenId);

  const reload = useCallback((s: string, st: CreditFilter) => {
    startTransition(async () => {
      try {
        const [rows, sum] = await Promise.all([
          getCredits({ search: s, status: st }),
          getCreditSummary(),
        ]);
        setCustomers(rows);
        setSummary(sum);
      } catch {
        // keep the last known list on a transient failure
      }
    });
  }, []);

  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const t = setTimeout(() => reload(search, status), 250);
    return () => clearTimeout(t);
  }, [search, status, reload]);

  const refresh = useCallback(() => reload(search, status), [reload, search, status]);

  // A bill closed on credit, or a repayment taken at another till, lands here at
  // once — no refresh, no stale balance.
  useRealtime(["credits", "billing"], refresh);

  return (
    <div className={embedded ? "" : "p-4 sm:p-5 max-w-2xl mx-auto"}>
      {!embedded && (
        <h1
          className="text-xl mb-1"
          style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}
        >
          Credits
        </h1>
      )}
      <p className="text-sm mb-5" style={{ color: "var(--color-ink-mute)" }}>
        {summary.openCount === 0
          ? "No one owes anything — everything is settled."
          : `${summary.openCount} customer${summary.openCount !== 1 ? "s" : ""} owe ${money(summary.outstanding)}`}
        {loading && <span className="ml-2">Updating…</span>}
      </p>

      <div
        className="grid gap-3 mb-4"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}
      >
        <StatTile
          label="Outstanding"
          value={money(summary.outstanding)}
          tone={summary.outstanding > 0 ? "#dc2626" : undefined}
        />
        <StatTile label="Collected today" value={money(summary.collected)} tone="#1a7a4a" />
        <StatTile label="Customers owing" value={String(summary.pendingCount)} />
        <StatTile label="Settled" value={String(summary.fullyPaidCount)} />
      </div>

      <div className="relative mb-3">
        <Search
          size={15}
          className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: "var(--color-ink-mute)" }}
        />
        <Input
          type="search"
          placeholder="Search by phone, name or credit ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="flex gap-2 overflow-x-auto mb-4" style={{ scrollbarWidth: "none" }}>
        {FILTERS.map((f) => {
          const active = status === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatus(f.key)}
              className="shrink-0 text-sm px-3 py-1.5 rounded-full border transition-colors"
              // Selected filter → Credits' indigo. Constant indigo FILL (not the flipping accent),
              // so the white label stays readable in dark where the accent goes light.
              style={{
                borderColor: active ? "var(--fill-indigo)" : "var(--color-hairline)",
                background: active ? "var(--fill-indigo)" : "var(--color-canvas)",
                color: active ? "#fff" : "var(--color-ink)",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {customers.length === 0 ? (
        <div
          className="rounded-xl border px-6 py-12 text-center"
          style={{ borderStyle: "dashed", borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
        >
          <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
            {search || status !== "all"
              ? "No customers match that search."
              : "No credit accounts yet. Choose Credit when closing a bill to open one."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {customers.map((c) => (
            <CustomerCard
              key={c.id}
              customer={c}
              highlight={c.id === highlightId}
              onOpen={() => setOpenId(c.id)}
            />
          ))}
        </div>
      )}

      {openId && (
        <CustomerDetailModal
          customerId={openId}
          onClose={() => setOpenId(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}
