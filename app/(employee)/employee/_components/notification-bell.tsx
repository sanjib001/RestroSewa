"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  acknowledgeNotification,
  completeNotification,
  getMyNotifications,
} from "@/app/actions/notifications";
import type { NotificationRow } from "@/app/actions/notifications";
import { approveTableActivation, rejectTableActivation } from "@/app/actions/pos";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { Bell, Check, CheckCheck, DoorOpen, Loader2, UtensilsCrossed, X } from "lucide-react";

// Notifications now arrive by push. This is only a safety net in case the SSE
// stream is down (proxy, sleep/resume) — hence the long interval.
const FALLBACK_POLL_MS = 60_000;

const TYPE_CONFIG = {
  call_waiter: { label: "Waiter Call", Icon: Bell, color: "#6366f1" },
  request_bill: { label: "Bill Request", Icon: UtensilsCrossed, color: "#f97316" },
  table_activation_request: {
    label: "Table Activation Request",
    Icon: DoorOpen,
    color: "#0891b2",
  },
} as const;

const rupee = (n: number) => `₹${n.toFixed(0)}`;

function whereOf(n: NotificationRow) {
  if (n.table_number) return `Table ${n.table_number}`;
  if (n.room_number) return `Room ${n.room_number}`;
  return "Walk-in";
}

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

function timeSince(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

// ── One actionable request, with its buttons inline ───────────────────────────

function NotificationCard({
  n,
  busy,
  onAct,
}: {
  n: NotificationRow;
  busy: boolean;
  onAct: (fn: () => Promise<unknown>) => void;
}) {
  const cfg = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.call_waiter;
  const isActivation = n.type === "table_activation_request";
  const acknowledged = n.status === "acknowledged";
  const items = n.order_summary ?? [];

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ background: `${cfg.color}08`, borderColor: `${cfg.color}44` }}
    >
      <div className="flex items-start gap-3 px-3 py-2.5">
        <span
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: `${cfg.color}18`, color: cfg.color }}
        >
          <cfg.Icon size={15} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium" style={{ color: "var(--color-ink)" }}>
            {cfg.label}
          </span>
          <span className="block text-xs" style={{ color: "var(--color-ink-mute)" }}>
            {whereOf(n)} · {timeOf(n.created_at)} · {timeSince(n.created_at)}
            {acknowledged && " · on the way"}
          </span>
        </span>
      </div>

      {/* An activation request shows what the customer is trying to order, so the
          decision can be made without opening anything. */}
      {isActivation && items.length > 0 && (
        <div className="px-3 pb-2">
          <div className="rounded-lg px-3 py-2" style={{ background: "var(--color-canvas)" }}>
            {items.map((it, i) => (
              <div key={i} className="flex items-center justify-between py-0.5 text-xs">
                <span style={{ color: "var(--color-ink)" }}>
                  <span className="mr-1" style={{ color: "var(--color-ink-mute)" }}>×{it.quantity}</span>
                  {it.name}
                </span>
                <span className="tabular-nums" style={{ color: "var(--color-ink-mute)" }}>
                  {rupee(it.price * it.quantity)}
                </span>
              </div>
            ))}
            <div
              className="flex items-center justify-between pt-1.5 mt-1 border-t text-xs font-medium"
              style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
            >
              <span>Total</span>
              <span className="tabular-nums">{rupee(n.order_total ?? 0)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Actions — touch-friendly, and the only place these decisions are made. */}
      <div className="flex items-center gap-2 px-3 pb-3">
        {isActivation ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAct(() => rejectTableActivation(n.id))}
              className="flex-1 flex items-center justify-center gap-1.5 text-sm min-h-[40px] px-3 rounded-lg font-medium border disabled:opacity-50"
              style={{ background: "var(--color-canvas)", color: "#dc2626", borderColor: "#dc262644" }}
            >
              <X size={14} /> Reject
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAct(() => approveTableActivation(n.id))}
              className="flex-1 flex items-center justify-center gap-1.5 text-sm min-h-[40px] px-3 rounded-lg font-medium disabled:opacity-50"
              style={{ background: cfg.color, color: "#fff" }}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Accept
            </button>
          </>
        ) : (
          <>
            {/* A waiter call / bill request can't be "declined" — the customer
                asked. It is acknowledged (staff on the way) then cleared. */}
            {!acknowledged && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onAct(() => acknowledgeNotification(n.id))}
                className="flex-1 flex items-center justify-center gap-1.5 text-sm min-h-[40px] px-3 rounded-lg font-medium disabled:opacity-50"
                style={{ background: cfg.color, color: "#fff" }}
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Accept
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => onAct(() => completeNotification(n.id))}
              className="flex-1 flex items-center justify-center gap-1.5 text-sm min-h-[40px] px-3 rounded-lg font-medium border disabled:opacity-50"
              style={
                acknowledged
                  ? { background: "#1a7a4a", color: "#fff", borderColor: "#1a7a4a" }
                  : { background: "var(--color-canvas)", color: "var(--color-ink-mute)", borderColor: "var(--color-hairline)" }
              }
            >
              <CheckCheck size={14} /> Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── The bell + its dropdown ───────────────────────────────────────────────────

