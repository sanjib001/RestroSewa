"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, useTransition } from "react";
import {
  addRoomAdvance,
  addRoomCharge,
  checkOutRoom,
  removeRoomCharge,
  setRoomPriceShift,
} from "@/app/actions/rooms";
import type { RoomFolioView, RoomAdvance } from "@/app/actions/rooms";
import { removeRoomAdvance, updateRoomAdvance } from "@/app/actions/security";
import { AdvanceFields } from "@/app/(employee)/employee/_components/advance-fields";
import type { AdvanceMethod } from "@/app/(employee)/employee/_components/advance-fields";
import { SecurityPinDialog } from "@/components/security-pin-dialog";
import { PaymentMethodPicker, splitIsValid } from "@/components/ui/payment-method-picker";
import { Input } from "@/components/ui/input";
import { searchCreditCustomers } from "@/app/actions/credits";
import type { CreditCustomer } from "@/app/actions/credits";
import type { SessionDetail } from "@/app/actions/pos";
import { CHARGE_TYPES } from "@/lib/room-billing";
import { useRouter } from "next/navigation";
import { Modal } from "@/app/(admin)/admin/_components/modal";
import { CancelStayForm } from "@/app/(admin)/admin/rooms/_components/cancel-stay-form";
import { formatDateTime } from "@/lib/format-time";
import { Button } from "@/components/ui/button";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { OrderItem } from "@/app/(employee)/employee/_components/order-item";
import { SessionPrintButtons } from "@/app/(employee)/employee/session/[id]/_components/print-tickets";
import type { RestaurantInfo, PrintStation } from "@/app/(employee)/employee/session/[id]/_components/print-tickets";
import { PrintModal, BillTicket, ticketNumber } from "@/app/(employee)/employee/_components/bill-ticket";
import { folioToBill } from "@/lib/billing/room-bill";
import { formatBillNumber, billNumberLabel } from "@/lib/billing/bill-number";
import { billMethodLabel } from "@/lib/billing/payment-method";
import {
  ArrowLeft, BedDouble, Clock, Lock, Pencil, Plus, Printer, Trash2, User, UtensilsCrossed, Wallet, X, XCircle,
} from "lucide-react";

const rupee = (n: number) =>
  "₹" + Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Pinned to the restaurant's zone — a check-in stamp on a bill has to say the
// wall-clock time at the hotel, not the time in whatever region the server is in.
const when = (iso: string) => formatDateTime(iso);

// ─── One line of the bill ────────────────────────────────────────────────────

