"use client";

import { useActionState, useEffect, useTransition, useState } from "react";
import { closeSessionWithPayment, updateOrderItemStatus, forceCloseSession } from "@/app/actions/pos";
import type { ActionResult, OrderItemRow, SessionDetail } from "@/app/actions/pos";
import { searchCreditCustomers } from "@/app/actions/credits";
import type { CreditCustomer } from "@/app/actions/credits";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, ChevronRight, Plus } from "lucide-react";
import { SessionPrintButtons } from "./print-tickets";
import type { RestaurantInfo } from "./print-tickets";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  ready: "Ready",
  served: "Served",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "#f97316",
  ready: "#1a7a4a",
  served: "var(--color-ink-mute)",
};

function OrderItem({ item, sessionId }: { item: OrderItemRow; sessionId: string }) {
  const [, start] = useTransition();

  const nextStatus =
    item.item_status === "pending"
      ? "ready"
      : item.item_status === "ready"
      ? "served"
      : null;

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 border-b last:border-0"
      style={{
        borderColor: "var(--color-hairline)",
        opacity: item.item_status === "served" ? 0.45 : 1,
      }}
    >
      <div className="flex-1">
        <p className="text-sm" style={{ color: "var(--color-ink)" }}>
          {item.quantity > 1 && (
            <span className="font-medium mr-1" style={{ color: "var(--color-ink-mute)" }}>
              ×{item.quantity}
            </span>
          )}
          {item.item_name}
        </p>
        {item.workstation_name && (
          <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
            {item.workstation_name}
          </p>
        )}
        {item.notes && (
          <p className="text-xs italic mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
            {item.notes}
          </p>
        )}
      </div>

      <p className="text-sm tabular shrink-0" style={{ color: "var(--color-ink-mute)" }}>
        ₹{(Number(item.item_price) * item.quantity).toFixed(0)}
      </p>

      <span
        className="text-xs shrink-0 min-w-[52px] text-center"
        style={{ color: STATUS_COLOR[item.item_status] }}
      >
        {STATUS_LABEL[item.item_status]}
      </span>

      {nextStatus && (
        <button
          type="button"
          title={`Mark as ${nextStatus}`}
          className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
          style={{ background: "var(--color-canvas-soft)" }}
          onClick={() =>
            start(async () => {
              await updateOrderItemStatus(
                item.id,
                nextStatus as "ready" | "served"
              );
            })
          }
        >
          <Check size={13} style={{ color: "var(--color-ink-mute)" }} />
        </button>
      )}
    </div>
  );
}

type PaymentMethod = "cash" | "online" | "card" | "mixed" | "credit";
type DownTender = "cash" | "online" | "card";

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash",   label: "Cash"   },
  { value: "online", label: "Online" },
  { value: "card",   label: "Card"   },
  { value: "mixed",  label: "Mixed"  },
  { value: "credit", label: "Credit" },
];

const DOWN_TENDERS: { value: DownTender; label: string }[] = [
  { value: "cash",   label: "Cash"   },
  { value: "online", label: "Online" },
  { value: "card",   label: "Card"   },
];

