"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { getMyOrderQueue, updateOrderItemStatus } from "@/app/actions/pos";
import type { QueueOrder, QueueOrderItem } from "@/app/actions/pos";
import { markMyOrdersSeen } from "@/app/actions/notifications";
import { Clock, User } from "lucide-react";

const POLL_MS = 8000;

const STATUS_META: Record<QueueOrder["status"], { label: string; color: string; bg: string }> = {
  pending: { label: "Pending", color: "#f97316", bg: "#fff7ed" },
  ready: { label: "Ready", color: "#1a7a4a", bg: "#f0fdf4" },
  served: { label: "Served", color: "var(--color-ink-mute)", bg: "var(--color-canvas-soft)" },
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
  onUpdate: (id: string, status: "ready" | "served") => void;
  busy: boolean;
}) {
  const next = item.item_status === "pending" ? "ready" : item.item_status === "ready" ? "served" : null;
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
          style={{
            background: next === "ready" ? "#f97316" : "#1a7a4a",
            color: "#fff",
          }}
        >
          {next === "ready" ? "Mark ready" : "Served"}
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
  onUpdate: (id: string, status: "ready" | "served") => void;
  busyItems: Set<string>;
}) {
  const meta = STATUS_META[order.status];
  return (
    <div className="rounded-xl border overflow-hidden" style={{ background: "var(--color-canvas)", borderColor: meta.color + "44" }}>
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
        <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0" style={{ color: meta.color, background: "#fff", border: `1px solid ${meta.color}44` }}>
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

export function OrdersQueue({
  initialOrders,
  canManage,
}: {
  initialOrders: QueueOrder[];
  canManage: boolean;
}) {
  const [orders, setOrders] = useState<QueueOrder[]>(initialOrders);
  const [busyItems, setBusyItems] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();
  const activeRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await getMyOrderQueue();
      if (activeRef.current) setOrders(next);
      // Viewing the queue counts as seeing the new orders, so acknowledge the
      // viewer's new-order alerts — this clears the Orders nav badge. Scoped to
      // the viewer (server-side) by permission + table group + workstation.
      await markMyOrdersSeen();
    } catch {
      // keep last known state on transient failure
    }
  }, []);

  useEffect(() => {
    activeRef.current = true;
    // Mark seen on mount so the badge clears as soon as the queue is opened.
    refresh();
    const iv = setInterval(refresh, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      activeRef.current = false;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const handleUpdate = useCallback((id: string, status: "ready" | "served") => {
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

  const pendingOrders = orders.filter((o) => o.status === "pending");
  const readyOrders = orders.filter((o) => o.status === "ready");

  if (orders.length === 0) {
    return (
      <div
        className="rounded-xl border px-6 py-12 text-center"
        style={{ borderStyle: "dashed", borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
      >
        <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>All clear — no active orders.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {readyOrders.length > 0 && (
        <section>
          <p className="text-xs uppercase tracking-wide mb-2 font-medium" style={{ color: "#1a7a4a", letterSpacing: "0.06em" }}>
            Ready to serve
          </p>
          <div className="flex flex-col gap-3">
            {readyOrders.map((o) => (
              <OrderCard key={o.order_id} order={o} canManage={canManage} onUpdate={handleUpdate} busyItems={busyItems} />
            ))}
          </div>
        </section>
      )}

      {pendingOrders.length > 0 && (
        <section>
          <p className="text-xs uppercase tracking-wide mb-2 font-medium" style={{ color: "#f97316", letterSpacing: "0.06em" }}>
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
