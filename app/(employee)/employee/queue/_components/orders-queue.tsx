"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { getMyOrderQueue, updateOrderItemStatus } from "@/app/actions/pos";
import type { QueueOrder, QueueOrderItem } from "@/app/actions/pos";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { Clock, User } from "lucide-react";

// Orders now arrive by push. This is a safety net for a dropped SSE stream only.
const FALLBACK_POLL_MS = 60_000;

// Tokens, not hex. These cards sit on the dashboard, which is dark when dark mode is on — the
// old orange / cream / white literals painted a bright cream header band and a white status
// pill onto a dark card the moment a pending order arrived (the "colour mix-max" bug). The
// warning tokens flip with the theme; `border` uses color-mix so the subtle tinted edge (the
// old alpha-suffixed border) also flips instead of concatenating alpha onto a var(), which isn't a colour.
const STATUS_META: Record<QueueOrder["status"], { label: string; color: string; bg: string; border: string }> = {
  pending: {
    label: "Pending",
    color: "var(--color-warning)",
    bg: "var(--color-warning-bg)",
    border: "color-mix(in srgb, var(--color-warning) 30%, transparent)",
  },
  served: {
    label: "Served",
    color: "var(--color-ink-mute)",
    bg: "var(--color-canvas-soft)",
    border: "var(--color-hairline)",
  },
};

