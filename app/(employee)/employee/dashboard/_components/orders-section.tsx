"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ListOrdered, ChevronDown } from "lucide-react";
import { SECTION_ACCENT } from "@/lib/section-colors";
import { OrdersQueue } from "../../queue/_components/orders-queue";
import type { OrdersStats } from "../../queue/_components/orders-queue";
import type { QueueOrder } from "@/app/actions/pos";

// The Orders dashboard section. Unlike the other cards it self-manages its
// height: collapsed to just the header (a compact "No active orders" state) when
// the live queue is empty, and auto-expanding — with a smooth animation — the
// moment an order arrives. A manual tap can override, but a change in order count
// hands control back to the automatic behavior.
export function OrdersSection({
  initialOrders,
  canManage,
}: {
  initialOrders: QueueOrder[];
  canManage: boolean;
}) {
  const [stats, setStats] = useState<OrdersStats>({ total: initialOrders.length, pending: 0 });
  const [override, setOverride] = useState<boolean | null>(null);
  const [flash, setFlash] = useState(false);
  const prevTotal = useRef(stats.total);
  const seeded = useRef(false);

  const handleStats = useCallback((s: OrdersStats) => setStats(s), []);

  useEffect(() => {
    if (stats.total !== prevTotal.current) {
      // A new order arriving is the alert — flash the header briefly. (We skip
      // the very first stats update so we don't flash for pre-existing orders.)
      if (seeded.current && stats.total > prevTotal.current) setFlash(true);
      seeded.current = true;
      // Order count changed → resume automatic expand/collapse.
      setOverride(null);
      prevTotal.current = stats.total;
    }
  }, [stats.total]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(false), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  const open = override ?? stats.total > 0;
  const hasOrders = stats.total > 0;
  const subtitle = hasOrders
    ? `${stats.pending} pending · live`
    : "No active orders";

  // Orders is a `bare` section, so it hand-rolls the chrome SectionCard gives the others —
  // which means the amber identity has to be applied here too, or Orders would be the one
  // section without a colour.
  const accent = SECTION_ACCENT.orders;

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      // Mirrors SectionCard's top+left accent edges — see the note there.
      style={{
        background: "var(--color-canvas)",
        borderColor: "var(--color-hairline)",
        borderTopColor: accent.color,
        borderTopWidth: 2,
        borderLeftColor: accent.color,
        borderLeftWidth: 3,
      }}
    >
      <button
        type="button"
        onClick={() => setOverride(!open)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 sm:px-5 py-3.5 text-left"
      >
        <span
          className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: accent.soft, color: accent.color }}
        >
          <ListOrdered size={20} strokeWidth={1.9} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-lg font-medium" style={{ color: accent.color }}>Orders</span>
          <span className="block text-sm truncate" style={{ color: "var(--color-ink-mute)" }}>{subtitle}</span>
        </span>
        {flash && (
          <span
            // Green = "something new arrived and it's good news", not the section's amber —
            // this badge is an event, not an identity. Constant green FILL so white text stays
            // readable in dark (st-available flips to a light green white can't sit on).
            className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full animate-pulse"
            style={{ background: "var(--fill-green)", color: "#fff" }}
          >
            New order
          </span>
        )}
        {hasOrders && (
          <span
            // The section's own count badge. Uses the constant amber FILL (not accent.color):
            // in dark the accent flips to a light amber that white text can't sit on.
            className={`shrink-0 min-w-[24px] h-[24px] px-1.5 rounded-full text-sm font-semibold flex items-center justify-center ${flash ? "animate-pulse" : ""}`}
            style={{ background: "var(--fill-amber)", color: "#fff" }}
          >
            {stats.total}
          </span>
        )}
        <ChevronDown
          size={18}
          className="shrink-0 transition-transform duration-300"
          style={{ color: "var(--color-ink-mute)", transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
        />
      </button>

      {/* Animated expand/collapse via the grid-rows 0fr→1fr technique. */}
      <div style={{ display: "grid", gridTemplateRows: open ? "1fr" : "0fr", transition: "grid-template-rows 0.3s ease" }}>
        <div style={{ overflow: "hidden", minHeight: 0 }}>
          <div className="border-t px-3 sm:px-4 py-4" style={{ borderColor: "var(--color-hairline)" }}>
            <OrdersQueue initialOrders={initialOrders} canManage={canManage} onStats={handleStats} />
          </div>
        </div>
      </div>
    </div>
  );
}
