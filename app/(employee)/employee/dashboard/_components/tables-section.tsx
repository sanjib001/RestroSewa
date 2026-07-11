import { getTableStatusOverview, openWalkInSession, openRoomSession } from "@/app/actions/pos";
import type { TableStatus } from "@/app/actions/pos";
import { buildVisibilityFilter } from "@/lib/assignments";
import type { RestaurantUserContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/service";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type RoomSummary = {
  id: string;
  number: string;
  status: string;
  session_id: string | null;
};

function TableCard({ table }: { table: TableStatus }) {
  const occupied = !!table.session_id;
  const href = occupied
    ? `/employee/session/${table.session_id}`
    : `/employee/open-table/${table.id}`;

  return (
    <Link
      href={href}
      title={`Table ${table.number}`}
      className="flex flex-col items-center justify-center rounded-xl border p-2 text-center transition-all"
      style={{
        minHeight: 88,
        background: occupied ? "var(--color-primary)" : "var(--color-canvas)",
        borderColor: occupied ? "var(--color-primary)" : "var(--color-hairline)",
      }}
    >
      <span
        className="font-light leading-tight break-words line-clamp-2 w-full"
        style={{
          color: occupied ? "#fff" : "var(--color-ink)",
          letterSpacing: "-0.3px",
          fontSize: "clamp(0.9rem, 3.2vw, 1.4rem)",
        }}
      >
        {table.number}
      </span>
      {occupied && (
        <span className="text-[11px] mt-1" style={{ color: "rgba(255,255,255,0.7)" }}>
          Active
        </span>
      )}
    </Link>
  );
}

function RoomCard({ room }: { room: RoomSummary }) {
  const hasSession = !!room.session_id;
  const isOccupied = room.status === "occupied";

  const numberClass = "font-light leading-tight break-words line-clamp-2 w-full";
  const numberStyle = { letterSpacing: "-0.3px", fontSize: "clamp(0.85rem, 3vw, 1.25rem)" } as const;

  if (hasSession) {
    return (
      <Link
        href={`/employee/session/${room.session_id}`}
        title={`Room ${room.number}`}
        className="flex flex-col items-center justify-center rounded-xl border p-2 text-center transition-all"
        style={{ minHeight: 88, background: "var(--color-primary)", borderColor: "var(--color-primary)" }}
      >
        <span className={numberClass} style={{ ...numberStyle, color: "#fff" }}>{room.number}</span>
        <span className="text-[11px] mt-1" style={{ color: "rgba(255,255,255,0.7)" }}>Session</span>
      </Link>
    );
  }

  if (isOccupied) {
    return (
      <form action={openRoomSession.bind(null, room.id)}>
        <button
          type="submit"
          title={`Room ${room.number}`}
          className="flex flex-col items-center justify-center rounded-xl border w-full p-2 text-center transition-all"
          style={{ minHeight: 88, background: "#fff7ed", borderColor: "#b4530944" }}
        >
          <span className={numberClass} style={{ ...numberStyle, color: "#b45309" }}>{room.number}</span>
          <span className="text-[11px] mt-1" style={{ color: "#b45309", opacity: 0.7 }}>Start session</span>
        </button>
      </form>
    );
  }

  return (
    <div
      title={`Room ${room.number}`}
      className="flex flex-col items-center justify-center rounded-xl border p-2 text-center"
      style={{ minHeight: 88, background: "var(--color-canvas)", borderColor: "var(--color-hairline)", opacity: 0.5 }}
    >
      <span className={numberClass} style={{ ...numberStyle, color: "var(--color-ink-mute)" }}>{room.number}</span>
      <span className="text-[11px] mt-1" style={{ color: "var(--color-ink-mute)" }}>{room.status}</span>
    </div>
  );
}

// The Tables + Rooms overview, extracted from the old standalone dashboard so it
// can be embedded as a stacked section on the single-page staff dashboard. Table-
// group isolation is preserved (staff only see their assigned tables/rooms).
export async function TablesSection({ restaurantUser }: { restaurantUser: RestaurantUserContext }) {
  const service = createServiceClient();

  const [tables, roomsResult, roomSessionsResult] = await Promise.all([
    getTableStatusOverview(restaurantUser.restaurant_id),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("rooms")
      .select("id, number, status")
      .eq("restaurant_id", restaurantUser.restaurant_id)
      .order("number"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("sessions")
      .select("id, room_id")
      .eq("restaurant_id", restaurantUser.restaurant_id)
      .eq("status", "active")
      .not("room_id", "is", null),
  ]);

  const visibility = await buildVisibilityFilter(restaurantUser.restaurant_id, restaurantUser);
  const visibleTables = tables.filter((t) => visibility.canSeeTable(t.id));

  const activeSessions = visibleTables.filter((t) => t.session_id).length;
  const rawRooms = (roomsResult.data as { id: string; number: string; status: string }[]) ?? [];
  const roomSessions = (roomSessionsResult.data as { id: string; room_id: string }[]) ?? [];

  const rooms: RoomSummary[] = rawRooms
    .filter((r) => visibility.canSeeRoom(r.id))
    .map((r) => ({
      ...r,
      session_id: roomSessions.find((s) => s.room_id === r.id)?.id ?? null,
    }));

  const activeRoomSessions = rooms.filter((r) => r.session_id).length;

  return (
    <div>
      {/* THE fix for "waiter activates C1, cashier still sees it free". A session
          opening/closing fires a `tables` event, and this re-runs the section in
          place — every dashboard updates without anyone refreshing. Order items
          also move a table's status, so `orders` is watched too. */}
      <RealtimeRefresh topics={["tables", "orders"]} />

      {/* Tables */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>Tables</p>
        <div className="flex items-center gap-3">
          <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
            {activeSessions} active · {visibleTables.length} total
          </span>
          <form action={openWalkInSession}>
            <Button type="submit" variant="secondary">+ Walk-in</Button>
          </form>
        </div>
      </div>

      {visibleTables.length === 0 ? (
        <div
          className="rounded-xl border px-8 py-10 text-center"
          style={{ borderStyle: "dashed", borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
        >
          <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
            {tables.length === 0
              ? "No tables set up yet. Ask your admin to add tables."
              : "No tables assigned to you yet. Ask your admin to add you to a table group."}
          </p>
        </div>
      ) : (
        <div
          className="grid gap-2.5"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))" }}
        >
          {visibleTables.map((t) => (
            <TableCard key={t.id} table={t} />
          ))}
        </div>
      )}

      {/* Rooms */}
      {rooms.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-4 mt-8">
            <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>Rooms</p>
            <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
              {activeRoomSessions} active · {rooms.length} total
            </span>
          </div>
          <div
            className="grid gap-2.5"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))" }}
          >
            {rooms.map((r) => (
              <RoomCard key={r.id} room={r} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
