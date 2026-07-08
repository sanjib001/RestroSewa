import { createServiceClient } from "@/lib/supabase/service";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";

// ─── Table-Group based order/notification visibility ──────────────────────────
//
// Staff are assigned to TABLE GROUPS (e.g. Indoor, Outdoor), never to individual
// tables. Every table belongs to exactly one group, so a table's activity —
// orders, waiter calls, bill requests — is visible only to staff assigned to
// that table's group. Staff in different groups are completely isolated.
//
//   • A staff member sees a table's activity  ⇔  they belong to the table's group.
//   • Admins and staff with MANAGE_TABLES see everything (managers/owners).
//   • Sessions with no table (walk-in) have no group boundary, so they stay
//     visible to all staff — there is nothing to isolate.
//   • Rooms mirror tables: a room's group is its room type. Staff may also be
//     pinned to a single room; either grants visibility.
//
// This is intentionally strict: there is no "individual table" override and no
// "unassigned table falls back to everyone" loophole. An ungrouped table is only
// visible to admins/managers until an admin puts it in a group.

export type StaffViewer = {
  id: string;
  role: string;
  permissions: string[];
};

export type VisibilityFilter = {
  /** True when the viewer sees everything (admin / table manager). */
  seesAll: boolean;
  /** Whether the viewer may see a table session's activity. */
  canSeeTable: (tableId: string | null) => boolean;
  /** Whether the viewer may see a room session's activity. */
  canSeeRoom: (roomId: string | null) => boolean;
};

export function viewerSeesAllGroups(viewer: StaffViewer): boolean {
  return (
    viewer.role === "restaurant_admin" ||
    hasPermission(viewer, PERMISSIONS.MANAGE_TABLES)
  );
}

// ─── Workstation assignment ───────────────────────────────────────────────────
// Kitchen/Bar/Bakery staff are assigned one or more WORKSTATIONS. When a staff
// member has ≥1 workstation they are "workstation staff": they only work items
// routed to their workstation(s), restaurant-wide (a kitchen cooks for every
// table). Staff with no workstation (waiter/supervisor/manager) are unaffected
// and keep seeing full orders per their table-group / permissions.
export async function getAssignedWorkstationIds(userId: string): Promise<Set<string>> {
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("restaurant_user_workstations")
    .select("workstation_id")
    .eq("restaurant_user_id", userId);
  return new Set(((data ?? []) as { workstation_id: string }[]).map((r) => r.workstation_id));
}

export async function buildVisibilityFilter(
  restaurantId: string,
  viewer: StaffViewer
): Promise<VisibilityFilter> {
  // Managers and admins bypass all group filtering.
  if (viewerSeesAllGroups(viewer)) {
    return { seesAll: true, canSeeTable: () => true, canSeeRoom: () => true };
  }

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = service as any;

  const [myGroupsRes, myRoomTypesRes, myRoomsRes, tablesRes, roomsRes] = await Promise.all([
    svc.from("restaurant_user_table_groups").select("table_group_id").eq("restaurant_user_id", viewer.id),
    svc.from("restaurant_user_room_types").select("room_type_id").eq("restaurant_user_id", viewer.id),
    svc.from("restaurant_user_rooms").select("room_id").eq("restaurant_user_id", viewer.id),
    svc.from("restaurant_tables").select("id, group_id").eq("restaurant_id", restaurantId),
    svc.from("rooms").select("id, room_type_id").eq("restaurant_id", restaurantId),
  ]);

  const myGroups = new Set(
    ((myGroupsRes.data ?? []) as { table_group_id: string }[]).map((r) => r.table_group_id)
  );
  const myRoomTypes = new Set(
    ((myRoomTypesRes.data ?? []) as { room_type_id: string }[]).map((r) => r.room_type_id)
  );
  const myRooms = new Set(
    ((myRoomsRes.data ?? []) as { room_id: string }[]).map((r) => r.room_id)
  );
  const tableGroup = new Map<string, string | null>(
    ((tablesRes.data ?? []) as { id: string; group_id: string | null }[]).map((t) => [t.id, t.group_id])
  );
  const roomTypeOf = new Map<string, string | null>(
    ((roomsRes.data ?? []) as { id: string; room_type_id: string | null }[]).map((r) => [r.id, r.room_type_id])
  );

  return {
    seesAll: false,
    canSeeTable(tableId) {
      if (!tableId) return true;                 // walk-in / no table → no group boundary
      const groupId = tableGroup.get(tableId) ?? null;
      if (!groupId) return false;                // ungrouped table → admins/managers only
      return myGroups.has(groupId);
    },
    canSeeRoom(roomId) {
      if (!roomId) return true;                  // no room context → no boundary
      if (myRooms.has(roomId)) return true;      // pinned directly to this room
      const typeId = roomTypeOf.get(roomId) ?? null;
      return typeId ? myRoomTypes.has(typeId) : false;
    },
  };
}
