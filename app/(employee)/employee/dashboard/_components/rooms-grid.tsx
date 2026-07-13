"use client";

import Link from "next/link";
import { memo, useActionState, useCallback, useEffect, useState, useTransition } from "react";
import { checkInRoom, getRoomsOverview } from "@/app/actions/rooms";
import type { RoomOverview } from "@/app/actions/rooms";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { Button } from "@/components/ui/button";
import { formatShort } from "@/lib/format-time";
import { BedDouble, Clock, LogIn, Plus, Receipt, User, Users, UtensilsCrossed, X } from "lucide-react";

const rupee = (n: number) => "₹" + Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

// How long until the next night ticks over — the number a receptionist wants when
// a guest asks "if I leave now, what do I pay?".
function untilNextNight(checkIn: string): string {
  const ms = Date.now() - new Date(checkIn).getTime();
  const intoNight = ms % (24 * 60 * 60 * 1000);
  const left = 24 * 60 * 60 * 1000 - intoNight;
  const h = Math.floor(left / (60 * 60 * 1000));
  const m = Math.floor((left % (60 * 60 * 1000)) / (60 * 1000));
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * A countdown cannot be server-rendered. It is derived from `Date.now()`, so the
 * server's answer is already stale by the time the browser hydrates, and React
 * refuses to reconcile the two. There is no correct value to send in the HTML —
 * so send none, and fill it in once we're on the client, where "now" means now.
 *
 * It then re-ticks every minute, which the old version never did: the card used
 * to freeze at whatever the countdown said when the page loaded.
 */
function useNow(everyMs = 60_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

const STATUS: Record<RoomOverview["status"], { label: string; color: string; soft: string }> = {
  available:   { label: "Available",   color: "#1a7a4a", soft: "#f0fdf4" },
  occupied:    { label: "Occupied",    color: "#4f46e5", soft: "#eef2ff" },
  cleaning:    { label: "Cleaning",    color: "#b45309", soft: "#fff7ed" },
  maintenance: { label: "Maintenance", color: "#6b7280", soft: "#f9fafb" },
};

// ─── Check in ────────────────────────────────────────────────────────────────

function CheckInModal({ room, onClose }: { room: RoomOverview; onClose: () => void }) {
  const [state, action, pending] = useActionState(checkInRoom, null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(15,23,42,0.55)" }}
      onClick={onClose}
    >
      <form
        action={action}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border shadow-xl"
        style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
      >
        <input type="hidden" name="room_id" value={room.id} />

        <div
          className="flex items-center gap-2.5 px-5 py-4 border-b"
          style={{ borderColor: "var(--color-hairline)" }}
        >
          <BedDouble size={17} style={{ color: "var(--color-primary)" }} />
          <p className="text-sm font-medium flex-1" style={{ color: "var(--color-ink)" }}>
            Check in — Room {room.number}
          </p>
          <button type="button" onClick={onClose} aria-label="Close" style={{ color: "var(--color-ink-mute)" }}>
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3">
          <div
            className="flex items-baseline justify-between rounded-lg border px-3 py-2"
            style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}
          >
            <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
              {room.type_name}
            </span>
            <span className="text-sm tabular" style={{ color: "var(--color-ink)" }}>
              {rupee(room.base_price)} <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>per night</span>
            </span>
          </div>

          <div>
            <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
              Guest name
            </label>
            <input
              name="guest_name"
              required
              autoFocus
              className="w-full h-10 rounded-sm border px-3 text-sm"
              style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
                Phone
              </label>
              <input
                name="guest_phone"
                inputMode="tel"
                className="w-full h-10 rounded-sm border px-3 text-sm"
                style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
              />
            </div>
            <div>
              <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
                Guests
              </label>
              <input
                name="guest_count"
                type="number"
                min={1}
                defaultValue={1}
                className="w-full h-10 rounded-sm border px-3 text-sm tabular"
                style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
              />
            </div>
          </div>

          <div>
            <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>
              Notes
            </label>
            <input
              name="notes"
              placeholder="Optional"
              className="w-full h-10 rounded-sm border px-3 text-sm"
              style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
            />
          </div>

          <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
            The nightly rate is fixed at {rupee(room.base_price)} for this stay — a later price
            change won&rsquo;t re-bill this guest.
          </p>

          {state && "error" in state && (
            <p className="text-xs" style={{ color: "var(--color-ruby)" }}>{state.error}</p>
          )}

          <Button type="submit" variant="primary" disabled={pending} className="w-full">
            {pending ? "Checking in…" : "Check in"}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ─── One room ────────────────────────────────────────────────────────────────

// `memo` so a refetch re-renders only the cards whose data actually moved —
// checking one guest in shouldn't repaint every other room's countdown.
const RoomCard = memo(function RoomCard({ room, canCheckIn, onCheckIn }: {
  room: RoomOverview;
  canCheckIn: boolean;
  onCheckIn: () => void;
}) {
  const s = STATUS[room.status];
  const stay = room.stay;
  const now = useNow();

  return (
    <div
      className="rounded-xl border flex flex-col overflow-hidden"
      style={{ background: "var(--color-canvas)", borderColor: stay ? s.color + "55" : "var(--color-hairline)" }}
    >
      <div className="flex items-center gap-2 px-4 py-2.5 border-b" style={{ borderColor: "var(--color-hairline)" }}>
        <span className="text-base font-medium" style={{ color: "var(--color-ink)" }}>
          {room.number}
        </span>
        <span className="text-xs truncate flex-1" style={{ color: "var(--color-ink-mute)" }}>
          {room.type_name}
        </span>
        <span
          className="text-xs px-2 py-0.5 rounded-full shrink-0"
          style={{ background: s.soft, color: s.color }}
        >
          {s.label}
        </span>
      </div>

      <div className="px-4 py-3 flex-1 flex flex-col gap-2">
        {stay ? (
          <>
            <p className="text-sm truncate" style={{ color: "var(--color-ink)" }}>
              <User size={12} className="inline mr-1" style={{ verticalAlign: "-1px" }} />
              {stay.guest_name}
              {stay.guest_count > 1 && (
                <span style={{ color: "var(--color-ink-mute)" }}>
                  {" "}
                  <Users size={11} className="inline" style={{ verticalAlign: "-1px" }} /> {stay.guest_count}
                </span>
              )}
            </p>

            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <div>
                <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Checked in</p>
                <p className="text-xs" style={{ color: "var(--color-ink)" }}>{formatShort(stay.check_in_at)}</p>
              </div>
              <div>
                <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Nights so far</p>
                <p className="text-xs" style={{ color: "var(--color-ink)" }}>
                  {stay.nights_so_far} × {rupee(stay.room_rate)}
                </p>
              </div>
            </div>

            {/* Empty on the server, filled on the client — see useNow. Reserves
                its line either way, so the card doesn't jump on hydration. */}
            <p className="text-xs" style={{ color: "var(--color-ink-mute)", minHeight: "1rem" }}>
              {now !== null && (
                <>
                  <Clock size={11} className="inline mr-1" style={{ verticalAlign: "-1px" }} />
                  Next night in {untilNextNight(stay.check_in_at)}
                </>
              )}
            </p>

            {/* Food, at a glance. A QR order from the room shows up here the
                moment it is placed — this is the cue to open the room and print
                the ticket, which previously nothing on the dashboard gave. */}
            <div className="flex items-center gap-1.5">
              <UtensilsCrossed size={11} style={{ color: "var(--color-ink-mute)" }} />
              {stay.items_total === 0 ? (
                <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                  No food ordered
                </span>
              ) : stay.items_pending > 0 ? (
                <span
                  className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                  style={{ background: "#fff7ed", color: "#b45309" }}
                >
                  {stay.items_pending} pending
                </span>
              ) : (
                <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                  {stay.items_total} served
                </span>
              )}
            </div>

            <div
              className="flex items-baseline justify-between rounded-lg px-2.5 py-1.5 mt-auto"
              style={{ background: "var(--color-canvas-soft)" }}
            >
              <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Current bill</span>
              <span className="text-sm tabular font-medium" style={{ color: "var(--color-ink)" }}>
                {rupee(stay.running_total)}
              </span>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm tabular" style={{ color: "var(--color-ink)" }}>
              {rupee(room.base_price)}
              <span className="text-xs ml-1" style={{ color: "var(--color-ink-mute)" }}>per night</span>
            </p>
            <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
              {room.session_id
                ? "An open session from before check-in existed — settle it to free the room."
                : room.status === "available"
                ? "Ready for the next guest."
                : room.status === "cleaning"
                ? "Being cleaned."
                : "Out of service."}
            </p>
          </>
        )}

        {room.staff.length > 0 && (
          <p className="text-xs truncate" style={{ color: "var(--color-ink-mute)" }}>
            Staff: {room.staff.join(", ")}
          </p>
        )}
      </div>

      <div className="px-4 pb-3 flex gap-2">
        {stay ? (
          <>
            {/* One click to the room's ONE screen — orders, KOT, bill, checkout —
                exactly as a table card opens a table's one screen. "Add order" is
                here too, but it is now a shortcut, not the only way in. */}
            <Link href={`/employee/room/${stay.stay_id}`} className="flex-1 min-w-0">
              <Button variant="primary" className="w-full flex items-center justify-center gap-1.5">
                <Receipt size={13} /> Open room
              </Button>
            </Link>
            {stay.session_id && (
              <Link href={`/employee/session/${stay.session_id}/add`} className="shrink-0">
                <Button
                  variant="secondary"
                  title="Take a room-service order by phone or in person"
                  className="flex items-center justify-center gap-1.5"
                >
                  <Plus size={13} />
                </Button>
              </Link>
            )}
          </>
        ) : room.session_id ? (
          // An open session with no stay behind it — made by the old flow, before
          // check-in existed. It can still be settled the ordinary way (there are
          // no room nights to bill), but it must stay reachable, or a live bill
          // with real orders on it would simply vanish from the dashboard.
          <Link href={`/employee/session/${room.session_id}`} className="flex-1">
            <Button variant="secondary" className="w-full flex items-center justify-center gap-1.5">
              <Receipt size={13} /> Settle old session
            </Button>
          </Link>
        ) : canCheckIn && room.status !== "maintenance" ? (
          <Button
            type="button"
            variant="secondary"
            onClick={onCheckIn}
            className="w-full flex items-center justify-center gap-1.5"
          >
            <LogIn size={13} /> Check in
          </Button>
        ) : null}
      </div>
    </div>
  );
});

// ─── The grid ────────────────────────────────────────────────────────────────

export function RoomsGrid({
  initial,
  canCheckIn,
}: {
  initial: RoomOverview[];
  canCheckIn: boolean;
}) {
  const [rooms, setRooms] = useState(initial);
  const [checkingIn, setCheckingIn] = useState<RoomOverview | null>(null);
  const [, startTransition] = useTransition();

  // Refetches only the rooms. This was `router.refresh()` (via RealtimeRefresh),
  // which re-ran the entire dashboard route — sales, credits, the whole menu —
  // on every order event, and threw the results away because those sections keep
  // their own client state.
  const resync = useCallback(() => {
    startTransition(async () => {
      setRooms(await getRoomsOverview());
    });
  }, []);

  useRealtime(["tables", "orders"], resync);

  const occupied = rooms.filter((r) => r.stay).length;
  const free = rooms.filter((r) => r.status === "available" && !r.stay).length;

  if (rooms.length === 0) {
    return (
      <div
        className="rounded-xl border px-8 py-10 text-center"
        style={{ borderStyle: "dashed", borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
      >
        <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
          No rooms assigned to you yet. Ask your admin to add you to a room type.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>Rooms</p>
        <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          {occupied} occupied · {free} free · {rooms.length} total
        </span>
      </div>

      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}
      >
        {rooms.map((r) => (
          <RoomCard
            key={r.id}
            room={r}
            canCheckIn={canCheckIn}
            onCheckIn={() => setCheckingIn(r)}
          />
        ))}
      </div>

      {checkingIn && (
        <CheckInModal room={checkingIn} onClose={() => setCheckingIn(null)} />
      )}
    </div>
  );
}