function Line({
  label, detail, amount, onRemove, muted,
}: {
  label: string;
  detail?: string;
  amount: number;
  onRemove?: () => void;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-3 px-4 py-2.5">
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate" style={{ color: muted ? "var(--color-ink-mute)" : "var(--color-ink)" }}>
          {label}
        </p>
        {detail && (
          <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>{detail}</p>
        )}
      </div>
      <span className="text-sm tabular shrink-0" style={{ color: "var(--color-ink)" }}>
        {rupee(amount)}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          className="p-1 rounded shrink-0"
          style={{ color: "var(--color-ink-mute)" }}
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}

function GroupHeader({ icon, title, total }: { icon: React.ReactNode; title: string; total: string }) {
  return (
    <div
      className="flex items-center gap-2 px-4 py-2 border-b"
      style={{ background: "var(--color-canvas-soft)", borderColor: "var(--color-hairline)" }}
    >
      <span style={{ color: "var(--color-ink-mute)" }}>{icon}</span>
      <p className="text-xs uppercase tracking-wide flex-1 font-medium"
         style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
        {title}
      </p>
      <span className="text-xs tabular" style={{ color: "var(--color-ink-mute)" }}>{total}</span>
    </div>
  );
}

// ─── Add an extra (§5 — the future-ready charge types, usable today) ──────────

function AddChargeForm({ stayId, onDone }: { stayId: string; onDone: () => void }) {
  const [state, action, pending] = useActionState(addRoomCharge, null);
  const [type, setType] = useState("laundry");

  useEffect(() => {
    if (state === null && !pending) return;
  }, [state, pending]);

  return (
    <form
      action={async (fd) => {
        await action(fd);
        onDone();
      }}
      className="px-4 py-3 border-t flex flex-col gap-2.5"
      style={{ borderColor: "var(--color-hairline)" }}
    >
      <input type="hidden" name="stay_id" value={stayId} />
      <div className="flex flex-col sm:flex-row gap-2">
        <select
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="h-10 rounded-sm border px-2 text-sm sm:w-40"
          style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
        >
          {CHARGE_TYPES.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
        <input
          name="description"
          placeholder="Note (optional)"
          className="h-10 rounded-sm border px-3 text-sm flex-1"
          style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
        />
        <input
          name="amount"
          type="number"
          min="0.01"
          step="0.01"
          inputMode="decimal"
          placeholder="Amount"
          required
          className="h-10 rounded-sm border px-3 text-sm tabular sm:w-32"
          style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
        />
        <Button type="submit" variant="secondary" disabled={pending} className="shrink-0">
          {pending ? "Adding…" : "Add"}
        </Button>
      </div>
      {state && "error" in state && (
        <p className="text-xs" style={{ color: "var(--color-ruby)" }}>{state.error}</p>
      )}
    </form>
  );
}

// ─── Advance payments ────────────────────────────────────────────────────────

function AddAdvanceForm({ stayId, onDone }: { stayId: string; onDone: () => void }) {
  const [state, action, pending] = useActionState(addRoomAdvance, null);
  const [valid, setValid] = useState(false);

  return (
    <form
      action={async (fd) => {
        await action(fd);
        onDone();
      }}
      className="px-4 py-3 border-t flex flex-col gap-2.5"
      style={{ borderColor: "var(--color-hairline)" }}
    >
      <input type="hidden" name="stay_id" value={stayId} />
      {/* The SAME fields the check-in modal uses, so a deposit taken at the desk and one
          taken three days later cannot validate differently. */}
      <AdvanceFields mode="required" onValidChange={setValid} />
      <div className="flex justify-end">
        <Button type="submit" variant="secondary" disabled={pending || !valid} className="shrink-0">
          {pending ? "Recording…" : "Record advance"}
        </Button>
      </div>
      {state && "error" in state && (
        <p className="text-xs" style={{ color: "var(--color-ruby)" }}>{state.error}</p>
      )}
    </form>
  );
}

/**
 * When this bill next grows a night — and the desk's power to push that later.
 *
 * The single question a receptionist is asked at checkout ("until when can I
 * stay?"), answered by the SAME calculator that charges it. `nextBoundary` comes
 * off the folio, so this can never drift from the amount on the bill; computing
 * it here from the check-in time would be a second implementation of the rule.
 *
 * The shift applies to the whole stay, not just today, which is why the label
 * says "checkout time" rather than "tonight".
 */
function NightBoundary({
  stayId,
  at,
  shiftHours,
  shiftBy,
  canShift,
}: {
  stayId: string;
  at: string;
  shiftHours: number;
  shiftBy: string | null;
  canShift: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const when = new Date(at).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  function save(hours: number) {
    start(async () => {
      const res = await setRoomPriceShift(stayId, hours);
      if (res && "error" in res) setError(res.error);
      else {
        setError(null);
        setEditing(false);
      }
    });
  }

  return (
    <div className="px-4 py-2.5 border-t" style={{ borderColor: "var(--color-hairline)" }}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          <Clock size={11} className="inline mb-0.5 mr-1" />
          Next night starts <strong style={{ color: "var(--color-ink)" }}>{when}</strong>
          {shiftHours > 0 && (
            <>
              {" "}
              (+{shiftHours}h{shiftBy ? `, by ${shiftBy}` : ""})
            </>
          )}
        </p>
        {canShift && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs"
            style={{ color: "var(--color-primary)" }}
          >
            {shiftHours > 0 ? "Change" : "Give more time"}
          </button>
        )}
      </div>

      {editing && (
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <select
            defaultValue={String(shiftHours)}
            onChange={(e) => save(Number(e.target.value))}
            disabled={pending}
            className="h-8 rounded-lg border px-2 text-xs"
            style={{
              borderColor: "var(--color-hairline-input)",
              color: "var(--color-ink)",
              background: "var(--color-canvas)",
            }}
          >
            <option value="0">No extra time</option>
            {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((h) => (
              <option key={h} value={h}>
                +{h} hour{h > 1 ? "s" : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            className="text-xs"
            style={{ color: "var(--color-ink-mute)" }}
          >
            Cancel
          </button>
          {pending && (
            <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
              Saving…
            </span>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs mt-1.5" style={{ color: "var(--color-ruby)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Removing an advance entered in error.
 *
 * Owner-only AND behind the Security PIN, because this rewrites money that has already
 * been counted into a day's cash-in-hand — unlike a tender edit, there is no bill to
 * reconcile the correction against. Every attempt, including a wrong PIN, is logged.
 */
function RemoveAdvanceButton({ advanceId }: { advanceId: string }) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startRemove] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Remove this advance"
        style={{ color: "var(--color-ink-mute)" }}
      >
        <X size={13} />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        placeholder="PIN"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
        className="h-8 w-16 rounded-sm border px-2 text-xs text-right tracking-[0.3em]"
        style={{
          borderColor: "var(--color-hairline-input)",
          background: "var(--color-canvas)",
          color: "var(--color-ink)",
        }}
      />
      <button
        type="button"
        disabled={busy || pin.length !== 4}
        onClick={() =>
          startRemove(async () => {
            const res = await removeRoomAdvance(pin, advanceId);
            if (res && "error" in res) {
              setError(res.error);
              setPin("");
            } else {
              setOpen(false);
              setPin("");
              setError(null);
            }
          })
        }
        className="text-xs px-2 py-1 rounded-pill border"
        style={{ borderColor: "var(--color-ruby)", color: "var(--color-ruby)" }}
      >
        {busy ? "…" : "Remove"}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setPin("");
          setError(null);
        }}
        style={{ color: "var(--color-ink-mute)" }}
      >
        <X size={13} />
      </button>
      {error && (
        <span className="text-xs" style={{ color: "var(--color-ruby)" }}>
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * Correcting an advance already on file — most often the payment method typed
 * wrong at the desk (a deposit that actually arrived online, recorded as cash).
 * Owner-only AND the Security PIN, same lane as removing one: this rewrites
 * money already counted into a day's cash-in-hand, with no bill to reconcile
 * the correction against.
 *
 * A refund row (`amount < 0`) is edited in the same positive numbers a deposit
 * is — the sign is reapplied from the row itself on submit, exactly as
 * `updateExtraExpense` does for a saving withdrawal, so retyping the amount can
 * never flip a deposit into a refund or back by accident.
 */
function EditAdvanceButton({ advance }: { advance: RoomAdvance }) {
  const [open, setOpen] = useState(false);
  const isRefund = advance.amount < 0;
  const magnitude = Math.abs(advance.amount);

  const [amount, setAmount] = useState(String(magnitude));
  const [method, setMethod] = useState<AdvanceMethod>((advance.method as AdvanceMethod) || "cash");
  const [cash, setCash] = useState(advance.method === "mixed" ? String(Math.abs(advance.cash)) : "");
  const [online, setOnline] = useState(advance.method === "mixed" ? String(Math.abs(advance.online)) : "");

  const amountNum = parseFloat(amount) || 0;
  const valid = amountNum > 0 && (method !== "mixed" || splitIsValid("mixed", amountNum, cash, online));

  const openDialog = () => {
    setAmount(String(magnitude));
    setMethod((advance.method as AdvanceMethod) || "cash");
    setCash(advance.method === "mixed" ? String(Math.abs(advance.cash)) : "");
    setOnline(advance.method === "mixed" ? String(Math.abs(advance.online)) : "");
    setOpen(true);
  };

  // Cash / Online / Card for a single method; the two-way split for Mixed.
  const resolvedSplit = () => {
    if (method === "cash") return { cash: amountNum, online: 0, card: 0 };
    if (method === "online") return { cash: 0, online: amountNum, card: 0 };
    if (method === "card") return { cash: 0, online: 0, card: amountNum };
    return { cash: parseFloat(cash) || 0, online: parseFloat(online) || 0, card: 0 };
  };

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        aria-label="Edit this advance"
        style={{ color: "var(--color-ink-mute)" }}
      >
        <Pencil size={13} />
      </button>

      <SecurityPinDialog
        open={open}
        onClose={() => setOpen(false)}
        onSuccess={() => setOpen(false)}
        title={isRefund ? "Edit refund" : "Edit advance"}
        description="Correct the amount or how it was paid — most often the payment method."
        confirmLabel="Save"
        extraValid={valid}
        onConfirm={(pin) => {
          const s = resolvedSplit();
          const sign = isRefund ? -1 : 1;
          return updateRoomAdvance(pin, advance.id, {
            amount: amountNum * sign,
            cash: s.cash * sign,
            online: s.online * sign,
            card: s.card * sign,
            method,
          });
        }}
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span
              className="text-xs uppercase tracking-wide"
              style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
            >
              Amount
            </span>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
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
              setMethod(m as AdvanceMethod);
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
    </>
  );
}

// ─── Check out ───────────────────────────────────────────────────────────────

function CheckOutForm({
  view, canDiscount, canUseCredit, discountEnabled,
}: {
  view: RoomFolioView;
  canDiscount: boolean;
  canUseCredit: boolean;
  /** Whether the restaurant has a discount PIN configured. No PIN = no discounts at all,
   *  so the field isn't shown. The PIN is still verified server-side at checkout. */
  discountEnabled: boolean;
}) {
  const [state, action, pending] = useActionState(checkOutRoom, null);
  const [method, setMethod] = useState<"cash" | "online" | "card" | "mixed" | "credit">("cash");
  const [discount, setDiscount] = useState("");
  // The admin's discount PIN authorizing that reduction. Held only long enough to submit.
  const [discountPin, setDiscountPin] = useState("");
  const [cash, setCash] = useState("");
  const [online, setOnline] = useState("");
  const [paidNow, setPaidNow] = useState("");
  const [downTender, setDownTender] = useState<"cash" | "online" | "card" | "mixed">("cash");
  const [downCash, setDownCash] = useState("");
  const [downOnline, setDownOnline] = useState("");
  // Where an unused deposit goes back. Card is deliberately absent: a swipe cannot be
  // reversed at the desk, so an over-deposit returns as cash, a transfer, or both.
  const [refundTender, setRefundTender] = useState<"cash" | "online" | "mixed">("cash");
  const [refundCash, setRefundCash] = useState("");
  const [refundOnline, setRefundOnline] = useState("");

  // Credit account picker — the same live search the table bill uses, so a
  // returning guest never collects a second credit id.
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CreditCustomer[]>([]);
  const [picked, setPicked] = useState<CreditCustomer | null>(null);
  const [, startSearch] = useTransition();

  useEffect(() => {
    if (method !== "credit" || picked || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      startSearch(async () => setResults(await searchCreditCustomers(query)));
    }, 200);
    return () => clearTimeout(t);
  }, [query, method, picked]);

  const f = view.folio;

  // The subtotal is fixed; the discount is the only thing the cashier moves, so
  // the payable total is recomputed live from it. The SERVER rebuilds this from
  // the database regardless — this is only so the number under the cursor is right.
  // With no PIN configured there is no discount to speak of, so it's pinned to 0.
  const disc = discountEnabled
    ? Math.min(Math.max(parseFloat(discount) || 0, 0), f.subtotal)
    : 0;
  const taxable = f.subtotal - disc;
  const total =
    Math.round((taxable * (1 + f.taxPercent / 100 + f.servicePercent / 100)) * 100) / 100;

  // The deposit already held. `total` remains the SALE — it is what gets recorded and what
  // the discount is measured against — while `balance` is the only figure the cashier
  // collects today. The server re-derives all of this from the database.
  const held = view.advances.reduce((s, a) => s + a.amount, 0);
  const applied = Math.min(Math.max(held, 0), total);
  const balance = Math.round(Math.max(0, total - applied) * 100) / 100;
  const refundDue = Math.round(Math.max(0, held - total) * 100) / 100;

  // How the deposit itself arrived, so the receptionist can see what is actually
  // available to hand back before choosing how to return it.
  const heldCash = view.advances.reduce((s, a) => s + a.cash, 0);
  const heldOnline = view.advances.reduce((s, a) => s + a.online + a.card, 0);

  // Typing one side of a split refund fills the other, exactly as the payment split and
  // the advance fields do. One behaviour, three places — never a third implementation.
  function handleRefundCash(v: string) {
    setRefundCash(v);
    const n = parseFloat(v);
    setRefundOnline(
      !isNaN(n) && n >= 0 ? Math.max(0, Math.round((refundDue - n) * 100) / 100).toFixed(2) : ""
    );
  }
  function handleRefundOnline(v: string) {
    setRefundOnline(v);
    const n = parseFloat(v);
    setRefundCash(
      !isNaN(n) && n >= 0 ? Math.max(0, Math.round((refundDue - n) * 100) / 100).toFixed(2) : ""
    );
  }

  const refundCashNum = parseFloat(refundCash) || 0;
  const refundOnlineNum = parseFloat(refundOnline) || 0;
  const refundSplitOk =
    refundDue === 0 ||
    refundTender !== "mixed" ||
    (refundCash !== "" &&
      refundOnline !== "" &&
      Math.abs(refundCashNum + refundOnlineNum - refundDue) < 0.01);

  // What actually goes to the server. The action re-validates this against the refund it
  // derives from the database, so this only decides WHERE the money goes, never how much.
  const refundSplit =
    refundDue === 0
      ? { cash: 0, online: 0 }
      : refundTender === "cash"
      ? { cash: refundDue, online: 0 }
      : refundTender === "online"
      ? { cash: 0, online: refundDue }
      : { cash: refundCashNum, online: refundOnlineNum };

  // The server is the real gate; this just stops an obviously-incomplete submit.
  const discountPinValid = disc === 0 || /^\d{4}$/.test(discountPin);

  // Typing one half of a Cash + Online split fills the other, so the two always add up to
  // the payable — the same behaviour as the table bill, and as this form's own credit
  // down-payment split. It used to demand both numbers by hand.
  function handleCashChange(val: string) {
    setCash(val);
    const n = parseFloat(val);
    setOnline(!isNaN(n) && n >= 0 ? Math.max(0, Math.round((balance - n) * 100) / 100).toFixed(2) : "");
  }

  function handleOnlineChange(val: string) {
    setOnline(val);
    const n = parseFloat(val);
    setCash(!isNaN(n) && n >= 0 ? Math.max(0, Math.round((balance - n) * 100) / 100).toFixed(2) : "");
  }

  // A new discount moves the payable, which strands any split already typed against the
  // old one — clear it rather than submit a split that no longer adds up.
  function handleDiscountChange(val: string) {
    setDiscount(val);
    setCash("");
    setOnline("");
  }

  const cashNum = parseFloat(cash) || 0;
  const onlineNum = parseFloat(online) || 0;
  const paidNum = parseFloat(paidNow) || 0;
  const downCashNum = parseFloat(downCash) || 0;
  const downOnlineNum = parseFloat(downOnline) || 0;

  // A mixed down payment splits the "paid now" amount across cash and online; the
  // two must add up to it. Mirrors the table checkout's credit flow exactly, and
  // the check_out_room RPC already accepts p_cash/p_online/p_card separately, so no
  // backend change is needed — a mixed down payment just sends both cash and online.
  const downSplitValid =
    downTender !== "mixed" ||
    paidNum === 0 ||
    (downCash !== "" && downOnline !== "" && Math.abs(downCashNum + downOnlineNum - paidNum) < 0.01);

  // Every tender figure below is measured against the BALANCE, not the total: the part of
  // the bill a deposit already covers must not be collected a second time.
  const mixedOk = method !== "mixed" || Math.abs(cashNum + onlineNum - balance) < 0.01;
  const creditOk =
    method !== "credit" ||
    (paidNum >= 0 && paidNum < balance && (!!picked || query.trim().length > 0) && downSplitValid);
  const owed = Math.max(0, balance - paidNum);

  const amounts = {
    cash:
      method === "cash" ? balance
      : method === "mixed" ? cashNum
      : method === "credit" && downTender === "cash" ? paidNum
      : method === "credit" && downTender === "mixed" ? downCashNum
      : 0,
    online:
      method === "online" ? balance
      : method === "mixed" ? onlineNum
      : method === "credit" && downTender === "online" ? paidNum
      : method === "credit" && downTender === "mixed" ? downOnlineNum
      : 0,
    card: method === "card" ? balance : method === "credit" && downTender === "card" ? paidNum : 0,
  };

  type Method = "cash" | "online" | "card" | "mixed" | "credit";
  const METHODS: { key: Method; label: string }[] = [
    { key: "cash", label: "Cash" },
    { key: "online", label: "Online" },
    { key: "card", label: "Card" },
    { key: "mixed", label: "Cash + Online" },
    ...(canUseCredit ? [{ key: "credit" as const, label: "Credit" }] : []),
  ];

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="stay_id" value={view.stay_id} />
      <input type="hidden" name="payment_method" value={method} />
      <input type="hidden" name="discount" value={disc.toFixed(2)} />
      <input type="hidden" name="cash_amount" value={amounts.cash.toFixed(2)} />
      <input type="hidden" name="online_amount" value={amounts.online.toFixed(2)} />
      <input type="hidden" name="card_amount" value={amounts.card.toFixed(2)} />
      {method === "credit" && (
        <>
          <input type="hidden" name="credit_customer_id" value={picked?.id ?? ""} />
          <input type="hidden" name="credit_customer_name" value={picked ? picked.name : query || view.guest_name} />
          <input type="hidden" name="credit_customer_phone" value={picked?.phone ?? view.guest_phone ?? ""} />
        </>
      )}

      {canDiscount && (
        discountEnabled ? (
          <>
            <div>
              <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
                Discount
              </label>
              <input
                type="number"
                min="0"
                max={f.subtotal}
                step="0.01"
                inputMode="decimal"
                value={discount}
                onChange={(e) => handleDiscountChange(e.target.value)}
                placeholder="0.00"
                className="w-full h-10 rounded-sm border px-3 text-sm tabular"
                style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
              />
            </div>

            {/* Only asked for once there's actually something to authorize. */}
            {disc > 0 && (
              <div>
                <label htmlFor="room_discount_pin" className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
                  Discount PIN
                </label>
                <input
                  id="room_discount_pin"
                  name="discount_pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  placeholder="••••"
                  value={discountPin}
                  onChange={(e) => setDiscountPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  className="w-full h-10 rounded-sm border px-3 text-sm text-right tracking-[0.4em]"
                  style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
                />
                {!discountPinValid && (
                  <p className="text-xs mt-1.5" style={{ color: "var(--color-ink-mute)" }}>
                    Enter the 4-digit discount PIN to authorize this reduction.
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex items-start gap-2">
            <Lock size={13} className="mt-0.5 shrink-0" style={{ color: "var(--color-ink-mute)" }} />
            <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
              Discounts are turned off. Ask your admin to set a discount PIN in Settings.
            </p>
          </div>
        )
      )}

      {/* Always submitted, so the action reads a number in both branches. */}
      <input type="hidden" name="refund_cash" value={refundSplit.cash.toFixed(2)} />
      <input type="hidden" name="refund_online" value={refundSplit.online.toFixed(2)} />

      {/* What the deposit already covers. Shown only when there is one, so a stay without
          a deposit looks exactly as it did. */}
      {applied > 0 && (
        <div
          className="flex flex-col gap-1 rounded-lg border px-4 py-3"
          style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}
        >
          <div className="flex items-baseline justify-between">
            <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Bill total</span>
            <span className="text-sm tabular" style={{ color: "var(--color-ink)" }}>{rupee(total)}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Advance received</span>
            <span className="text-sm tabular" style={{ color: "var(--color-ink)" }}>
              - {rupee(applied)}
            </span>
          </div>
        </div>
      )}

      {refundDue > 0 ? (
        // The deposit overshot the bill. There is nothing to collect — the money goes back.
        <>
          <div
            className="flex items-baseline justify-between rounded-lg border px-4 py-3"
            style={{ borderColor: "var(--color-amber)", background: "rgba(245,158,11,0.06)" }}
          >
            <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>Refund due</span>
            <span className="text-xl tabular" style={{ color: "var(--color-ink)", fontWeight: 300 }}>
              {rupee(refundDue)}
            </span>
          </div>
          {/* How the deposit actually arrived. A receptionist about to hand ₹1,500 back
              needs to know only ₹1,000 of it ever came in as cash. */}
          <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
            Held as {rupee(heldCash)} cash
            {heldOnline > 0 ? ` + ${rupee(heldOnline)} online` : ""}
          </p>

          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["cash", "Refund Cash"],
                ["online", "Refund Online"],
                ["mixed", "Cash + Online"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setRefundTender(key);
                  setRefundCash("");
                  setRefundOnline("");
                }}
                className="text-xs px-3 py-1.5 rounded-full border transition-colors"
                style={{
                  borderColor: refundTender === key ? "var(--color-primary)" : "var(--color-hairline)",
                  background: refundTender === key ? "var(--color-primary)" : "var(--color-canvas)",
                  color: refundTender === key ? "#fff" : "var(--color-ink)",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {refundTender === "mixed" && (
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["Cash", refundCash, handleRefundCash],
                  ["Online", refundOnline, handleRefundOnline],
                ] as const
              ).map(([label, val, set]) => (
                <div key={label}>
                  <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
                    {label}
                  </label>
                  <input
                    type="number"
                    min="0"
                    max={refundDue}
                    step="0.01"
                    inputMode="decimal"
                    value={val}
                    onChange={(e) => set(e.target.value)}
                    className="w-full h-10 rounded-sm border px-3 text-sm tabular"
                    style={{
                      borderColor: "var(--color-hairline-input)",
                      background: "var(--color-canvas)",
                      color: "var(--color-ink)",
                    }}
                  />
                </div>
              ))}
              {!refundSplitOk && (
                <p className="col-span-2 text-xs" style={{ color: "var(--color-ruby)" }}>
                  Cash and Online must add up to {rupee(refundDue)}.
                </p>
              )}
            </div>
          )}
        </>
      ) : (
        <>
      {/* Payable */}
      <div
        className="flex items-baseline justify-between rounded-lg border px-4 py-3"
        style={{ borderColor: "var(--color-primary)", background: "rgba(99,102,241,0.06)" }}
      >
        <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
          {applied > 0 ? "Balance payable" : "Payable now"}
        </span>
        <span className="text-xl tabular" style={{ color: "var(--color-primary)", fontWeight: 300 }}>
          {rupee(balance)}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {METHODS.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMethod(m.key)}
            className="text-xs px-3 py-1.5 rounded-full border transition-colors"
            style={{
              borderColor: method === m.key ? "var(--color-primary)" : "var(--color-hairline)",
              background: method === m.key ? "var(--color-primary)" : "var(--color-canvas)",
              color: method === m.key ? "#fff" : "var(--color-ink)",
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {method === "mixed" && (
        <div className="grid grid-cols-2 gap-3">
          {/* Type either side; the other fills itself so the two always total the payable. */}
          {([["Cash", cash, handleCashChange], ["Online", online, handleOnlineChange]] as const).map(([label, val, set]) => (
            <div key={label}>
              <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>{label}</label>
              <input
                type="number" min="0" max={balance} step="0.01" inputMode="decimal"
                value={val}
                onChange={(e) => set(e.target.value)}
                className="w-full h-10 rounded-sm border px-3 text-sm tabular"
                style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
              />
            </div>
          ))}
          {!mixedOk && (
            <p className="col-span-2 text-xs" style={{ color: "var(--color-ruby)" }}>
              Cash and Online must add up to {rupee(balance)}.
            </p>
          )}
        </div>
      )}

      {method === "credit" && (
        <div className="flex flex-col gap-3">
          {picked ? (
            <div
              className="flex items-center gap-2 rounded-lg border px-3 py-2"
              style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate" style={{ color: "var(--color-ink)" }}>
                  {picked.name} · {picked.customer_code}
                </p>
                <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                  Already owes {rupee(picked.balance)}
                </p>
              </div>
              <button type="button" onClick={() => { setPicked(null); setQuery(""); }} style={{ color: "var(--color-ink-mute)" }}>
                <X size={14} />
              </button>
            </div>
          ) : (
            <div>
              <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
                Credit account — search an existing customer, or type a name to open a new one
              </label>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={view.guest_name}
                className="w-full h-10 rounded-sm border px-3 text-sm"
                style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
              />
              {results.length > 0 && (
                <div className="mt-1 rounded-lg border divide-y" style={{ borderColor: "var(--color-hairline)" }}>
                  {results.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setPicked(r)}
                      className="w-full text-left px-3 py-2"
                      style={{ borderColor: "var(--color-hairline)" }}
                    >
                      <span className="text-sm block" style={{ color: "var(--color-ink)" }}>{r.name}</span>
                      <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                        {r.customer_code} · owes {rupee(r.balance)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3">
            <div>
              <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>Paid now</label>
              <input
                type="number" min="0" max={balance} step="0.01" inputMode="decimal"
                value={paidNow}
                onChange={(e) => setPaidNow(e.target.value)}
                placeholder="0.00"
                className="w-full h-10 rounded-sm border px-3 text-sm tabular"
                style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
              />
            </div>

            {paidNum > 0 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs block" style={{ color: "var(--color-ink-mute)" }}>Tendered as</label>
                <div className="grid grid-cols-2 gap-1">
                  {([
                    ["cash", "Cash"],
                    ["online", "Online"],
                    ["card", "Card"],
                    ["mixed", "Cash + Online"],
                  ] as const).map(([key, label]) => {
                    const active = downTender === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => { setDownTender(key); setDownCash(""); setDownOnline(""); }}
                        className="py-1.5 rounded-lg border text-sm transition-colors"
                        style={{
                          borderColor: active ? "var(--color-primary)" : "var(--color-hairline-input)",
                          background: active ? "rgba(99,102,241,0.06)" : "var(--color-canvas-soft)",
                          color: "var(--color-ink)",
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                {/* Split the "paid now" amount across cash and online; typing one
                    fills the other so the two always add up to what's being paid. */}
                {downTender === "mixed" && (
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    {(["cash", "online"] as const).map((side) => {
                      const val = side === "cash" ? downCash : downOnline;
                      const setThis = side === "cash" ? setDownCash : setDownOnline;
                      const setOther = side === "cash" ? setDownOnline : setDownCash;
                      return (
                        <div key={side}>
                          <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
                            {side === "cash" ? "Cash" : "Online"}
                          </label>
                          <input
                            type="number" min="0" max={paidNum} step="0.01" inputMode="decimal"
                            value={val}
                            onChange={(e) => {
                              const v = e.target.value;
                              setThis(v);
                              const n = parseFloat(v);
                              setOther(v === "" || isNaN(n) ? "" : String(Math.round((paidNum - n) * 100) / 100 || 0));
                            }}
                            className="w-full h-10 rounded-sm border px-3 text-sm tabular"
                            style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
                          />
                        </div>
                      );
                    })}
                    {!downSplitValid && (
                      <p className="col-span-2 text-xs" style={{ color: "var(--color-ruby)" }}>
                        Cash and Online together must equal {rupee(paidNum)}.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div
            className="flex items-baseline justify-between rounded-lg border px-3 py-2"
            style={{ borderColor: "color-mix(in srgb, var(--color-warning) 27%, transparent)", background: "var(--color-warning-bg)" }}
          >
            <span className="text-sm" style={{ color: "var(--color-warning)" }}>Left on credit</span>
            <span className="text-sm tabular font-medium" style={{ color: "var(--color-warning)" }}>{rupee(owed)}</span>
          </div>
        </div>
      )}
        </>
      )}

      {state && "error" in state && (
        <p className="text-xs" style={{ color: "var(--color-ruby)" }}>{state.error}</p>
      )}

      <Button
        type="submit"
        variant="primary"
        disabled={pending || !mixedOk || !creditOk || !discountPinValid || !refundSplitOk}
        className="w-full"
      >
        {pending
          ? "Checking out…"
          : refundDue > 0
          ? `Check out · refund ${rupee(refundDue)}`
          : `Check out · ${rupee(balance)}`}
      </Button>
    </form>
  );
}

// ─── The folio ───────────────────────────────────────────────────────────────

export function FolioClient({
  view, session, restaurant, staffName, workstations = [],
  canAddCharges, canCreateOrders, canManageOrders, canCancelOrders,
  canCheckOut, canDiscount, canUseCredit, discountEnabled = false,
  canPrintTickets = false, canPrintBill = false,
  canTakeAdvance = false, canEditAdvance = false, canCheckIn = false, canCancelStay = false,
}: {
  view: RoomFolioView;
  /** The stay's session, in the same shape a table's screen uses. */
  session: SessionDetail | null;
  restaurant: RestaurantInfo;
  staffName: string;
  workstations?: PrintStation[];
  canAddCharges: boolean;
  canCreateOrders: boolean;
  canManageOrders: boolean;
  canCancelOrders: boolean;
  canCheckOut: boolean;
  canDiscount: boolean;
  canUseCredit: boolean;
  /** The restaurant has a discount PIN set. No PIN = no discounts, same as a table bill. */
  discountEnabled?: boolean;
  /** KOT/BOT printing — billing/order-management staff only (not waiters). */
  canPrintTickets?: boolean;
  /** Room folio bill printing — billing staff only. */
  canPrintBill?: boolean;
  /** Taking a deposit rides on `check_in`, not a permission of its own. */
  canTakeAdvance?: boolean;
  /** Correcting one is owner-only, and the server also demands the Security PIN. */
  canEditAdvance?: boolean;
  /**
   * Pushing the night boundary later rides on `check_in` — the same right that
   * takes a deposit. It is a routine desk courtesy, and gating it behind a PIN
   * would mean it simply stopped being recorded.
   */
  canCheckIn?: boolean;
  /**
   * Ending the stay WITHOUT billing it. Its own permission — never implied by
   * check-in or checkout, because writing off a guest's bill is a different act
   * from settling one — and the server demands the Security PIN on top.
   */
  canCancelStay?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [addingAdvance, setAddingAdvance] = useState(false);
  const [billOpen, setBillOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const router = useRouter();
  const [removing, startRemove] = useTransition();
  // Stamped once per mount, exactly like the table bill: a Date rebuilt on every render
  // would make the printed time jump while the preview is open.
  const [printedAt] = useState<Date>(() => new Date());
  const f = view.folio;
  const open = view.status === "active";

  // The bill, arranged for the SHARED renderer. Same mapper the paid bill in Sales uses,
  // so the document a guest is shown before paying and the one filed after are one thing.
  const bill = folioToBill({ folio: f, roomType: view.type_name });

  // Once the guest has checked out the SAME document is a receipt, not a bill: it has to
  // say PAID (or what is still owed), how it was tendered and who took the money. It used
  // to keep printing "Status: UNPAID" for a settled stay, because the folio screen had no
  // payment to look at.
  const paid = view.payment;

  // The bill number, resolved exactly as a TABLE bill resolves it: the restaurant's own
  // sequential number (claimed by the session, or stamped on the payment under the older
  // payment-time model), otherwise a derived reference. No room-only numbering scheme —
  // matching the table workflow is the point of this work.
  const seq = session?.bill_number ?? paid?.bill_number ?? null;
  const billRef =
    seq != null
      ? {
          label: billNumberLabel(restaurant.bill_number_label),
          value: formatBillNumber(seq, restaurant.bill_number_pad ?? 0),
        }
      : {
          label: undefined,
          value: paid
            ? `BILL-${paid.payment_id.slice(0, 8).toUpperCase()}`
            : ticketNumber("BILL", view.stay_id, printedAt),
        };

  // The food ordered against this stay — from the room QR, or added by hand. It
  // is ONE list either way; the two were never separate pipelines, they just had
  // separate screens.
  const items = session?.items ?? [];
  const pendingItems = items.filter((i) => i.item_status !== "served");
  const servedItems = items.filter((i) => i.item_status === "served");

  return (
    <div className="max-w-2xl mx-auto px-3 sm:px-5 py-4 pb-16 flex flex-col gap-4">
      {/* A room-service order placed from the guest's phone changes this bill, so
          the folio re-reads itself when orders move — no refresh, no stale total. */}
      <RealtimeRefresh topics={["orders", "tables"]} />

      <Link
        href="/employee/dashboard"
        className="inline-flex items-center gap-1.5 text-sm"
        style={{ color: "var(--color-ink-mute)" }}
      >
        <ArrowLeft size={14} /> Dashboard
      </Link>

      {/* Guest */}
      <div
        className="rounded-2xl border px-5 py-4"
        style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
      >
        <div className="flex items-start gap-3">
          <span
            className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "var(--color-canvas-soft)", color: "var(--color-primary)" }}
          >
            <BedDouble size={19} strokeWidth={1.6} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-base font-medium" style={{ color: "var(--color-ink)" }}>
              Room {view.room_number}
              <span className="text-sm ml-2" style={{ color: "var(--color-ink-mute)" }}>{view.type_name}</span>
            </p>
            <p className="text-sm truncate" style={{ color: "var(--color-ink)" }}>
              <User size={12} className="inline mr-1" style={{ verticalAlign: "-1px" }} />
              {view.guest_name}
              {view.guest_count > 1 && (
                <span style={{ color: "var(--color-ink-mute)" }}> · {view.guest_count} guests</span>
              )}
              {view.guest_phone && (
                <span style={{ color: "var(--color-ink-mute)" }}> · {view.guest_phone}</span>
              )}
            </p>
          </div>
          {!open && (
            <span
              className="text-xs px-2 py-0.5 rounded-full shrink-0"
              style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
            >
              Checked out
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          {[
            ["Check-in", when(f.checkIn)],
            [open ? "Now" : "Check-out", when(f.checkOut)],
            ["Stay", f.duration],
            ["Nights charged", String(f.nights)],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>{label}</p>
              <p className="text-sm" style={{ color: "var(--color-ink)" }}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Orders ───────────────────────────────────────────────────────────
          THE fix. A QR order from the room lands here the moment it is placed,
          and the KOT prints from right here — the same OrderItem rows and the
          same SessionPrintButtons a table uses. Staff no longer go through "Add a
          room-service order" to reach a ticket for food the guest already ordered.
          That page is now only what its name says: for orders taken by phone or
          in person. */}
      {session && (
        <div
          className="rounded-2xl border overflow-hidden"
          style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
        >
          <GroupHeader
            icon={<UtensilsCrossed size={13} />}
            title={
              pendingItems.length > 0
                ? `Orders · ${pendingItems.length} pending`
                : "Orders"
            }
            total={rupee(f.foodTotal)}
          />

          {items.length === 0 ? (
            <p className="px-4 py-2.5 text-xs" style={{ color: "var(--color-ink-mute)" }}>
              No food ordered yet. The guest can order from the room QR, or you can add one.
            </p>
          ) : (
            <>
              {pendingItems.map((i) => (
                <OrderItem key={i.id} item={i} canCancel={canCancelOrders && open} />
              ))}
              {servedItems.length > 0 && pendingItems.length > 0 && (
                <div
                  className="px-4 py-1.5 border-t"
                  style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}
                >
                  <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Served</p>
                </div>
              )}
              {servedItems.map((i) => (
                <OrderItem key={i.id} item={i} />
              ))}
            </>
          )}

          {open && (
            <div
              className="flex flex-col sm:flex-row gap-2 px-4 py-3 border-t"
              style={{ borderColor: "var(--color-hairline)" }}
            >
              {items.length > 0 && (
                <div className="flex-1">
                  <SessionPrintButtons
                    session={session}
                    restaurant={restaurant}
                    staffName={staffName}
                    workstations={workstations}
                    // KOT/BOT is billing/order-management only now — a waiter (who has
                    // create/manage orders) must NOT be able to print kitchen tickets.
                    canPrintTickets={canPrintTickets}
                    // The bill for a room is the FOLIO — room nights, extras and
                    // food together — not the session's food-only total. It prints
                    // from the folio below, so the session's bill ticket is off.
                    canPrintBill={false}
                  />
                </div>
              )}
              {canCreateOrders && (
                <Link href={`/employee/session/${session.id}/add`} className="shrink-0">
                  <Button variant="secondary" className="w-full flex items-center justify-center gap-1.5">
                    <Plus size={13} /> Add order
                  </Button>
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      {/* The bill */}
      <div
        className="rounded-2xl border overflow-hidden"
        style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
      >
        <GroupHeader icon={<BedDouble size={13} />} title="Room" total={rupee(f.roomTotal)} />
        <Line label={f.room.label} detail={f.room.detail} amount={f.room.amount} />
        {/* When this bill next grows, and the courtesy that can push it later.
            Directly under the room charge because that is the number it explains. */}
        {open && f.nextBoundary && (
          <NightBoundary
            stayId={view.stay_id}
            at={f.nextBoundary}
            shiftHours={view.priceShiftHours}
            shiftBy={view.priceShiftBy}
            canShift={canCheckIn}
          />
        )}

        <GroupHeader
          icon={<Plus size={13} />}
          title="Extras & services"
          total={rupee(f.extrasTotal)}
        />
        {f.extras.length === 0 ? (
          <p className="px-4 py-2.5 text-xs" style={{ color: "var(--color-ink-mute)" }}>
            Nothing added.
          </p>
        ) : (
          f.extras.map((l) => (
            <Line
              key={l.key}
              label={l.label}
              detail={l.detail}
              amount={l.amount}
              onRemove={
                canAddCharges && open
                  ? () => startRemove(async () => { await removeRoomCharge(l.key); })
                  : undefined
              }
            />
          ))
        )}
        {canAddCharges && open && (
          adding ? (
            <AddChargeForm stayId={view.stay_id} onDone={() => setAdding(false)} />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              disabled={removing}
              className="w-full flex items-center gap-1.5 px-4 py-2.5 text-xs border-t"
              style={{ color: "var(--color-primary)", borderColor: "var(--color-hairline)" }}
            >
              <Plus size={13} /> Add a charge
            </button>
          )
        )}

        {/* Food, as a bill LINE — the working list, with its serve and cancel
            controls, lives in the Orders card above. It used to be listed here
            instead, read-only, with the only way through to the real thing being
            a link that said "Add a room-service order". */}
        <GroupHeader
          icon={<UtensilsCrossed size={13} />}
          title="Food & beverage"
          total={rupee(f.foodTotal)}
        />
        {f.food.length === 0 ? (
          <p className="px-4 py-2.5 text-xs" style={{ color: "var(--color-ink-mute)" }}>
            No orders on this room.
          </p>
        ) : (
          f.food.map((l) => <Line key={l.key} label={l.label} detail={l.detail} amount={l.amount} />)
        )}

        {/* Totals */}
        <div className="border-t" style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}>
          <Line label="Subtotal" amount={f.subtotal} muted />
          {f.discount > 0 && <Line label="Discount" amount={-f.discount} muted />}
          {f.tax > 0 && <Line label={`Tax (${f.taxPercent}%)`} amount={f.tax} muted />}
          {f.service > 0 && <Line label={`Service charge (${f.servicePercent}%)`} amount={f.service} muted />}
          <div
            className="flex items-baseline justify-between px-4 py-3 border-t"
            style={{ borderColor: "var(--color-hairline)" }}
          >
            <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>Grand total</span>
            <span className="text-lg tabular" style={{ color: "var(--color-ink)", fontWeight: 400 }}>
              {rupee(f.grandTotal)}
            </span>
          </div>

          {/* A deposit is a PAYMENT against the bill, so it sits below the grand total
              rather than reducing it — the sale recorded at checkout is the whole stay. */}
          {f.advancePaid > 0 && (
            <>
              <Line label="Advance received" amount={-f.advancePaid} muted />
              <div
                className="flex items-baseline justify-between px-4 py-3 border-t"
                style={{ borderColor: "var(--color-hairline)" }}
              >
                <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                  {f.refundDue > 0 ? "Refund due" : "Balance payable"}
                </span>
                <span
                  className="text-lg tabular"
                  style={{ color: "var(--color-primary)", fontWeight: 400 }}
                >
                  {rupee(f.refundDue > 0 ? f.refundDue : f.balanceDue)}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Advance payments — the deposits taken against this stay. Money in, before there
          is a sale, so it belongs beside the folio rather than inside it. */}
      {(view.advances.length > 0 || (open && canTakeAdvance)) && (
        <div
          className="rounded-2xl border overflow-hidden"
          style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
        >
          <GroupHeader
            icon={<Wallet size={13} />}
            title="Advance payments"
            total={rupee(f.advancePaid)}
          />
          {view.advances.length === 0 ? (
            <p className="px-4 py-2.5 text-xs" style={{ color: "var(--color-ink-mute)" }}>
              No advance taken for this stay.
            </p>
          ) : (
            view.advances.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-2 px-4 py-2.5 border-t"
                style={{ borderColor: "var(--color-hairline)" }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm" style={{ color: "var(--color-ink)" }}>
                    {/* A negative row is a refund handed back, not a deposit taken. */}
                    {a.amount < 0 ? "Refund returned" : "Advance"}
                    <span className="text-xs ml-1.5" style={{ color: "var(--color-ink-mute)" }}>
                      {billMethodLabel(a.method)}
                    </span>
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                    {when(a.created_at)}
                    {a.note ? ` · ${a.note}` : ""}
                  </p>
                </div>
                <span className="text-sm tabular" style={{ color: "var(--color-ink)" }}>
                  {rupee(a.amount)}
                </span>
                {open && canEditAdvance && (
                  <div className="flex items-center gap-2">
                    <EditAdvanceButton advance={a} />
                    <RemoveAdvanceButton advanceId={a.id} />
                  </div>
                )}
              </div>
            ))
          )}

          {open && canTakeAdvance && (
            addingAdvance ? (
              <AddAdvanceForm stayId={view.stay_id} onDone={() => setAddingAdvance(false)} />
            ) : (
              <button
                type="button"
                onClick={() => setAddingAdvance(true)}
                className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs border-t"
                style={{ borderColor: "var(--color-hairline)", color: "var(--color-primary)" }}
              >
                <Plus size={13} /> Take an advance
              </button>
            )
          )}
        </div>
      )}

      {open && f.open && (
        <p className="text-xs text-center" style={{ color: "var(--color-ink-mute)" }}>
          The room charge is billed to right now, and grows by one night every 24 hours.
        </p>
      )}

      {/* Check out */}
      {open && canCheckOut && (
        <div
          className="rounded-2xl border px-5 py-4"
          style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
        >
          <p className="text-sm font-medium mb-3" style={{ color: "var(--color-ink)" }}>
            Check out &amp; settle
          </p>
          <CheckOutForm
            view={view}
            canDiscount={canDiscount}
            canUseCredit={canUseCredit}
            discountEnabled={discountEnabled}
          />
        </div>
      )}

      {/* Cancel the stay — ends it WITHOUT billing it and settles the deposit.
          Its own permission, never implied by check-in or checkout, and the
          server demands the Security PIN on top. Placed under checkout, not
          beside it: cancelling is the exception, and it should not sit where a
          receptionist's hand goes for the everyday action. */}
      {open && canCancelStay && (
        <div
          className="rounded-2xl border px-5 py-4"
          style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
        >
          <p className="text-sm font-medium mb-1" style={{ color: "var(--color-ink)" }}>
            Cancel this stay
          </p>
          <p className="text-xs mb-3" style={{ color: "var(--color-ink-mute)" }}>
            The guest is not staying. Writes off the bill so far and refunds the deposit — or keeps
            part of it as a cancellation charge.
          </p>
          <Button type="button" variant="secondary" size="sm" onClick={() => setCancelling(true)}>
            <XCircle size={14} /> Cancel stay
          </Button>
        </div>
      )}

      <Modal
        open={cancelling}
        title="Cancel this stay"
        subtitle="Ends the stay without billing it, and settles the deposit"
        onClose={() => setCancelling(false)}
      >
        <CancelStayForm
          target={{
            stayId: view.stay_id,
            roomNumber: view.room_number,
            guestName: view.guest_name,
            runningTotal: f.grandTotal,
            nights: f.nights,
            // The stay's SIGNED advance rows, netted — a refund is negative, so
            // this is what is actually still held, not what was ever taken.
            advanceHeld: view.advances.reduce((s, a) => s + a.amount, 0),
            advanceCash: view.advances.reduce((s, a) => s + a.cash, 0),
            advanceOnline: view.advances.reduce((s, a) => s + a.online + a.card, 0),
          }}
          onDone={() => {
            setCancelling(false);
            router.refresh();
          }}
        />
      </Modal>

      {/* Room folio bill — billing staff only, and printed through the SAME shared
          PrintModal as every other ticket. It used to be a raw window.print() over a
          `hidden print:block` block with no chrome-hiding, so it printed the whole
          screen; and its button was ungated, so anyone could print it. Now it previews
          then prints only the bill. */}
      {canPrintBill && (
        <button
          type="button"
          onClick={() => setBillOpen(true)}
          className="inline-flex items-center justify-center gap-1.5 text-sm px-4 py-2 rounded-pill border"
          style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
        >
          <Printer size={14} /> {paid ? "Print receipt" : "Print bill"}
        </button>
      )}

      {/* THE SAME COMPONENT A TABLE BILL PRINTS. It used to be a hand-built stack of
          TicketLines here, which is how the room bill and the table bill drifted apart —
          different headings, different column layout, no Item/Qty/Rate/Amount grid, and a
          paid room bill in Sales that listed only the food. One renderer, one mapper
          (folioToBill), so the two can no longer disagree. */}
      <PrintModal
        open={billOpen}
        onClose={() => setBillOpen(false)}
        title={paid ? "Room receipt — preview" : "Room bill — preview"}
        paperWidthMm={restaurant.paper_width_mm ?? 80}
      >
        <BillTicket
          restaurant={restaurant}
          billNo={billRef.value}
          billLabel={billRef.label}
          location={`Room ${view.room_number}`}
          // A receipt is stamped when the money moved, not when someone reprinted it.
          at={paid ? new Date(paid.paid_at) : printedAt}
          items={[]}
          sections={bill.sections}
          stay={bill.stay}
          discount={bill.discount}
          // Undefined-equivalent (0) for every stay with no deposit, so those bills print
          // exactly as they did before — and a table bill never passes these at all.
          advancePaid={bill.advancePaid}
          balanceDue={bill.balanceDue}
          payment={
            paid
              ? {
                  method: billMethodLabel(paid.method),
                  cashier: paid.cashier_name,
                  cash: paid.cash,
                  online: paid.online,
                  card: paid.card,
                }
              : undefined
          }
          // Closed with money still owed: the receipt must say so and say how much, or it
          // reads as fully paid. `balance` is the debt NOW, after any later repayments.
          credit={
            paid?.credit
              ? {
                  credit_number: paid.credit.credit_number,
                  customer_name: paid.credit.customer_name,
                  customer_phone: paid.credit.customer_phone,
                  tendered: paid.cash + paid.online + paid.card,
                  balance: paid.credit.balance,
                }
              : null
          }
          customer={{
            name: view.guest_name,
            phone: view.guest_phone,
            address: view.guest_address,
            idType: view.guest_id_type,
            idNumber: view.guest_id_number,
          }}
        />
      </PrintModal>
    </div>
  );
}
