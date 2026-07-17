"use client";

import { useActionState, useEffect, useTransition, useState } from "react";
import {
  closeSessionWithPayment,
  updateOrderItemStatus,
  forceCloseSession,
  cancelOrderItem,
  updateWalkInCustomer,
} from "@/app/actions/pos";
import type { ActionResult, OrderItemRow, SessionDetail } from "@/app/actions/pos";
import { searchCreditCustomers } from "@/app/actions/credits";
import type { CreditCustomer } from "@/app/actions/credits";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, ChevronRight, Plus, Receipt, User, X, Pencil, Lock } from "lucide-react";
import { OrderItem } from "@/app/(employee)/employee/_components/order-item";
import { SessionPrintButtons } from "./print-tickets";
import type { RestaurantInfo, PrintStation } from "./print-tickets";


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
  discountEnabled,
}: {
  session: SessionDetail;
  canUseCredit: boolean;
  /** Whether the restaurant has a discount PIN configured. No PIN = no discounts at all,
   *  so the field isn't shown. The PIN is still verified server-side at payment. */
  discountEnabled: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(
    closeSessionWithPayment,
    null
  );
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [cashAmt, setCashAmt]     = useState("");
  const [onlineAmt, setOnlineAmt] = useState("");
  // Knocked off at payment ("Rs 1020 → just give me 1000"). Everything below tenders,
  // validates and submits against the PAYABLE, never the raw order total.
  const [discountAmt, setDiscountAmt] = useState("");
  // The admin's discount PIN authorizing that reduction. Held only long enough to submit.
  const [discountPin, setDiscountPin] = useState("");

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

  const orderTotal = session.total;
  // Capped at the order total so the payable can never go negative — the server
  // refuses that anyway, but the cashier should see it clamp as they type. With no PIN
  // configured there is no discount to speak of, so it's pinned to 0.
  const discount = discountEnabled
    ? Math.min(Math.max(parseFloat(discountAmt) || 0, 0), orderTotal)
    : 0;
  const payable = Math.max(0, orderTotal - discount);
  // The server is the real gate; this just stops an obviously-incomplete submit.
  const discountPinValid = discount === 0 || /^\d{4}$/.test(discountPin);

  const methods = canUseCredit
    ? PAYMENT_METHODS
    : PAYMENT_METHODS.filter((m) => m.value !== "credit");

  function handleCashChange(val: string) {
    setCashAmt(val);
    const cash = parseFloat(val);
    setOnlineAmt(!isNaN(cash) && cash >= 0 ? Math.max(0, payable - cash).toFixed(2) : "");
  }

  function handleOnlineChange(val: string) {
    setOnlineAmt(val);
    const online = parseFloat(val);
    setCashAmt(!isNaN(online) && online >= 0 ? Math.max(0, payable - online).toFixed(2) : "");
  }

  // A new discount moves the payable, which strands any split already typed against
  // the old one — clear it rather than submit a split that no longer adds up.
  function handleDiscountChange(val: string) {
    setDiscountAmt(val);
    setCashAmt("");
    setOnlineAmt("");
  }

  const bothFilled = cashAmt !== "" && onlineAmt !== "";
  const mixedSum   = (parseFloat(cashAmt) || 0) + (parseFloat(onlineAmt) || 0);
  const mixedValid = method !== "mixed" || (bothFilled && Math.abs(mixedSum - payable) < 0.01);

  // Credit: blank "paid now" means the whole bill goes on credit.
  const paidNowNum   = parseFloat(paidNow) || 0;
  const creditAmount = Math.max(0, payable - paidNowNum);
  const paidNowValid = paidNowNum >= 0 && paidNowNum < payable;
  // Either an existing account is selected, or a new one is being named.
  const customerChosen = !!picked || (creatingNew && custName.trim().length > 0);
  const creditValid = method !== "credit" || (customerChosen && paidNowValid);

  const canSubmit =
    !pending &&
    mixedValid &&
    creditValid &&
    discountPinValid &&
    (method !== "mixed" || bothFilled);

  const errorMsg = state?.error;

  // What the server records as tendered. On a credit bill this is the down
  // payment only — the rest is the credit.
  const tender = {
    cash:   method === "cash"  ? payable : method === "credit" && downTender === "cash"   ? paidNowNum : 0,
    online: method === "online" ? payable : method === "credit" && downTender === "online" ? paidNowNum : 0,
    card:   method === "card"  ? payable : method === "credit" && downTender === "card"   ? paidNowNum : 0,
  };

  return (
    <form
      action={action}
      className="rounded-xl border px-5 py-5 flex flex-col gap-4"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-primary)", borderWidth: 1.5 }}
    >
      <input type="hidden" name="session_id"   value={session.id} />
      {/* `total_amount` is the NET sale — the payable, not the order total. That's the
          figure Sales, Finance and the reports all sum. */}
      <input type="hidden" name="total_amount"    value={payable.toFixed(2)} />
      <input type="hidden" name="discount_amount" value={discount.toFixed(2)} />

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

      {/* Order Total → Discount → Final Payable. Everything below collects against the
          payable, so the cashier sees what they're about to take before choosing how. */}
      <div
        className="rounded-lg px-4 py-3 flex flex-col gap-2"
        style={{ background: "var(--color-canvas-soft)", border: "1px solid var(--color-hairline)" }}
      >
        <div className="flex items-center justify-between text-sm">
          <span style={{ color: "var(--color-ink-mute)" }}>Order total</span>
          <span className="tabular" style={{ color: "var(--color-ink)" }}>₹{orderTotal.toFixed(2)}</span>
        </div>

        {discountEnabled ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="discount_input" className="text-sm shrink-0" style={{ color: "var(--color-ink-mute)" }}>
                Discount (₹)
              </label>
              <Input
                id="discount_input"
                type="number"
                min="0"
                max={orderTotal}
                step="0.01"
                placeholder="0.00"
                value={discountAmt}
                onChange={(e) => handleDiscountChange(e.target.value)}
                className="max-w-[140px] text-right"
              />
            </div>

            {/* Only asked for once there's actually something to authorize. */}
            {discount > 0 && (
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="discount_pin" className="text-sm shrink-0" style={{ color: "var(--color-ink-mute)" }}>
                  Discount PIN
                </label>
                <Input
                  id="discount_pin"
                  name="discount_pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  placeholder="••••"
                  value={discountPin}
                  onChange={(e) => setDiscountPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  className="max-w-[140px] text-right tracking-[0.4em]"
                />
              </div>
            )}
            {discount > 0 && !discountPinValid && (
              <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                Enter the 4-digit discount PIN to authorize this reduction.
              </p>
            )}
          </>
        ) : (
          <div className="flex items-start gap-2">
            <Lock size={13} className="mt-0.5 shrink-0" style={{ color: "var(--color-ink-mute)" }} />
            <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
              Discounts are turned off. Ask your admin to set a discount PIN in Settings.
            </p>
          </div>
        )}

        <div
          className="flex items-center justify-between pt-2 border-t"
          style={{ borderColor: "var(--color-hairline)" }}
        >
          <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>Final payable</span>
          <span className="text-lg font-medium tabular" style={{ color: "var(--color-primary)" }}>
            ₹{payable.toFixed(2)}
          </span>
        </div>
      </div>

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

      {/* Cash / online / card collect the payable in full — the Final payable line above
          already states it, so there's nothing more to show or ask for. */}

      {/* Mixed: two inputs with auto-calculation */}
      {method === "mixed" && (
        <div className="flex flex-col gap-3">
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
                max={payable}
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
                max={payable}
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
              The combined Cash and Online amounts must equal the total payable amount (₹{payable.toFixed(0)}).
            </p>
          )}
          {bothFilled && mixedValid && (
            <p className="text-xs" style={{ color: "var(--color-success)" }}>
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
              style={{ background: "var(--color-success-bg)", borderColor: "color-mix(in srgb, var(--color-success) 27%, transparent)" }}
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
                  <p className="text-xs mt-1" style={{ color: "var(--color-warning)" }}>
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
                        style={{ color: m.balance > 0 ? "var(--color-danger)" : "var(--color-ink-mute)" }}
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
                max={payable}
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
            style={{ background: "var(--color-warning-bg)", borderColor: "color-mix(in srgb, var(--color-warning) 27%, transparent)" }}
          >
            <div className="flex items-center justify-between text-sm">
              <span style={{ color: "var(--color-warning)" }}>Payable</span>
              <span className="tabular" style={{ color: "var(--color-warning)" }}>₹{payable.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span style={{ color: "var(--color-warning)" }}>Paying now</span>
              <span className="tabular" style={{ color: "var(--color-warning)" }}>− ₹{paidNowNum.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between pt-1.5 border-t" style={{ borderColor: "color-mix(in srgb, var(--color-warning) 20%, transparent)" }}>
              <span className="text-sm font-medium" style={{ color: "var(--color-warning)" }}>Goes on credit</span>
              <span className="text-lg font-medium tabular" style={{ color: "var(--color-warning)" }}>
                ₹{creditAmount.toFixed(2)}
              </span>
            </div>
          </div>

          {paidNow !== "" && !paidNowValid && (
            <p className="text-xs" style={{ color: "var(--color-ruby)" }}>
              {paidNowNum >= payable
                ? `That settles the whole bill — use Cash, Online or Card instead.`
                : `Enter an amount between ₹0 and ₹${payable.toFixed(2)}.`}
            </p>
          )}
        </div>
      )}

      {errorMsg && (
        <p className="text-sm rounded-md px-3 py-2" style={{ color: "var(--color-ruby)", background: "var(--color-danger-bg)" }}>
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

// Optional customer details for a walk-in (takeaway / phone / online delivery). Collapsed
// to a summary once filled; editable any time before the bill is closed.
function WalkInCustomerPanel({
  session,
  canEdit,
}: {
  session: SessionDetail;
  canEdit: boolean;
}) {
  const has = !!(session.customer_name || session.customer_phone || session.customer_address);
  const [editing, setEditing] = useState(!has);
  const [state, action, pending] = useActionState<ActionResult, FormData>(updateWalkInCustomer, null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => { if (pending) setSubmitted(true); }, [pending]);
  useEffect(() => {
    if (submitted && !pending && state === null) { setSubmitted(false); setEditing(false); }
  }, [submitted, pending, state]);

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
    >
      <div className="flex items-center gap-2 px-4 py-2.5" style={{ background: "var(--color-canvas-soft)" }}>
        <User size={14} style={{ color: "var(--color-ink-mute)" }} />
        <span className="text-xs font-medium flex-1" style={{ color: "var(--color-ink)" }}>
          Customer details <span style={{ color: "var(--color-ink-mute)" }}>· optional</span>
        </span>
        {canEdit && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs inline-flex items-center gap-1"
            style={{ color: "var(--color-primary)" }}
          >
            <Pencil size={12} /> Edit
          </button>
        )}
      </div>

      {editing && canEdit ? (
        <form action={action} className="px-4 py-3 flex flex-col gap-2">
          <input type="hidden" name="session_id" value={session.id} />
          <Input name="customer_name" defaultValue={session.customer_name ?? ""} placeholder="Customer name" />
          <Input name="customer_phone" defaultValue={session.customer_phone ?? ""} placeholder="Phone number" inputMode="tel" />
          <Input name="customer_address" defaultValue={session.customer_address ?? ""} placeholder="Delivery address" />
          <div className="flex items-center gap-2 mt-1">
            <Button type="submit" variant="primary" disabled={pending} className="text-xs px-3 h-9">
              {pending ? "Saving…" : "Save"}
            </Button>
            {has && (
              <Button type="button" variant="secondary" onClick={() => setEditing(false)} className="text-xs px-3 h-9">
                Cancel
              </Button>
            )}
            {state?.error && <span className="text-xs" style={{ color: "var(--color-ruby)" }}>{state.error}</span>}
          </div>
        </form>
      ) : (
        <div className="px-4 py-3 text-sm" style={{ color: "var(--color-ink)" }}>
          {has ? (
            <div className="flex flex-col gap-0.5">
              {session.customer_name && <span>{session.customer_name}</span>}
              {session.customer_phone && <span style={{ color: "var(--color-ink-mute)" }}>{session.customer_phone}</span>}
              {session.customer_address && <span style={{ color: "var(--color-ink-mute)" }}>{session.customer_address}</span>}
            </div>
          ) : (
            <span style={{ color: "var(--color-ink-mute)" }}>No customer details.</span>
          )}
        </div>
      )}
    </div>
  );
}

export function SessionClient({
  session,
  restaurant,
  staffName = "",
  workstations = [],
  canCreateOrders = false,
  canCloseBills = false,
  canPrintTickets = false,
  canForceClose = false,
  canSeePIN = true,
  canUseCredit = false,
  discountEnabled = false,
  canCancelOrders = false,
}: {
  session: SessionDetail;
  restaurant: RestaurantInfo;
  staffName?: string;
  workstations?: PrintStation[];
  canCreateOrders?: boolean;
  canCloseBills?: boolean;
  /** KOT/BOT printing — a billing/order-management action, not any waiter's. */
  canPrintTickets?: boolean;
  canForceClose?: boolean;
  canSeePIN?: boolean;
  canUseCredit?: boolean;
  discountEnabled?: boolean;
  canCancelOrders?: boolean;
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
          style={{ background: "var(--color-warning-bg)", borderColor: "color-mix(in srgb, var(--color-warning) 27%, transparent)" }}
        >
          <div className="flex-1">
            <p className="text-xs font-medium" style={{ color: "var(--color-warning)" }}>
              Customer ordering PIN — share with seated customer
            </p>
          </div>
          <div className="flex items-center gap-1">
            {session.customer_pin.split("").map((d, i) => (
              <div
                key={i}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-base font-bold"
                style={{ background: "var(--color-warning-bg)", color: "var(--color-warning)", border: "1px solid color-mix(in srgb, var(--color-warning) 27%, transparent)" }}
              >
                {d}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Walk-in customer details — takeaway / phone / delivery. Optional, editable
          until the bill is closed. */}
      {session.type === "walk_in" && (
        <WalkInCustomerPanel session={session} canEdit={canCreateOrders && !isClosed} />
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
          {pendingItems.map((i) => (
            <OrderItem
              key={i.id}
              item={i}
              canCancel={canCancelOrders && !isClosed}
            />
          ))}
          {servedItems.length > 0 && pendingItems.length > 0 && (
            <div className="px-4 py-1.5 border-t" style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}>
              <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Served</p>
            </div>
          )}
          {servedItems.map((i) => <OrderItem key={i.id} item={i} />)}
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

          {/* KOT / BOT / Bill printing — a billing/order-management action (Cashier /
              Receptionist), NOT any waiter, once the table has at least one order.
              KOT lists kitchen-station items, BOT lists bar-station items. */}
          {hasOrders && (
            <SessionPrintButtons
              session={session}
              restaurant={restaurant}
              staffName={staffName}
              workstations={workstations}
              canPrintTickets={canPrintTickets}
              canPrintBill={canCloseBills}
            />
          )}

          {/* This screen is for TABLES and walk-ins only now. A room stay is
              redirected to its own screen before it ever gets here, so there is no
              room branch to handle: the room's orders, KOT and folio all live in
              one place. `closeSessionWithPayment` still refuses a room stay
              server-side, in case anyone posts to it directly. */}
          {canCloseBills && (
            <PaymentForm session={session} canUseCredit={canUseCredit} discountEnabled={discountEnabled} />
          )}

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
                style={{ borderColor: "color-mix(in srgb, var(--color-danger) 27%, transparent)", color: "var(--color-danger)", background: "var(--color-danger-bg)" }}
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
                <p className="text-sm rounded-md px-3 py-2" style={{ color: "var(--color-ruby)", background: "var(--color-danger-bg)" }}>
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
          style={{ borderColor: "color-mix(in srgb, var(--color-success) 27%, transparent)", background: "var(--color-success-bg)", color: "var(--color-success)" }}
        >
          Session closed
        </div>
      )}
    </div>
  );
}