function timeSince(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m ago`;
}

function locationLabel(o: QueueOrder) {
  if (o.table_number) return `Table ${o.table_number}`;
  if (o.room_number) return `Room ${o.room_number}`;
  if (o.session_type === "walk_in") return "Walk-in";
  return "Order";
}

function ItemRow({
  item,
  canManage,
  onUpdate,
  busy,
}: {
  item: QueueOrderItem;
  canManage: boolean;
  onUpdate: (id: string, status: "served") => void;
  busy: boolean;
}) {
  // One tap. There is no middle state to advance through any more: an item is
  // pending until it reaches the guest, and then it is served.
  const next = item.item_status === "pending" ? "served" : null;
  const meta = STATUS_META[item.item_status];

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b last:border-0" style={{ borderColor: "var(--color-hairline)" }}>
      <div className="flex-1 min-w-0">
        <p className="text-sm" style={{ color: "var(--color-ink)", opacity: item.item_status === "served" ? 0.5 : 1 }}>
          {item.quantity > 1 && (
            <span className="mr-1 text-xs font-medium" style={{ color: "var(--color-ink-mute)" }}>×{item.quantity}</span>
          )}
          {item.item_name}
        </p>
        {item.workstation_name && (
          <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>{item.workstation_name}</p>
        )}
        {item.notes && (
          <p className="text-xs italic" style={{ color: "var(--color-ink-mute)" }}>{item.notes}</p>
        )}
      </div>

      <span className="text-xs shrink-0 min-w-[52px] text-center" style={{ color: meta.color }}>
        {meta.label}
      </span>

      {canManage && next ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onUpdate(item.id, next)}
          className="text-xs px-3 py-1.5 rounded-lg font-medium shrink-0 disabled:opacity-50"
          // A SOLID green button with white text — stays a fixed mid-green in both themes on
          // purpose. It must NOT use --color-success/--st-available: those flip to a light green
          // in dark mode (tuned for text), and white text on light green is unreadable. A solid
          // saturated fill reads fine on both a light and a dark card, so it's not the bug here.
          style={{ background: "#1a7a4a", color: "#fff" }}
        >
          Served
        </button>
      ) : (
        <span className="w-[76px] shrink-0" />
      )}
    </div>
  );
}

function OrderCard({
  order,
  canManage,
  onUpdate,
  busyItems,
}: {
  order: QueueOrder;
  canManage: boolean;
  onUpdate: (id: string, status: "served") => void;
  busyItems: Set<string>;
}) {
  const meta = STATUS_META[order.status];
  return (
    <div className="rounded-xl border overflow-hidden" style={{ background: "var(--color-canvas)", borderColor: meta.border }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--color-hairline)", background: meta.bg }}>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
            {locationLabel(order)}
          </p>
          <p className="text-xs flex items-center gap-2 flex-wrap" style={{ color: "var(--color-ink-mute)" }}>
            <span className="inline-flex items-center gap-1"><Clock size={11} />{timeSince(order.created_at)}</span>
            {order.customer_name && (
              <span className="inline-flex items-center gap-1"><User size={11} />{order.customer_name}{order.customer_phone ? ` · ${order.customer_phone}` : ""}</span>
            )}
          </p>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0" style={{ color: meta.color, background: "var(--color-canvas)", border: `1px solid ${meta.border}` }}>
          {meta.label}
        </span>
      </div>

      {/* Items */}
      <div>
        {order.items.map((it) => (
          <ItemRow key={it.id} item={it} canManage={canManage} onUpdate={onUpdate} busy={busyItems.has(it.id)} />
        ))}
      </div>

      {/* Footer total */}
      <div className="flex justify-between px-4 py-2 border-t" style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}>
        <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>{order.items.length} item{order.items.length !== 1 ? "s" : ""}</span>
        <span className="text-xs font-medium tabular-nums" style={{ color: "var(--color-ink)" }}>₹{order.total.toFixed(0)}</span>
      </div>
    </div>
  );
}

export type OrdersStats = { total: number; pending: number };

export function OrdersQueue({
  initialOrders,
  canManage,
  onStats,
}: {
  initialOrders: QueueOrder[];
  canManage: boolean;
  // Reports the live order counts so a parent (the dashboard Orders section) can
  // auto-collapse when empty and expand when orders arrive.
  onStats?: (s: OrdersStats) => void;
}) {
  const [orders, setOrders] = useState<QueueOrder[]>(initialOrders);
  const [busyItems, setBusyItems] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();
  const activeRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await getMyOrderQueue();
      if (activeRef.current) setOrders(next);
    } catch {
      // keep last known state on transient failure
    }
  }, []);

  // A new order, or the kitchen flipping an item to ready/served, lands here
  // immediately instead of up to 8s later.
  useRealtime(["orders"], refresh);

  useEffect(() => {
    activeRef.current = true;
    refresh();
    const iv = setInterval(refresh, FALLBACK_POLL_MS);
    return () => {
      activeRef.current = false;
      clearInterval(iv);
    };
  }, [refresh]);

  const handleUpdate = useCallback((id: string, status: "served") => {
    setBusyItems((prev) => new Set(prev).add(id));
    // Optimistic update
    setOrders((prev) =>
      prev.map((o) => ({
        ...o,
        items: o.items.map((it) => (it.id === id ? { ...it, item_status: status } : it)),
      }))
    );
    startTransition(async () => {
      const res = await updateOrderItemStatus(id, status);
      if (res?.error) {
        // Roll back by refetching the true state.
        await refresh();
      } else {
        await refresh();
      }
      setBusyItems((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    });
  }, [refresh]);

  // The queue only ever holds orders that still have a pending item — an order
  // whose items have all gone out drops off it — so every order here is pending.
  const pendingOrders = orders;

  // Report live counts upward (dashboard uses this to auto-collapse when empty).
  useEffect(() => {
    onStats?.({ total: orders.length, pending: pendingOrders.length });
  }, [orders.length, pendingOrders.length, onStats]);

  if (orders.length === 0) {
    return (
      <div
        className="rounded-xl border px-4 py-6 text-center"
        style={{ borderStyle: "dashed", borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
      >
        <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>No active orders.</p>
      </div>
    );
  }

  // Pending first. It used to be "Ready to serve" on top, because that was the
  // list somebody had to act on; with `ready` gone, the outstanding work IS the
  // pending list, so it takes the top slot.
  return (
    <div className="flex flex-col gap-6">
      {pendingOrders.length > 0 && (
        <section>
          <p className="text-xs uppercase tracking-wide mb-2 font-medium" style={{ color: "var(--color-warning)", letterSpacing: "0.06em" }}>
            Pending
          </p>
          <div className="flex flex-col gap-3">
            {pendingOrders.map((o) => (
              <OrderCard key={o.order_id} order={o} canManage={canManage} onUpdate={handleUpdate} busyItems={busyItems} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