export function NotificationBell({ initialCount = 0 }: { initialCount?: number }) {
  const router = useRouter();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startAction] = useTransition();

  // Which `new` notifications we've already auto-opened for, so the panel doesn't
  // pop open again every poll for the same request.
  const seenIds = useRef<Set<string> | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const bellRef = useRef<HTMLButtonElement | null>(null);

  const newCount = items.filter((n) => n.status === "new").length;
  // Before the first poll lands, trust the server-rendered count.
  const count = seenIds.current === null ? initialCount : newCount;

  const poll = useCallback(async () => {
    try {
      const { items: next } = await getMyNotifications();
      setItems(next);

      const freshIds = next.filter((n) => n.status === "new").map((n) => n.id);

      if (seenIds.current === null) {
        // First poll: don't ambush the staff member with a panel for requests
        // that were already sitting there when they loaded the page.
        seenIds.current = new Set(freshIds);
      } else {
        const unseen = freshIds.filter((id) => !seenIds.current!.has(id));
        if (unseen.length > 0) {
          // A NEW actionable request just arrived — surface it immediately.
          setOpen(true);
          // Sections embedded in the dashboard (tables, orders) may depend on it.
          router.refresh();
        }
        seenIds.current = new Set(freshIds);
      }

      // Nothing left to act on: close the panel rather than leave an empty one.
      if (next.length === 0) setOpen(false);
    } catch {
      // transient network / auth hiccup — keep the last known state
    }
  }, [router]);

  // A notification row changing anywhere fires instantly — no 8s wait for the
  // waiter call to appear.
  useRealtime(["notifications"], poll);

  useEffect(() => {
    poll();
    const iv = setInterval(poll, FALLBACK_POLL_MS);
    return () => clearInterval(iv);
  }, [poll]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || bellRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Run an action, then re-poll so the badge and list update without navigating.
  const act = useCallback(
    (id: string) => (fn: () => Promise<unknown>) => {
      setBusyId(id);
      startAction(async () => {
        try {
          await fn();
        } finally {
          // Drop it locally at once so the panel never shows a stale request…
          setItems((prev) => prev.filter((n) => n.id !== id));
          setBusyId(null);
          // …then reconcile with the server (this also closes an empty panel).
          await poll();
          router.refresh();
        }
      });
    },
    [poll, router]
  );

  return (
    // The anchor for the desktop dropdown. On mobile the panel is `fixed`, so it
    // is pinned to the viewport instead and can never overflow off-screen.
    <div className="relative">
      <button
        ref={bellRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        aria-expanded={open}
        className="relative flex items-center gap-1 px-2 sm:px-3 py-1.5 rounded-lg text-sm transition-colors"
        style={{ color: "rgba(255,255,255,0.85)", background: "rgba(255,255,255,0.08)" }}
      >
        <Bell size={15} strokeWidth={1.5} />
        <span className="hidden sm:inline">Notifications</span>
        {count > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-medium flex items-center justify-center"
            style={{ background: "#ef4444", color: "#fff" }}
          >
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Mobile: a dim backdrop so the sheet reads as a layer, and taps outside
              close it. Desktop keeps the plain anchored dropdown. */}
          <div
            className="sm:hidden fixed inset-0 z-40"
            style={{ background: "rgba(13,37,61,0.35)" }}
            onClick={() => setOpen(false)}
          />

          <div
            ref={panelRef}
            role="dialog"
            aria-label="Notifications"
            className="notif-panel fixed sm:absolute z-50 rounded-2xl border overflow-hidden shadow-lg"
            style={{
              background: "var(--color-canvas)",
              borderColor: "var(--color-hairline)",
              boxShadow: "0 12px 32px rgba(13,37,61,0.18)",
            }}
          >
            <div
              className="flex items-center justify-between px-4 py-2.5 border-b"
              style={{ background: "var(--color-canvas-soft)", borderColor: "var(--color-hairline)" }}
            >
              <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                Notifications
                {items.length > 0 && (
                  <span className="ml-1.5 text-xs font-normal" style={{ color: "var(--color-ink-mute)" }}>
                    {items.length}
                  </span>
                )}
              </p>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="w-7 h-7 rounded-full flex items-center justify-center"
                style={{ background: "var(--color-canvas)", color: "var(--color-ink-mute)" }}
              >
                <X size={14} />
              </button>
            </div>

            <div className="notif-scroll overflow-y-auto p-3 flex flex-col gap-2">
              {items.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
                    All clear — nothing needs you right now.
                  </p>
                </div>
              ) : (
                items.map((n) => (
                  <NotificationCard
                    key={n.id}
                    n={n}
                    busy={busyId === n.id}
                    onAct={act(n.id)}
                  />
                ))
              )}
            </div>
          </div>
        </>
      )}

      {/*
        Desktop/tablet: anchored under the bell, comfortable reading width.
        Mobile: a bottom sheet pinned inside the viewport — it can never render
        off-screen, and it respects the iOS home-indicator safe area.
      */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
.notif-panel {
  left: 8px;
  right: 8px;
  bottom: calc(8px + env(safe-area-inset-bottom, 0px));
  top: auto;
  max-height: calc(100dvh - 72px - env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  animation: notifIn 180ms ease-out;
}
.notif-panel .notif-scroll { max-height: 100%; }
@media (min-width: 640px) {
  .notif-panel {
    left: auto;
    right: 0;
    top: calc(100% + 8px);
    bottom: auto;
    width: min(384px, calc(100vw - 24px));
    max-height: min(70vh, 560px);
    animation: notifDrop 160ms ease-out;
  }
}
@keyframes notifIn {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes notifDrop {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .notif-panel { animation: none; }
}
`,
        }}
      />
    </div>
  );
}
