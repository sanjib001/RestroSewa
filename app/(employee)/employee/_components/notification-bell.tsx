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
import { PushPrompt } from "@/components/pwa/push-prompt";
import { formatTime } from "@/lib/format-time";
import { ArrowDown, Bell, Check, CheckCheck, DoorOpen, Loader2, UtensilsCrossed, X } from "lucide-react";

// Notifications now arrive by push. This is only a safety net in case the SSE
// stream is down (proxy, sleep/resume) — hence the long interval.
const FALLBACK_POLL_MS = 60_000;

// How close to the bottom still counts as "watching the newest one".
const BOTTOM_SLACK_PX = 24;

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

function timeSince(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

// ── One actionable request, with its buttons inline ───────────────────────────

function NotificationCard({
  n,
  position,
  busy,
  onAct,
}: {
  n: NotificationRow;
  position: number;
  busy: boolean;
  onAct: (fn: () => Promise<unknown>) => void;
}) {
  const cfg = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.call_waiter;
  const isActivation = n.type === "table_activation_request";
  const acknowledged = n.status === "acknowledged";
  const items = n.order_summary ?? [];

  return (
    // shrink-0 is load-bearing: this card sits in a column inside a height-capped
    // scroll box. Without it the card is a shrinkable flex item, and the browser
    // squashes it to fit rather than letting the list scroll — which is exactly
    // how these cards used to collapse into each other once a few piled up.
    <li
      className="shrink-0 list-none rounded-xl border overflow-hidden"
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
          <span
            className="flex items-center gap-1.5 text-sm font-medium break-words"
            style={{ color: "var(--color-ink)" }}
          >
            {/* Its place in the queue — the whole point of FIFO is that #1 is
                worked first, so say which one that is. */}
            <span
              className="shrink-0 tabular-nums text-[10px] font-semibold w-4 text-center"
              style={{ color: "var(--color-ink-mute)" }}
            >
              {position}
            </span>
            <span className="min-w-0 break-words">{cfg.label}</span>
          </span>
          <span
            className="block text-xs break-words pl-[22px]"
            style={{ color: "var(--color-ink-mute)" }}
          >
            {whereOf(n)} · {formatTime(n.created_at)} · {timeSince(n.created_at)}
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
              <div key={i} className="flex items-start justify-between gap-2 py-0.5 text-xs">
                <span className="min-w-0 break-words" style={{ color: "var(--color-ink)" }}>
                  <span className="mr-1" style={{ color: "var(--color-ink-mute)" }}>×{it.quantity}</span>
                  {it.name}
                </span>
                <span className="shrink-0 tabular-nums" style={{ color: "var(--color-ink-mute)" }}>
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
              className="flex-1 flex items-center justify-center gap-1.5 text-sm min-h-[44px] px-3 rounded-lg font-medium border disabled:opacity-50"
              style={{ background: "var(--color-canvas)", color: "#dc2626", borderColor: "#dc262644" }}
            >
              <X size={14} /> Reject
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAct(() => approveTableActivation(n.id))}
              className="flex-1 flex items-center justify-center gap-1.5 text-sm min-h-[44px] px-3 rounded-lg font-medium disabled:opacity-50"
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
                className="flex-1 flex items-center justify-center gap-1.5 text-sm min-h-[44px] px-3 rounded-lg font-medium disabled:opacity-50"
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
              className="flex-1 flex items-center justify-center gap-1.5 text-sm min-h-[44px] px-3 rounded-lg font-medium border disabled:opacity-50"
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
    </li>
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
  const listRef = useRef<HTMLDivElement | null>(null);

  // Arrivals the staff member has not scrolled down to yet. Held as ids, not a
  // number, so that acting on one (it leaves `items`) also takes it off the
  // counter — a tally would drift.
  const [unreachedIds, setUnreachedIds] = useState<string[]>([]);
  // Ids the panel has already accounted for, and whether the view is parked at
  // the bottom. Refs, because both are read during the layout pass that runs
  // *after* new cards are in the DOM — by then a fresh measurement would say
  // "not at the bottom" simply because the list just grew.
  const knownIds = useRef<Set<string> | null>(null);
  const atBottom = useRef(true);

  const newCount = items.filter((n) => n.status === "new").length;
  // Before the first poll lands, trust the server-rendered count.
  const count = seenIds.current === null ? initialCount : newCount;

  const measureAtBottom = useCallback(() => {
    const el = listRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX;
  }, []);

  const jumpToLatest = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: still ? "auto" : "smooth" });
    atBottom.current = true;
    setUnreachedIds([]);
  }, []);

  const onListScroll = useCallback(() => {
    atBottom.current = measureAtBottom();
    // Reaching the bottom *is* the acknowledgement that they've been seen.
    if (atBottom.current) setUnreachedIds((prev) => (prev.length ? [] : prev));
  }, [measureAtBottom]);

  const poll = useCallback(async () => {
    try {
      const { items: next } = await getMyNotifications();
      setItems(next);

      const freshIds = next.filter((n) => n.status === "new").map((n) => n.id);

      if (seenIds.current === null) {
        // First poll: don't ambush the staff member with a panel for requests
        // that were already sitting there when they loaded the page.
        seenIds.current = new Set(freshIds);
        // Same reasoning for the "N new" pill. The backlog this poll returns was
        // already waiting — it is the queue, not an arrival — so adopt it as the
        // baseline here, at the first poll. Leaving the effect below to seed it
        // would seed from the empty mount render instead, and the whole backlog
        // would then announce itself as new.
        knownIds.current = new Set(next.map((n) => n.id));
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

  // ── Where a fresh open leaves us ────────────────────────────────────────────
  // Declared BEFORE the arrivals effect on purpose: effects run in order, so this
  // has re-measured `atBottom` for the newly-mounted panel before the arrivals
  // effect below consults it. Get that order wrong and a panel that pops open by
  // itself scrolls straight to the newest card — shoving the older, more urgent
  // requests out of view, which is the whole thing we're trying to avoid.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (!el) return;

    // An open lands on the TOP of the queue: scrollTop 0, the oldest request, the
    // one to work first. So if the list overflows we are, correctly, NOT at the
    // bottom — anything that arrived while the panel was shut stays flagged below
    // rather than dragging the view down to itself.
    if (el.scrollHeight - el.clientHeight <= 1) {
      // …unless it all fits, in which case nothing is out of reach.
      atBottom.current = true;
      setUnreachedIds((prev) => (prev.length ? [] : prev));
    } else {
      atBottom.current = measureAtBottom();
    }
    // Deliberately keyed on `open` alone. Re-measuring when a card ARRIVES would
    // be measuring the wrong thing: the list has already grown by then, so a
    // staff member parked at the bottom would suddenly read as "scrolled up" and
    // we'd flag a new arrival instead of following it down. `atBottom` is kept
    // current by the scroll handler; this only re-establishes it on a fresh open.
  }, [open, measureAtBottom]);

  // ── Arrivals and departures ─────────────────────────────────────────────────
  // Runs whether the panel is open or shut: a request that lands while it is shut
  // is still one the staff member has not reached.
  useEffect(() => {
    const ids = items.map((n) => n.id);

    // Nothing to compare against yet (the empty mount render, before the first
    // poll has adopted the backlog as the baseline). Adopt and wait.
    if (knownIds.current === null) {
      knownIds.current = new Set(ids);
      return;
    }

    const added = ids.filter((id) => !knownIds.current!.has(id));
    knownIds.current = new Set(ids);

    // Hold the flag as ids, not a tally: acting on a request takes it out of
    // `items`, and it must come off the counter with it or the count drifts.
    const live = new Set(ids);
    setUnreachedIds((prev) => {
      const next = [...prev.filter((id) => live.has(id)), ...added];
      const same =
        next.length === prev.length && next.every((id, i) => id === prev[i]);
      return same ? prev : next;
    });

    const el = listRef.current;
    if (!open || !el) return;

    // Everything fits: nothing can be below the fold, so there is nothing to
    // chase and nothing to announce.
    if (el.scrollHeight - el.clientHeight <= 1) {
      atBottom.current = true;
      setUnreachedIds([]);
      return;
    }

    // They were already watching the newest card — keep them there. Otherwise they
    // are working older requests, so leave their scroll position alone and let the
    // "N new" pill offer the trip down.
    if (added.length > 0 && atBottom.current) jumpToLatest();
  }, [items, open, jumpToLatest]);

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

  const pendingBelow = unreachedIds.length;

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
            {/* The frame stays put; only the queue between these two edges moves. */}
            <div
              className="shrink-0 flex items-center justify-between gap-2 px-4 py-2.5 border-b"
              style={{ background: "var(--color-canvas-soft)", borderColor: "var(--color-hairline)" }}
            >
              <p className="min-w-0 text-sm font-medium truncate" style={{ color: "var(--color-ink)" }}>
                Notifications
                {items.length > 0 && (
                  <span className="ml-1.5 text-xs font-normal" style={{ color: "var(--color-ink-mute)" }}>
                    {items.length} · oldest first
                  </span>
                )}
              </p>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: "var(--color-canvas)", color: "var(--color-ink-mute)" }}
              >
                <X size={14} />
              </button>
            </div>

            {/* The switch that decides whether this phone rings when the app is shut.
                It belongs HERE, and its absence here was the bug: it used to live only
                on the /employee/notifications page, which staff never open — they tap
                the bell. So the one control that made the whole push system work sat
                on a screen nobody visited, and in production not a single device was
                ever subscribed. It puts itself in front of the person who needs it. */}
            <PushPrompt />

            {/* The scroll viewport. `min-h-0` is what lets a flex child actually be
                shorter than its content — without it the panel grows past its own
                max-height and the browser compresses the cards instead. */}
            <div className="relative flex-1 min-h-0">
              <div
                ref={listRef}
                onScroll={onListScroll}
                className="notif-scroll h-full overflow-y-auto overscroll-contain p-3"
              >
                {items.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
                      All clear — nothing needs you right now.
                    </p>
                  </div>
                ) : (
                  // A plain block scroll box wrapping a content-height column.
                  // Making the SCROLL box itself the flex column is what let the
                  // cards be squeezed instead of scrolled.
                  <ul className="flex flex-col gap-2">
                    {items.map((n, i) => (
                      <NotificationCard
                        key={n.id}
                        n={n}
                        position={i + 1}
                        busy={busyId === n.id}
                        onAct={act(n.id)}
                      />
                    ))}
                  </ul>
                )}
              </div>

              {/* Something landed below the fold while they were working the top of
                  the queue. Offer the jump; never take it for them. */}
              {pendingBelow > 0 && (
                <button
                  type="button"
                  onClick={jumpToLatest}
                  className="notif-jump absolute left-1/2 bottom-3 -translate-x-1/2 flex items-center gap-1.5 min-h-[36px] px-3.5 rounded-full text-xs font-medium shadow-lg"
                  style={{ background: "#0d253d", color: "#fff" }}
                >
                  <ArrowDown size={13} />
                  {pendingBelow} new notification{pendingBelow > 1 ? "s" : ""}
                </button>
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
/* Momentum scrolling on iOS, and a scrollbar that doesn't dominate a 384px panel. */
.notif-scroll {
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
  scrollbar-color: rgba(13,37,61,0.25) transparent;
}
.notif-scroll::-webkit-scrollbar { width: 6px; }
.notif-scroll::-webkit-scrollbar-thumb {
  background: rgba(13,37,61,0.22);
  border-radius: 999px;
}
.notif-scroll::-webkit-scrollbar-track { background: transparent; }
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
/* Tablets get more room than a phone but still can't outgrow the viewport. */
@media (min-width: 640px) and (max-width: 1023px) {
  .notif-panel { width: min(420px, calc(100vw - 24px)); max-height: min(75vh, 620px); }
}
@keyframes notifIn {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes notifDrop {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes notifJumpIn {
  from { opacity: 0; transform: translate(-50%, 8px); }
  to   { opacity: 1; transform: translate(-50%, 0); }
}
.notif-jump { animation: notifJumpIn 160ms ease-out; }
@media (prefers-reduced-motion: reduce) {
  .notif-panel, .notif-jump { animation: none; }
  .notif-scroll { scroll-behavior: auto; }
}
`,
        }}
      />
    </div>
  );
}
