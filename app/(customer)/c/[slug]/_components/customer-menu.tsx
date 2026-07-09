"use client";

import { useState, useTransition, useEffect, useCallback, useMemo, useRef } from "react";
import type { CategoryRow, MenuItemRow } from "@/app/actions/menu";
import {
  sendNotification,
  verifyCustomerPin,
  checkSessionActive,
  ensureCustomerSession,
  submitCustomerOrder,
  getCustomerOrderFeed,
  acknowledgeCustomerReady,
} from "@/app/actions/customer";
import type {
  CustomerCartItem,
  CustomerNotifState,
  NotificationStatus,
  CustomerOrder,
  CustomerOrderStatus,
} from "@/app/actions/customer";
import {
  Bell,
  UtensilsCrossed,
  Plus,
  Minus,
  ShoppingBag,
  X,
  Lock,
  Receipt,
  CheckCircle2,
  ChefHat,
  Clock,
  PartyPopper,
} from "lucide-react";

const FOOD_TYPE_CONFIG = {
  veg:     { color: "#1a7a4a", label: "Veg" },
  non_veg: { color: "#c0392b", label: "Non-Veg" },
  vegan:   { color: "#2563eb", label: "Vegan" },
  egg:     { color: "#b45309", label: "Egg" },
} as const;

const POLL_MS = 8000;

// Per-order status presentation for the live tracker.
const ORDER_STATUS_META: Record<
  CustomerOrderStatus,
  { label: string; color: string; bg: string; Icon: React.ComponentType<{ size?: number }> }
> = {
  pending: { label: "Preparing", color: "#b45309", bg: "#fff7ed", Icon: ChefHat },
  ready:   { label: "Ready",     color: "#1a7a4a", bg: "#f0fdf4", Icon: CheckCircle2 },
  served:  { label: "Served",    color: "#64748b", bg: "#f1f5f9", Icon: Receipt },
};

