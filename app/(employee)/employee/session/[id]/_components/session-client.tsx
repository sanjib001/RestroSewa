"use client";

import { useActionState, useTransition, useState } from "react";
import { closeSessionWithPayment, updateOrderItemStatus, forceCloseSession } from "@/app/actions/pos";
import type { ActionResult, OrderItemRow, SessionDetail } from "@/app/actions/pos";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, ChevronRight, Plus } from "lucide-react";

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

type PaymentMethod = "cash" | "online" | "mixed";

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash",   label: "Cash"   },
  { value: "online", label: "Online" },
  { value: "mixed",  label: "Mixed"  },
];

function PaymentForm({ session }: { session: SessionDetail }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(
    closeSessionWithPayment,
    null
  );
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [cashAmt, setCashAmt]     = useState("");
  const [onlineAmt, setOnlineAmt] = useState("");

  const total = session.total;

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

  const bothFilled  = cashAmt !== "" && onlineAmt !== "";
  const mixedSum    = (parseFloat(cashAmt) || 0) + (parseFloat(onlineAmt) || 0);
  const mixedValid  = method !== "mixed" || (bothFilled && Math.abs(mixedSum - total) < 0.01);
  const canSubmit   = !pending && mixedValid && (method !== "mixed" || bothFilled);

  const errorMsg = state?.error;

  return (
    <form
      action={action}
      className="rounded-xl border px-5 py-5 flex flex-col gap-4"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-primary)", borderWidth: 1.5 }}
    >
      <input type="hidden" name="session_id"    value={session.id} />
      <input type="hidden" name="total_amount"  value={total.toFixed(2)} />

      {/* Pre-computed amounts for cash / online */}
      {method === "cash" && (
        <>
          <input type="hidden" name="cash_amount"   value={total.toFixed(2)} />
          <input type="hidden" name="online_amount" value="0" />
        </>
      )}
      {method === "online" && (
        <>
          <input type="hidden" name="cash_amount"   value="0" />
          <input type="hidden" name="online_amount" value={total.toFixed(2)} />
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
        <div className="flex gap-1">
          {PAYMENT_METHODS.map((m) => {
            const active = method === m.value;
            return (
              <label
                key={m.value}
                className="flex items-center gap-2 cursor-pointer flex-1 justify-center py-2 rounded-lg border text-sm transition-colors"
                style={{
                  borderColor: active ? "var(--color-primary)" : "var(--color-hairline-input)",
                  background:  active ? "rgba(99,102,241,0.06)" : "var(--color-canvas-soft)",
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

      {/* Cash or Online: show total as read-only */}
      {method !== "mixed" && (
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

      {errorMsg && (
        <p className="text-sm rounded-md px-3 py-2" style={{ color: "var(--color-ruby)", background: "#fff0f4" }}>
          {errorMsg}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={!canSubmit}>
        {pending ? "Closing…" : "Complete & close session"}
      </Button>
    </form>
  );
}

export function SessionClient({
  session,
  canCreateOrders = false,
  canCloseBills = false,
  canForceClose = false,
  canSeePIN = true,
}: {
  session: SessionDetail;
  canCreateOrders?: boolean;
  canCloseBills?: boolean;
  canForceClose?: boolean;
  canSeePIN?: boolean;
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

          {canCloseBills && <PaymentForm session={session} />}

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