function PaymentForm({
  session,
  canUseCredit,
}: {
  session: SessionDetail;
  canUseCredit: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(
    closeSessionWithPayment,
    null
  );
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [cashAmt, setCashAmt]     = useState("");
  const [onlineAmt, setOnlineAmt] = useState("");

  // Credit — WHICH customer's account, and what (if anything) they're paying now.
  const [custQuery, setCustQuery]     = useState("");
  const [matches, setMatches]         = useState<CreditCustomer[]>([]);
  const [searching, setSearching]     = useState(false);
  const [picked, setPicked]           = useState<CreditCustomer | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [custName, setCustName]       = useState("");
  const [custPhone, setCustPhone]     = useState("");
  const [paidNow, setPaidNow]         = useState("");
  const [downTender, setDownTender]   = useState<DownTender>("cash");
  const [creditNotes, setCreditNotes] = useState("");

  // Debounced lookup of existing accounts. This is what stops a returning
  // customer being handed a second Credit ID: the cashier picks the account
  // instead of retyping the name.
  useEffect(() => {
    if (method !== "credit" || picked || creatingNew) {
      setMatches([]);
      return;
    }
    const q = custQuery.trim();
    if (q.length < 2) {
      setMatches([]);
      setSearching(false);
      return;
    }
    let alive = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const found = await searchCreditCustomers(q);
        if (alive) setMatches(found);
      } catch {
        if (alive) setMatches([]);
      } finally {
        if (alive) setSearching(false);
      }
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [custQuery, method, picked, creatingNew]);

  const total = session.total;

  const methods = canUseCredit
    ? PAYMENT_METHODS
    : PAYMENT_METHODS.filter((m) => m.value !== "credit");

  function handleCashChange(val: string) {
    setCashAmt(val);
    const cash = parseFloat(val);
    setOnlineAmt(!isNaN(cash) && cash >= 0 ? Math.max(0, total - cash).toFixed(2) : "");
  }

  function handleOnlineChange(val: string) {
    setOnlineAmt(val);
    const online = parseFloat(val);
    setCashAmt(!isNaN(online) && online >= 0 ? Math.max(0, total - online).toFixed(2) : "");
  }

  const bothFilled = cashAmt !== "" && onlineAmt !== "";
  const mixedSum   = (parseFloat(cashAmt) || 0) + (parseFloat(onlineAmt) || 0);
  const mixedValid = method !== "mixed" || (bothFilled && Math.abs(mixedSum - total) < 0.01);

  // Credit: blank "paid now" means the whole bill goes on credit.
  const paidNowNum   = parseFloat(paidNow) || 0;
  const creditAmount = Math.max(0, total - paidNowNum);
  const paidNowValid = paidNowNum >= 0 && paidNowNum < total;
  // Either an existing account is selected, or a new one is being named.
  const customerChosen = !!picked || (creatingNew && custName.trim().length > 0);
  const creditValid = method !== "credit" || (customerChosen && paidNowValid);

  const canSubmit =
    !pending &&
    mixedValid &&
    creditValid &&
    (method !== "mixed" || bothFilled);

  const errorMsg = state?.error;

  // What the server records as tendered. On a credit bill this is the down
  // payment only — the rest is the credit.
  const tender = {
    cash:   method === "cash"  ? total : method === "credit" && downTender === "cash"   ? paidNowNum : 0,
    online: method === "online" ? total : method === "credit" && downTender === "online" ? paidNowNum : 0,
    card:   method === "card"  ? total : method === "credit" && downTender === "card"   ? paidNowNum : 0,
  };

  return (
    <form
      action={action}
      className="rounded-xl border px-5 py-5 flex flex-col gap-4"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-primary)", borderWidth: 1.5 }}
    >
      <input type="hidden" name="session_id"   value={session.id} />
      <input type="hidden" name="total_amount" value={total.toFixed(2)} />

      {/* Tender split. Mixed drives cash/online from its own inputs, so it opts
          out of these pre-computed values. */}
      {method !== "mixed" && (
        <>
          <input type="hidden" name="cash_amount"   value={tender.cash.toFixed(2)} />
          <input type="hidden" name="online_amount" value={tender.online.toFixed(2)} />
          <input type="hidden" name="card_amount"   value={tender.card.toFixed(2)} />
        </>
      )}

      {/* The chosen account wins; the name/phone are only used when opening a new
          one. Sending the id is what guarantees a returning customer keeps their
          single Credit ID. */}
      {method === "credit" && (
        <>
          <input type="hidden" name="credit_customer_id"    value={picked?.id ?? ""} />
          <input type="hidden" name="credit_customer_name"  value={picked ? "" : custName} />
          <input type="hidden" name="credit_customer_phone" value={picked ? "" : custPhone} />
        </>
      )}

      <p className="text-base font-medium" style={{ color: "var(--color-ink)" }}>
        Close &amp; collect payment
      </p>

      {/* Method selector */}
      <div className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
          Payment method
        </p>
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${methods.length}, 1fr)` }}>
          {methods.map((m) => {
            const active = method === m.value;
            const isCredit = m.value === "credit";
            return (
              <label
                key={m.value}
                className="flex items-center gap-2 cursor-pointer justify-center py-2 rounded-lg border text-sm transition-colors"
                style={{
                  borderColor: active
                    ? isCredit ? "#f97316" : "var(--color-primary)"
                    : "var(--color-hairline-input)",
                  background: active
                    ? isCredit ? "rgba(249,115,22,0.08)" : "rgba(99,102,241,0.06)"
                    : "var(--color-canvas-soft)",
                  color: "var(--color-ink)",
                }}
              >
                <input
                  type="radio"
                  name="payment_method"
                  value={m.value}
                  checked={active}
                  onChange={() => { setMethod(m.value); setCashAmt(""); setOnlineAmt(""); }}
                  className="sr-only"
                />
                {m.label}
              </label>
            );
          })}
        </div>
      </div>

      {/* Paid in full (cash / online / card): the amount is simply the total. */}
      {(method === "cash" || method === "online" || method === "card") && (
        <div
          className="flex items-center justify-between px-4 py-3 rounded-lg"
          style={{ background: "var(--color-canvas-soft)", border: "1px solid var(--color-hairline)" }}
        >
          <span className="text-sm" style={{ color: "var(--color-ink-mute)" }}>Amount</span>
          <span className="text-lg font-medium tabular" style={{ color: "var(--color-ink)" }}>
            ₹{total.toFixed(0)}
          </span>
        </div>
      )}

      {/* Mixed: two inputs with auto-calculation */}
      {method === "mixed" && (
        <div className="flex flex-col gap-3">
          <div
            className="flex items-center justify-between px-4 py-2 rounded-lg text-xs"
            style={{ background: "var(--color-canvas-soft)", border: "1px solid var(--color-hairline)", color: "var(--color-ink-mute)" }}
          >
            <span>Total bill</span>
            <span className="font-medium tabular" style={{ color: "var(--color-ink)" }}>₹{total.toFixed(0)}</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="cash_amount"
              className="text-xs uppercase tracking-wide"
              style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
            >
              Cash amount (₹)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none" style={{ color: "var(--color-ink-mute)" }}>₹</span>
              <Input
                id="cash_amount"
                name="cash_amount"
                type="number"
                min="0"
                max={total}
                step="0.01"
                placeholder="0.00"
                value={cashAmt}
                onChange={(e) => handleCashChange(e.target.value)}
                className="pl-7"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="online_amount"
              className="text-xs uppercase tracking-wide"
              style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
            >
              Online amount (₹)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none" style={{ color: "var(--color-ink-mute)" }}>₹</span>
              <Input
                id="online_amount"
                name="online_amount"
                type="number"
                min="0"
                max={total}
                step="0.01"
                placeholder="0.00"
                value={onlineAmt}
                onChange={(e) => handleOnlineChange(e.target.value)}
                className="pl-7"
              />
            </div>
          </div>

          {bothFilled && !mixedValid && (
            <p className="text-xs" style={{ color: "var(--color-ruby)" }}>
              The combined Cash and Online amounts must equal the total payable amount (₹{total.toFixed(0)}).
            </p>
          )}
          {bothFilled && mixedValid && (
            <p className="text-xs" style={{ color: "#1a7a4a" }}>
              ✓ Amounts match
            </p>
          )}
        </div>
      )}

      {/* Credit: close the bill with all or part of it still owed. */}
      {method === "credit" && (
        <div className="flex flex-col gap-3">
          <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
            The bill is closed in full, and the unpaid balance is added to the customer&apos;s
            credit account so it can be collected later.
          </p>

          {/* An account is CHOSEN, not re-created. A returning customer keeps their
              one Credit ID and their balance simply grows. */}
          {picked ? (
            <div
              className="rounded-lg border px-4 py-3 flex items-start gap-3"
              style={{ background: "#f0fdf4", borderColor: "#1a7a4a44" }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink)" }}>
                  {picked.name}
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
                  {picked.customer_code}
                  {picked.phone ? ` · ${picked.phone}` : ""}
                </p>
                {picked.balance > 0 && (
                  <p className="text-xs mt-1" style={{ color: "#9a3412" }}>
                    Already owes ₹{picked.balance.toFixed(2)} — this bill will be added to it.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => { setPicked(null); setCustQuery(""); }}
                className="text-xs px-2 py-1 rounded-md border shrink-0"
                style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink-mute)" }}
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="credit_search"
                  className="text-xs uppercase tracking-wide"
                  style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
                >
                  Find the customer
                </label>
                <Input
                  id="credit_search"
                  type="search"
                  autoComplete="off"
                  placeholder="Search by phone number or name…"
                  value={custQuery}
                  onChange={(e) => setCustQuery(e.target.value)}
                />
                <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                  Phone is the surest way to find a returning customer.
                </p>
              </div>

              {/* Matching accounts — tap one to reuse it. */}
              {searching && (
                <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Searching…</p>
              )}

              {matches.length > 0 && (
                <div
                  className="rounded-lg border overflow-hidden"
                  style={{ borderColor: "var(--color-hairline)" }}
                >
                  {matches.map((m, i) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setPicked(m)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
                      style={{
                        borderTop: i === 0 ? "none" : "1px solid var(--color-hairline)",
                        background: "var(--color-canvas)",
                      }}
                    >
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm truncate" style={{ color: "var(--color-ink)" }}>
                          {m.name}
                        </span>
                        <span className="block text-xs" style={{ color: "var(--color-ink-mute)" }}>
                          {m.customer_code}{m.phone ? ` · ${m.phone}` : ""}
                        </span>
                      </span>
                      <span
                        className="text-sm tabular-nums shrink-0"
                        style={{ color: m.balance > 0 ? "#dc2626" : "var(--color-ink-mute)" }}
                      >
                        {m.balance > 0 ? `₹${m.balance.toFixed(0)}` : "settled"}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* Nothing matched — open a new account without leaving the screen. */}
              {custQuery.trim().length >= 2 && !searching && matches.length === 0 && !creatingNew && (
                <button
                  type="button"
                  onClick={() => {
                    setCreatingNew(true);
                    // Prefill whichever field they typed: digits look like a phone.
                    const q = custQuery.trim();
                    if (/^[\d+\-\s]+$/.test(q)) setCustPhone(q);
                    else setCustName(q);
                  }}
                  className="w-full text-sm py-2 rounded-lg border"
                  style={{ borderColor: "var(--color-primary)", color: "var(--color-primary)" }}
                >
                  + Create new credit account
                </button>
              )}

              {creatingNew && (
                <div
                  className="rounded-lg border px-3 py-3 flex flex-col gap-3"
                  style={{ background: "var(--color-canvas-soft)", borderColor: "var(--color-hairline)" }}
                >
                  <p className="text-xs font-medium" style={{ color: "var(--color-ink)" }}>
                    New credit account
                  </p>

                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="credit_customer_name"
                      className="text-xs uppercase tracking-wide"
                      style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
                    >
                      Customer name <span style={{ color: "var(--color-ruby)" }}>*</span>
                    </label>
                    <Input
                      id="credit_customer_name"
                      type="text"
                      autoComplete="off"
                      placeholder="Who owes this?"
                      value={custName}
                      onChange={(e) => setCustName(e.target.value)}
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="credit_customer_phone"
                      className="text-xs uppercase tracking-wide"
                      style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
                    >
                      Phone number
                    </label>
                    <Input
                      id="credit_customer_phone"
                      type="tel"
                      autoComplete="off"
                      placeholder="Recommended — how you'll find them next time"
                      value={custPhone}
                      onChange={(e) => setCustPhone(e.target.value)}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => { setCreatingNew(false); setCustName(""); setCustPhone(""); }}
                    className="self-start text-xs underline"
                    style={{ color: "var(--color-ink-mute)" }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="paid_now"
              className="text-xs uppercase tracking-wide"
              style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
            >
              Paying now (₹) — leave blank for full credit
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none" style={{ color: "var(--color-ink-mute)" }}>₹</span>
              <Input
                id="paid_now"
                type="number"
                min="0"
                max={total}
                step="0.01"
                placeholder="0.00"
                value={paidNow}
                onChange={(e) => setPaidNow(e.target.value)}
                className="pl-7"
              />
            </div>
          </div>

          {/* Which tender the down payment came in as — only matters if they paid. */}
          {paidNowNum > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
                Paid by
              </p>
              <div className="grid grid-cols-3 gap-1">
                {DOWN_TENDERS.map((t) => {
                  const active = downTender === t.value;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setDownTender(t.value)}
                      className="py-1.5 rounded-lg border text-sm transition-colors"
                      style={{
                        borderColor: active ? "var(--color-primary)" : "var(--color-hairline-input)",
                        background: active ? "rgba(99,102,241,0.06)" : "var(--color-canvas-soft)",
                        color: "var(--color-ink)",
                      }}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="credit_notes"
              className="text-xs uppercase tracking-wide"
              style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
            >
              Note
            </label>
            <Input
              id="credit_notes"
              name="credit_notes"
              type="text"
              autoComplete="off"
              placeholder="Optional — e.g. regular guest, will settle Friday"
              value={creditNotes}
              onChange={(e) => setCreditNotes(e.target.value)}
            />
          </div>

          {/* The maths, spelled out, so the cashier can check it against the cash
              in their hand before committing. */}
          <div
            className="rounded-lg border px-4 py-3 flex flex-col gap-1.5"
            style={{ background: "#fff7ed", borderColor: "#f9731644" }}
          >
            <div className="flex items-center justify-between text-sm">
              <span style={{ color: "#9a3412" }}>Bill total</span>
              <span className="tabular" style={{ color: "#9a3412" }}>₹{total.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span style={{ color: "#9a3412" }}>Paying now</span>
              <span className="tabular" style={{ color: "#9a3412" }}>− ₹{paidNowNum.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between pt-1.5 border-t" style={{ borderColor: "#f9731633" }}>
              <span className="text-sm font-medium" style={{ color: "#9a3412" }}>Goes on credit</span>
              <span className="text-lg font-medium tabular" style={{ color: "#9a3412" }}>
                ₹{creditAmount.toFixed(2)}
              </span>
            </div>
          </div>

          {paidNow !== "" && !paidNowValid && (
            <p className="text-xs" style={{ color: "var(--color-ruby)" }}>
              {paidNowNum >= total
                ? `That settles the whole bill — use Cash, Online or Card instead.`
                : `Enter an amount between ₹0 and ₹${total.toFixed(2)}.`}
            </p>
          )}
        </div>
      )}

      {errorMsg && (
        <p className="text-sm rounded-md px-3 py-2" style={{ color: "var(--color-ruby)", background: "#fff0f4" }}>
          {errorMsg}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={!canSubmit}>
        {pending
          ? "Closing…"
          : method === "credit"
          ? `Close & record ₹${creditAmount.toFixed(0)} credit`
          : "Complete & close session"}
      </Button>
    </form>
  );
}

export function SessionClient({
  session,
  restaurant,
  staffName = "",
  canCreateOrders = false,
  canCloseBills = false,
  canForceClose = false,
  canSeePIN = true,
  canUseCredit = false,
}: {
  session: SessionDetail;
  restaurant: RestaurantInfo;
  staffName?: string;
  canCreateOrders?: boolean;
  canCloseBills?: boolean;
  canForceClose?: boolean;
  canSeePIN?: boolean;
  canUseCredit?: boolean;
}) {
  const [forceClosing, startForceClose] = useTransition();
  const [forceError, setForceError] = useState<string | null>(null);
  const hasOrders = session.items.length > 0;
  const pendingItems = session.items.filter((i) => i.item_status !== "served");
  const servedItems  = session.items.filter((i) => i.item_status === "served");
  const isClosed     = session.status === "closed";
  const locationLabel = session.table_number
    ? `Table ${session.table_number}`
    : session.room_number
    ? `Room ${session.room_number}`
    : session.type === "walk_in"
    ? "Walk-in"
    : null;

  return (
    <div className="flex flex-col gap-5 max-w-lg">
      {/* Location label */}
      {locationLabel && (
        <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>{locationLabel}</p>
      )}

      {/* Customer ordering PIN */}
      {!isClosed && canSeePIN && session.customer_pin && (
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-xl border"
          style={{ background: "#fef9c3", borderColor: "#ca8a0444" }}
        >
          <div className="flex-1">
            <p className="text-xs font-medium" style={{ color: "#854d0e" }}>
              Customer ordering PIN — share with seated customer
            </p>
          </div>
          <div className="flex items-center gap-1">
            {session.customer_pin.split("").map((d, i) => (
              <div
                key={i}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-base font-bold"
                style={{ background: "#fff", color: "#854d0e", border: "1px solid #ca8a0444" }}
              >
                {d}
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Items */}
      {session.items.length === 0 ? (
        <div
          className="rounded-xl border px-6 py-8 text-center"
          style={{ borderStyle: "dashed", borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
        >
          <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
            No items yet.
          </p>
        </div>
      ) : (
        <div
          className="rounded-xl border overflow-hidden"
          style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
        >
          {pendingItems.map((i) => <OrderItem key={i.id} item={i} sessionId={session.id} />)}
          {servedItems.length > 0 && pendingItems.length > 0 && (
            <div className="px-4 py-1.5 border-t" style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}>
              <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Served</p>
            </div>
          )}
          {servedItems.map((i) => <OrderItem key={i.id} item={i} sessionId={session.id} />)}
          {/* Total */}
          <div
            className="flex justify-between px-4 py-3 border-t"
            style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}
          >
            <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>Total</span>
            <span className="text-sm font-medium tabular" style={{ color: "var(--color-ink)" }}>
              ₹{session.total.toFixed(0)}
            </span>
          </div>
        </div>
      )}

      {/* Actions */}
      {!isClosed && (
        <>
          {canCreateOrders && (
            <Link href={`/employee/session/${session.id}/add`}>
              <Button variant="secondary" className="w-full flex items-center justify-center gap-2">
                <Plus size={14} />
                Add items
              </Button>
            </Link>
          )}

          {/* KOT / Bill printing — for staff with order/billing permissions,
              once the table has at least one order. */}
          {hasOrders && (
            <SessionPrintButtons
              session={session}
              restaurant={restaurant}
              staffName={staffName}
              canPrintKot={canCreateOrders}
              canPrintBill={canCloseBills}
            />
          )}

          {canCloseBills && <PaymentForm session={session} canUseCredit={canUseCredit} />}

          {!canCreateOrders && !canCloseBills && (
            <p className="text-sm text-center py-2" style={{ color: "var(--color-ink-mute)" }}>
              You don't have permission to add items or close this bill.
            </p>
          )}

          {/* Force close / deactivate.
              · Cashier/manager (canForceClose): may close any session.
              · Any assigned staff: may deactivate an EMPTY table (opened by
                mistake). A table with orders is blocked with a clear message. */}
          {hasOrders && !canForceClose ? (
            <div
              className="rounded-xl border px-4 py-3 text-sm"
              style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
            >
              This table contains active orders and can only be closed by the Cashier.
            </div>
          ) : (canForceClose || !hasOrders) ? (
            <>
              <button
                type="button"
                disabled={forceClosing}
                className="w-full rounded-xl border py-3 text-sm font-medium transition-colors disabled:opacity-60"
                style={{ borderColor: "#ef444444", color: "#dc2626", background: "#fff0f0" }}
                onClick={() => {
                  const msg = !hasOrders
                    ? "Deactivate this table? It has no orders and will return to Available immediately."
                    : "Force close this session? Pending notifications will be cleared and the table/room will become available immediately.";
                  if (confirm(msg)) {
                    setForceError(null);
                    startForceClose(async () => {
                      const res = await forceCloseSession(session.id);
                      if (res?.error) setForceError(res.error);
                    });
                  }
                }}
              >
                {forceClosing ? "Closing…" : !hasOrders ? "Deactivate table" : "Force close session"}
              </button>
              {forceError && (
                <p className="text-sm rounded-md px-3 py-2" style={{ color: "var(--color-ruby)", background: "#fff0f4" }}>
                  {forceError}
                </p>
              )}
            </>
          ) : null}
        </>
      )}

      {isClosed && (
        <div
          className="rounded-xl border px-4 py-3 text-center text-sm"
          style={{ borderColor: "#1a7a4a44", background: "#f0fdf4", color: "#1a7a4a" }}
        >
          Session closed
        </div>
      )}
    </div>
  );
}