// One-time animation + transition primitives (Tailwind's animate utilities
// aren't configured in this project, so we ship the keyframes inline).
function AnimationStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
@keyframes rs-slide-down { from { opacity:0; transform:translate(-50%,-14px) } to { opacity:1; transform:translate(-50%,0) } }
@keyframes rs-slide-up   { from { opacity:0; transform:translateY(24px) }      to { opacity:1; transform:translateY(0) } }
@keyframes rs-fade       { from { opacity:0 } to { opacity:1 } }
@keyframes rs-pop        { 0% { transform:scale(.9); opacity:0 } 60% { transform:scale(1.03) } 100% { transform:scale(1); opacity:1 } }
@keyframes rs-ring       { 0%,100% { transform:rotate(0) } 20% { transform:rotate(-12deg) } 40% { transform:rotate(10deg) } 60% { transform:rotate(-6deg) } 80% { transform:rotate(4deg) } }
.rs-slide-down { animation: rs-slide-down .32s cubic-bezier(.2,.8,.2,1) both }
.rs-slide-up   { animation: rs-slide-up .28s cubic-bezier(.2,.8,.2,1) both }
.rs-fade       { animation: rs-fade .2s ease both }
.rs-pop        { animation: rs-pop .3s cubic-bezier(.2,.8,.2,1) both }
.rs-ring       { animation: rs-ring 1s ease-in-out infinite }
.rs-press      { transition: transform .12s ease }
.rs-press:active { transform: scale(.94) }
`,
      }}
    />
  );
}

// ─── PIN Entry ─────────────────────────────────────────────────────────────────

function PinEntry({
  sessionId,
  tableId,
  roomId,
  cacheKey,
  onSuccess,
  onClose,
}: {
  sessionId: string | null;
  tableId: string | null;
  roomId: string | null;
  cacheKey: string;
  onSuccess: (resolvedSessionId: string) => void;
  onClose: () => void;
}) {
  const [digits, setDigits] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const addDigit = useCallback(
    async (d: string) => {
      if (verifying) return;
      setError(null);
      const next = [...digits, d];
      setDigits(next);
      if (next.length === 4) {
        setVerifying(true);
        const result = await verifyCustomerPin(sessionId, next.join(""), tableId, roomId);
        if (result.success && result.resolvedSessionId) {
          try {
            localStorage.setItem(`rs_auth_${cacheKey}`, JSON.stringify({ sessionId: result.resolvedSessionId }));
          } catch {
            // storage unavailable — ordering still works for this session
          }
          onSuccess(result.resolvedSessionId);
        } else {
          setDigits([]);
          setError("Incorrect PIN. Please try again.");
          setVerifying(false);
        }
      }
    },
    [digits, verifying, sessionId, tableId, roomId, cacheKey, onSuccess]
  );

  const backspace = useCallback(() => {
    setError(null);
    setDigits((prev) => prev.slice(0, -1));
  }, []);

  const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center rs-fade"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        className="w-full rounded-t-2xl sm:rounded-2xl p-6 flex flex-col gap-5 rs-slide-up"
        style={{ background: "var(--color-canvas)", maxWidth: 400 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-base font-medium" style={{ color: "var(--color-ink)" }}>
              Unlock ordering
            </p>
            <p className="text-sm mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
              Ask your waiter for the 4-digit PIN
            </p>
          </div>
          <button type="button" onClick={onClose} className="rs-press" style={{ color: "var(--color-ink-mute)" }}>
            <X size={18} />
          </button>
        </div>

        <div className="flex justify-center gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="w-12 h-14 rounded-xl flex items-center justify-center text-2xl transition-all"
              style={{
                background: "var(--color-canvas-soft)",
                border: `2px solid ${digits[i] !== undefined ? "var(--color-primary)" : "var(--color-hairline)"}`,
                color: "var(--color-ink)",
                fontWeight: 600,
                transform: digits[i] !== undefined ? "scale(1.04)" : "scale(1)",
              }}
            >
              {digits[i] !== undefined ? "•" : ""}
            </div>
          ))}
        </div>

        {error && (
          <p className="text-center text-sm" style={{ color: "var(--color-ruby)" }}>
            {error}
          </p>
        )}
        {verifying && (
          <p className="text-center text-sm" style={{ color: "var(--color-ink-mute)" }}>
            Verifying…
          </p>
        )}

        <div className="grid grid-cols-3 gap-2">
          {KEYS.map((k, i) =>
            k === "" ? (
              <div key={i} />
            ) : k === "⌫" ? (
              <button
                key="back"
                type="button"
                onClick={backspace}
                disabled={verifying}
                className="h-14 rounded-xl text-xl flex items-center justify-center rs-press"
                style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink)" }}
              >
                ⌫
              </button>
            ) : (
              <button
                key={k}
                type="button"
                onClick={() => addDigit(k)}
                disabled={digits.length >= 4 || verifying}
                className="h-14 rounded-xl text-xl font-medium rs-press"
                style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink)" }}
              >
                {k}
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Order-ready toast ─────────────────────────────────────────────────────────

function ReadyToast({ onOpen, onClose }: { onOpen: () => void; onClose: () => void }) {
  return (
    <div className="fixed top-3 left-1/2 z-[60] w-[min(440px,calc(100vw-24px))] rs-slide-down" style={{ transform: "translateX(-50%)" }}>
      <button
        type="button"
        onClick={onOpen}
        className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left rs-press"
        style={{
          background: "linear-gradient(135deg, #1a7a4a, #15966b)",
          color: "#fff",
          boxShadow: "0 12px 32px rgba(26,122,74,0.4)",
        }}
      >
        <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.2)" }}>
          <PartyPopper size={20} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold">Your order is ready! 🎉</span>
          <span className="block text-xs" style={{ color: "rgba(255,255,255,0.85)" }}>
            Tap to view your order status
          </span>
        </span>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="shrink-0 opacity-80"
        >
          <X size={16} />
        </span>
      </button>
    </div>
  );
}

// ─── Orders sheet (live status) ──────────────────────────────────────────────

function OrderProgress({ status }: { status: CustomerOrderStatus }) {
  // Placed → Preparing → Ready → Served
  const steps = ["Placed", "Preparing", "Ready", "Served"];
  const activeIndex =
    status === "served" ? 3 : status === "ready" ? 2 : 1; // "Placed" always done
  return (
    <div className="flex items-center gap-1 mt-2">
      {steps.map((s, i) => {
        const done = i <= activeIndex;
        return (
          <div key={s} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full h-1 rounded-full" style={{ background: done ? (status === "ready" || status === "served" ? "#1a7a4a" : "#b45309") : "var(--color-hairline)" }} />
            <span className="text-[9px]" style={{ color: done ? "var(--color-ink)" : "var(--color-ink-mute)" }}>{s}</span>
          </div>
        );
      })}
    </div>
  );
}

function OrdersSheet({ orders, onClose }: { orders: CustomerOrder[]; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center rs-fade"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        className="w-full rounded-t-2xl sm:rounded-2xl flex flex-col rs-slide-up"
        style={{ background: "var(--color-canvas)", maxWidth: 480, maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--color-hairline)" }}>
          <div>
            <p className="text-base font-medium" style={{ color: "var(--color-ink)" }}>Your orders</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
              {orders.length} order{orders.length !== 1 ? "s" : ""} · live status
            </p>
          </div>
          <button type="button" onClick={onClose} className="rs-press" style={{ color: "var(--color-ink-mute)" }}>
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-4 flex flex-col gap-3">
          {orders.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: "var(--color-ink-mute)" }}>
              No orders yet. Add items and place your first order!
            </p>
          ) : (
            orders.map((o) => {
              const meta = ORDER_STATUS_META[o.status];
              const time = new Date(o.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
              return (
                <div key={o.id} className="rounded-xl border overflow-hidden rs-pop" style={{ borderColor: meta.color + "44", background: "var(--color-canvas)" }}>
                  <div className="flex items-center gap-3 px-4 py-3" style={{ background: meta.bg }}>
                    <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: "#fff", color: meta.color }}>
                      <meta.Icon size={17} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold" style={{ color: meta.color }}>{meta.label}</p>
                      <p className="text-xs flex items-center gap-1" style={{ color: "var(--color-ink-mute)" }}>
                        <Clock size={10} /> {time}
                      </p>
                    </div>
                    <span className="text-sm font-medium tabular-nums" style={{ color: "var(--color-ink)" }}>₹{o.total.toFixed(0)}</span>
                  </div>
                  <div className="px-4 pt-2 pb-3">
                    {o.items.map((it) => (
                      <div key={it.id} className="flex items-center justify-between py-1">
                        <span className="text-sm" style={{ color: "var(--color-ink)", opacity: it.status === "served" ? 0.55 : 1 }}>
                          {it.quantity > 1 && <span className="text-xs mr-1" style={{ color: "var(--color-ink-mute)" }}>×{it.quantity}</span>}
                          {it.name}
                        </span>
                        <span className="text-xs" style={{ color: ORDER_STATUS_META[it.status].color }}>
                          {ORDER_STATUS_META[it.status].label}
                        </span>
                      </div>
                    ))}
                    <OrderProgress status={o.status} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Notify Bar ────────────────────────────────────────────────────────────────

const NOTIF_LABELS: Record<
  "call_waiter" | "request_bill",
  Record<NonNullable<NotificationStatus>, string>
> = {
  call_waiter: {
    new:          "Waiting for staff…",
    acknowledged: "Staff on the way",
  },
  request_bill: {
    new:          "Bill requested…",
    acknowledged: "Bill being prepared",
  },
};

function NotifyBar({
  restaurantId,
  tableId,
  roomId,
  isRoom,
  sessionId,
  initialNotifState,
}: {
  restaurantId: string;
  tableId: string | null;
  roomId: string | null;
  isRoom: boolean;
  sessionId: string | null;
  initialNotifState: CustomerNotifState;
}) {
  const [notifState, setNotifState] = useState<CustomerNotifState>(initialNotifState);
  const [, start] = useTransition();
  const prevSessionRef = useRef<string | null>(sessionId);

  // When the active session changes (stale-QR scenario: PIN resolves to a newer session
  // than the one fetched at page load), reset to clean state so the new session's
  // notifications start fresh and independent of the previous session.
  useEffect(() => {
    if (sessionId && sessionId !== prevSessionRef.current) {
      setNotifState({ call_waiter: null, request_bill: null });
    }
    prevSessionRef.current = sessionId;
  }, [sessionId]);

  if (!tableId && !roomId) return null;

  function notify(type: "call_waiter" | "request_bill") {
    if (notifState[type]) return;
    start(async () => {
      const result = await sendNotification(restaurantId, tableId, type, roomId);
      if (!result?.error) {
        setNotifState((prev) => ({ ...prev, [type]: "new" }));
      }
    });
  }

  function renderButton(
    type: "call_waiter" | "request_bill",
    icon: React.ReactNode,
    label: string,
    baseStyle: React.CSSProperties
  ) {
    const status = notifState[type];
    const pending = !!status;
    const statusLabel = status ? NOTIF_LABELS[type][status] : null;

    return (
      <button
        type="button"
        onClick={() => notify(type)}
        disabled={pending}
        className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 rounded-xl text-sm font-medium rs-press"
        style={{
          ...baseStyle,
          minHeight: 52,
          opacity: pending ? 0.75 : 1,
          cursor: pending ? "default" : "pointer",
        }}
      >
        <span className="flex items-center gap-1.5">
          {icon}
          {pending ? statusLabel : label}
        </span>
        {pending && (
          <span className="text-xs font-normal" style={{ opacity: 0.65 }}>
            {status === "acknowledged" ? "✓ Accepted" : "pending"}
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-0 left-0 right-0 border-t"
      style={{
        background: "var(--color-canvas)",
        borderColor: "var(--color-hairline)",
        boxShadow: "0 -4px 16px rgba(13,37,61,0.06)",
      }}
    >
      <div className="mx-auto w-full max-w-2xl flex gap-3 px-4 py-3">
        {renderButton(
          "call_waiter",
          <Bell size={14} />,
          isRoom ? "Call staff" : "Call waiter",
          { background: "var(--color-canvas-soft)", color: "var(--color-ink)" }
        )}
        {renderButton(
          "request_bill",
          <UtensilsCrossed size={14} />,
          "Request bill",
          { background: "var(--color-primary)", color: "#fff" }
        )}
      </div>
    </div>
  );
}

// ─── Cart Bar ─────────────────────────────────────────────────────────────────

const NOTIFY_BAR_H = 74; // px: py-3 (24) + min-h-[52px] button
const CART_BAR_H   = 64; // px: py-3 (24) + button height

function CartBar({
  itemCount,
  total,
  onPlace,
  placing,
  success,
  hasNotifyBar,
}: {
  itemCount: number;
  total: number;
  onPlace: () => void;
  placing: boolean;
  success: boolean;
  hasNotifyBar: boolean;
}) {
  if (itemCount === 0 && !success) return null;
  const bottom = hasNotifyBar ? NOTIFY_BAR_H : 0;

  return (
    <div
      className="fixed left-0 right-0 border-t rs-slide-up"
      style={{
        bottom,
        background: "var(--color-primary)",
        borderColor: "rgba(255,255,255,0.15)",
      }}
    >
      <div className="mx-auto w-full max-w-2xl px-4 py-3">
        {success ? (
          <div className="text-center text-sm font-medium flex items-center justify-center gap-2" style={{ color: "#fff" }}>
            <CheckCircle2 size={16} /> Order placed — we&apos;ll have it out shortly!
          </div>
        ) : (
          <button
            type="button"
            onClick={onPlace}
            disabled={placing}
            className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-sm font-medium rs-press"
            style={{ background: "rgba(255,255,255,0.18)", color: "#fff" }}
          >
            <span className="flex items-center gap-2">
              <ShoppingBag size={15} />
              {itemCount} item{itemCount !== 1 ? "s" : ""}
            </span>
            <span>{placing ? "Placing…" : `Place order · ₹${total.toFixed(0)}`}</span>
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Item Card ─────────────────────────────────────────────────────────────────

function ItemCard({
  item,
  cartQty,
  canOrder,
  onAdd,
  onRemove,
}: {
  item: MenuItemRow;
  cartQty: number;
  canOrder: boolean;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const foodCfg = FOOD_TYPE_CONFIG[item.food_type as keyof typeof FOOD_TYPE_CONFIG];
  const hasBadges = item.badges?.length > 0;

  return (
    <div
      className="flex items-start gap-3 px-4 py-3 border-b last:border-0 transition-colors"
      style={{ borderColor: "var(--color-hairline)", background: cartQty > 0 ? "rgba(99,102,241,0.04)" : "transparent" }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-1.5">
          {foodCfg && (
            <span
              title={foodCfg.label}
              className="mt-1 w-2.5 h-2.5 rounded-sm border flex-shrink-0"
              style={{ borderColor: foodCfg.color, background: foodCfg.color + "22" }}
            />
          )}
          <p className="text-sm font-medium leading-snug" style={{ color: "var(--color-ink)" }}>
            {item.name}
          </p>
        </div>
        {hasBadges && (
          <div className="flex flex-wrap gap-1 mt-1">
            {item.badges.map((badge) => (
              <span
                key={badge}
                className="text-xs px-1.5 py-0.5 rounded"
                style={{ background: "#fef9c3", color: "#854d0e", fontSize: 10 }}
              >
                {badge}
              </span>
            ))}
          </div>
        )}
        {item.description && (
          <p className="text-xs mt-0.5 leading-relaxed" style={{ color: "var(--color-ink-mute)" }}>
            {item.description}
          </p>
        )}
        {item.preparation_time && (
          <p className="text-xs mt-0.5 flex items-center gap-1" style={{ color: "var(--color-ink-mute)" }}>
            <Clock size={10} /> ~{item.preparation_time} min
          </p>
        )}
      </div>

      <div className="flex flex-col items-end gap-2 shrink-0 pt-0.5">
        <p className="text-sm tabular-nums" style={{ color: "var(--color-ink)", fontWeight: 400 }}>
          ₹{Number(item.price).toFixed(0)}
        </p>

        {canOrder && (
          cartQty === 0 ? (
            <button
              type="button"
              onClick={onAdd}
              className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium rs-press"
              style={{ background: "var(--color-primary)", color: "#fff" }}
            >
              <Plus size={11} />
              Add
            </button>
          ) : (
            <div className="flex items-center gap-1.5 rounded-full px-1 py-0.5 rs-pop" style={{ background: "var(--color-canvas-soft)" }}>
              <button
                type="button"
                onClick={onRemove}
                className="w-6 h-6 rounded-full flex items-center justify-center rs-press"
                style={{ background: "var(--color-canvas)", color: "var(--color-ink)" }}
              >
                <Minus size={11} />
              </button>
              <span
                className="text-sm w-5 text-center font-semibold"
                style={{ color: "var(--color-primary)" }}
              >
                {cartQty}
              </span>
              <button
                type="button"
                onClick={onAdd}
                className="w-6 h-6 rounded-full flex items-center justify-center rs-press"
                style={{ background: "var(--color-primary)", color: "#fff" }}
              >
                <Plus size={11} />
              </button>
            </div>
          )
        )}
      </div>
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function CustomerMenu({
  restaurantId,
  restaurantName,
  tableId,
  tableNumber,
  roomId,
  roomNumber,
  sessionId: initialSessionId,
  orderingEnabled,
  qrMode,
  categories,
  items,
  initialNotifState,
}: {
  restaurantId: string;
  restaurantName: string;
  tableId: string | null;
  tableNumber: string | null;
  roomId: string | null;
  roomNumber: string | null;
  sessionId: string | null;
  orderingEnabled: boolean;
  qrMode: string;
  categories: CategoryRow[];
  items: MenuItemRow[];
  initialNotifState: CustomerNotifState;
}) {
  const isRoom = !!roomId;
  const contextId = tableId ?? roomId ?? null;
  const locationLabel = tableNumber
    ? `Table ${tableNumber}`
    : roomNumber
    ? `Room ${roomNumber}`
    : null;

  // Track the active session ID in state — it may resolve to a different session than
  // the one fetched at page-load time (e.g. if the waiter closed and re-opened the session)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(initialSessionId);

  // "Without PIN" ordering: same ordering flow, minus the PIN gate.
  const noPin = qrMode === "ordering_no_pin";

  const orderingAvailable =
    orderingEnabled && (qrMode === "ordering_enabled" || noPin) && !!contextId;

  const [activeCategoryId, setActiveCategoryId] = useState<string>(
    categories[0]?.id ?? ""
  );
  // No-PIN restaurants skip the gate entirely — treat ordering as always unlocked.
  const [pinVerified, setPinVerified] = useState(noPin);
  const [showPinEntry, setShowPinEntry] = useState(false);
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [pendingAddItemId, setPendingAddItemId] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(false);

  // Live order tracking + ready alert.
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [showOrders, setShowOrders] = useState(false);
  const [showReadyToast, setShowReadyToast] = useState(false);
  const seenReadyRef = useRef<Set<string>>(new Set());

  // localStorage cache key is based on table or room
  const cacheKey = contextId ?? "";

  const workstationNameMap = useMemo(
    () => new Map<string, string>(categories.map((c) => [c.workstation_id, c.workstation_name ?? ""])),
    [categories]
  );

  // Restore PIN auth from localStorage on mount — use the session ID stored at verification time
  useEffect(() => {
    if (!contextId) return;
    try {
      const stored = localStorage.getItem(`rs_auth_${cacheKey}`);
      if (!stored) return;
      const parsed = JSON.parse(stored) as { sessionId?: string };
      if (!parsed.sessionId) return;
      checkSessionActive(parsed.sessionId).then((r) => {
        if (r.active) {
          setActiveSessionId(parsed.sessionId!);
          setPinVerified(true);
        } else {
          localStorage.removeItem(`rs_auth_${cacheKey}`);
        }
      });
    } catch {
      // ignore
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live poll of the customer's own order feed. Reuses the notification system
  // (polling) — when the kitchen marks an order ready, an order_ready alert lands
  // here within one poll and fires a prominent toast, once.
  useEffect(() => {
    if (!activeSessionId) return;
    let active = true;

    async function poll() {
      try {
        const feed = await getCustomerOrderFeed(activeSessionId);
        if (!active) return;
        setOrders(feed.orders);

        const fresh = feed.ready.filter((r) => !seenReadyRef.current.has(r.id));
        if (fresh.length > 0) {
          fresh.forEach((r) => seenReadyRef.current.add(r.id));
          setShowReadyToast(true);
          // Acknowledge server-side so the alert doesn't re-fire next poll.
          acknowledgeCustomerReady(activeSessionId!, fresh.map((r) => r.id)).catch(() => {});
        }
      } catch {
        // transient — keep last known state
      }
    }

    poll();
    const iv = setInterval(poll, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [activeSessionId]);

  // Auto-dismiss the ready toast.
  useEffect(() => {
    if (!showReadyToast) return;
    const t = setTimeout(() => setShowReadyToast(false), 8000);
    return () => clearTimeout(t);
  }, [showReadyToast]);

  const handleAdd = useCallback(
    (item: MenuItemRow) => {
      if (!orderingAvailable) return;
      if (!pinVerified) {
        setPendingAddItemId(item.id);
        setShowPinEntry(true);
        return;
      }
      setCart((prev) => {
        const next = new Map(prev);
        next.set(item.id, (next.get(item.id) ?? 0) + 1);
        return next;
      });
    },
    [orderingAvailable, pinVerified]
  );

  const handleRemove = useCallback((itemId: string) => {
    setCart((prev) => {
      const next = new Map(prev);
      const qty = (next.get(itemId) ?? 0) - 1;
      if (qty <= 0) next.delete(itemId);
      else next.set(itemId, qty);
      return next;
    });
  }, []);

  const handlePinSuccess = useCallback((resolvedSessionId: string) => {
    setActiveSessionId(resolvedSessionId);
    setPinVerified(true);
    setShowPinEntry(false);
    if (pendingAddItemId) {
      setCart((prev) => {
        const next = new Map(prev);
        next.set(pendingAddItemId, (next.get(pendingAddItemId) ?? 0) + 1);
        return next;
      });
      setPendingAddItemId(null);
    }
  }, [pendingAddItemId]);

  const cartEntries = Array.from(cart.entries());
  const cartTotal = cartEntries.reduce((sum, [id, qty]) => {
    const item = items.find((i) => i.id === id);
    return sum + (item ? Number(item.price) * qty : 0);
  }, 0);
  const cartCount = cartEntries.reduce((sum, [, qty]) => sum + qty, 0);

  async function placeOrder() {
    if (cartCount === 0) return;
    setPlacing(true);

    // No-PIN mode may not have a session yet (customer never entered a PIN and
    // staff may not have opened the table). Resolve or open one on demand.
    let sid = activeSessionId;
    if (!sid && noPin) {
      const resolved = await ensureCustomerSession(restaurantId, tableId, roomId);
      if (resolved.sessionId) {
        sid = resolved.sessionId;
        setActiveSessionId(resolved.sessionId);
      }
    }
    if (!sid) {
      setPlacing(false);
      alert("Couldn't start your order. Please refresh and try again.");
      return;
    }

    const orderItems: CustomerCartItem[] = cartEntries.flatMap(([id, qty]) => {
      const item = items.find((i) => i.id === id);
      if (!item) return [];
      return [{
        menu_item_id: id,
        item_name: item.name,
        item_price: Number(item.price),
        workstation_id: item.workstation_id,
        workstation_name: workstationNameMap.get(item.workstation_id) ?? "",
        quantity: qty,
      }];
    });
    const result = await submitCustomerOrder(sid, restaurantId, orderItems);
    if (result.error) {
      alert(result.error);
    } else {
      setCart(new Map());
      setOrderSuccess(true);
      // Refresh the order feed so the new order shows immediately in the tracker.
      getCustomerOrderFeed(sid).then((f) => setOrders(f.orders)).catch(() => {});
      setTimeout(() => setOrderSuccess(false), 5000);
    }
    setPlacing(false);
  }

  const visibleItems = items.filter((i) => i.category_id === activeCategoryId);
  const hasNotifyBar = !!contextId;
  const hasCartBar = orderingAvailable && (cartCount > 0 || orderSuccess);

  let bottomPad = 16;
  if (hasNotifyBar) bottomPad = NOTIFY_BAR_H + 8;
  if (hasCartBar) bottomPad += CART_BAR_H + 8;

  // Order tracker summary for the header pill.
  const activeOrders = orders.filter((o) => o.status !== "served");
  const readyCount = orders.filter((o) => o.status === "ready").length;

  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--color-canvas)", paddingBottom: bottomPad }}
    >
      <AnimationStyles />

      {/* PIN entry overlay */}
      {showPinEntry && orderingAvailable && contextId && (
        <PinEntry
          sessionId={activeSessionId}
          tableId={tableId}
          roomId={roomId}
          cacheKey={cacheKey}
          onSuccess={handlePinSuccess}
          onClose={() => {
            setShowPinEntry(false);
            setPendingAddItemId(null);
          }}
        />
      )}

      {/* Order-ready toast */}
      {showReadyToast && (
        <ReadyToast
          onOpen={() => { setShowReadyToast(false); setShowOrders(true); }}
          onClose={() => setShowReadyToast(false)}
        />
      )}

      {/* Orders sheet */}
      {showOrders && <OrdersSheet orders={orders} onClose={() => setShowOrders(false)} />}

      <div className="mx-auto w-full max-w-2xl">
        {/* Header */}
        <div
          className="px-4 py-5 border-b relative"
          style={{
            borderColor: "var(--color-hairline)",
            background: "linear-gradient(180deg, var(--color-canvas-soft), var(--color-canvas))",
          }}
        >
          {/* Orders pill (top-right) — live status access */}
          {orders.length > 0 && (
            <button
              type="button"
              onClick={() => setShowOrders(true)}
              className="absolute right-3 top-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium rs-press"
              style={{
                background: readyCount > 0 ? "#1a7a4a" : "var(--color-canvas)",
                color: readyCount > 0 ? "#fff" : "var(--color-ink)",
                border: `1px solid ${readyCount > 0 ? "#1a7a4a" : "var(--color-hairline)"}`,
                boxShadow: "0 2px 8px rgba(13,37,61,0.06)",
              }}
            >
              <Receipt size={13} className={readyCount > 0 ? "rs-ring" : ""} />
              {readyCount > 0
                ? `${readyCount} ready`
                : activeOrders.length > 0
                ? `${activeOrders.length} in progress`
                : "Your orders"}
            </button>
          )}

          <h1
            className="text-xl text-center"
            style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}
          >
            {restaurantName}
          </h1>

          {locationLabel && (
            <p className="text-sm mt-1 font-medium text-center" style={{ color: "var(--color-ink)" }}>
              {locationLabel}
            </p>
          )}

          {contextId && (
            <p className="text-xs mt-0.5 text-center" style={{ color: "var(--color-ink-mute)" }}>
              {orderingAvailable
                ? pinVerified
                  ? "Ordering enabled — add items to your cart below"
                  : `Browse our menu · Ask ${isRoom ? "the front desk" : "your waiter"} for a PIN to order`
                : `Browse our menu · Use the buttons below to call staff`}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
            {contextId && orderingEnabled && qrMode === "view_only" && (
              <div
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs"
                style={{ background: "#f1f5f9", color: "var(--color-ink-mute)" }}
              >
                <Lock size={11} />
                View only — ask {isRoom ? "the front desk" : "your waiter"} to place your order
              </div>
            )}

            {orderingAvailable && !pinVerified && (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs rs-press"
                style={{ background: "rgba(99,102,241,0.08)", color: "var(--color-primary)" }}
                onClick={() => setShowPinEntry(true)}
              >
                <Lock size={11} />
                Enter PIN to order
              </button>
            )}
          </div>
        </div>

        {/* Category tabs */}
        <div
          className="flex gap-1 overflow-x-auto px-4 py-2.5 border-b sticky top-0 z-10"
          style={{
            background: "var(--color-canvas)",
            borderColor: "var(--color-hairline)",
            WebkitOverflowScrolling: "touch",
            scrollbarWidth: "none",
          }}
        >
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveCategoryId(c.id)}
              className="px-3.5 py-1.5 rounded-full text-sm whitespace-nowrap shrink-0 transition-all rs-press"
              style={{
                background:
                  activeCategoryId === c.id ? "var(--color-ink)" : "var(--color-canvas-soft)",
                color: activeCategoryId === c.id ? "#fff" : "var(--color-ink-mute)",
                fontWeight: activeCategoryId === c.id ? 500 : 400,
              }}
            >
              {c.name}
            </button>
          ))}
        </div>

        {/* Items */}
        <div key={activeCategoryId} className="rs-fade">
          {visibleItems.length === 0 ? (
            <p className="text-sm p-6 text-center" style={{ color: "var(--color-ink-mute)" }}>
              No items in this category.
            </p>
          ) : (
            <div
              className="mx-4 mt-3 rounded-xl border overflow-hidden"
              style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
            >
              {visibleItems.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  cartQty={cart.get(item.id) ?? 0}
                  canOrder={orderingAvailable}
                  onAdd={() => handleAdd(item)}
                  onRemove={() => handleRemove(item.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Cart bar (stacked above notify bar) */}
      {orderingAvailable && (
        <CartBar
          itemCount={cartCount}
          total={cartTotal}
          onPlace={placeOrder}
          placing={placing}
          success={orderSuccess}
          hasNotifyBar={hasNotifyBar}
        />
      )}

      {/* Notify bar */}
      <NotifyBar
        restaurantId={restaurantId}
        tableId={tableId}
        roomId={roomId}
        isRoom={isRoom}
        sessionId={activeSessionId}
        initialNotifState={initialNotifState}
      />
    </div>
  );
}
