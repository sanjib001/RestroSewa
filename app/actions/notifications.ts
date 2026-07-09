"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { buildVisibilityFilter, getAssignedWorkstationIds } from "@/lib/assignments";
import type { StaffViewer } from "@/lib/assignments";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";

export type NotificationType = "call_waiter" | "request_bill" | "new_order";

export type NotificationRow = {
  id: string;
  type: NotificationType;
  status: string;
  table_id: string | null;
  table_number: string | null;
  room_id: string | null;
  room_number: string | null;
  session_id: string | null;
  created_at: string;
  acknowledged_at: string | null;
};

// Viewer context used to route table/room notifications by table group.
export type NotificationViewer = StaffViewer;

export async function getActiveNotifications(
  restaurantId: string,
  viewer: NotificationViewer
): Promise<NotificationRow[]> {
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("notifications")
    .select("id, type, status, table_id, room_id, session_id, order_id, created_at, acknowledged_at, restaurant_tables ( number ), rooms ( number )")
    .eq("restaurant_id", restaurantId)
    .in("status", ["new", "acknowledged"])
    .order("created_at", { ascending: false });

  if (!data) return [];

  // `order_ready` is a customer-facing alert (polled by the customer page for
  // its own session). Staff never see it in their list or badge.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const staffData = (data as any[]).filter((n) => n.type !== "order_ready");
  if (staffData.length === 0) return [];

  const visibility = await buildVisibilityFilter(restaurantId, viewer);
  const myWorkstations = await getAssignedWorkstationIds(viewer.id);
  const isWorkstationStaff = !visibility.seesAll && myWorkstations.size > 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rows: any[];

  if (isWorkstationStaff) {
    // Workstation staff (kitchen/bar/bakery) are alerted only for orders that
    // contain an item routed to their workstation — restaurant-wide, so table
    // groups don't apply. Service calls (waiter/bill) are for front staff, not
    // the kitchen, so they're excluded here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orderIds = [
      ...new Set(
        staffData
          .filter((n) => n.type === "new_order" && n.order_id)
          .map((n) => n.order_id as string)
      ),
    ];

    const orderWorkstations = new Map<string, Set<string>>();
    if (orderIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: its } = await (service as any)
        .from("session_order_items")
        .select("order_id, workstation_id")
        .in("order_id", orderIds);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const it of (its ?? []) as any[]) {
        if (!orderWorkstations.has(it.order_id)) orderWorkstations.set(it.order_id, new Set());
        if (it.workstation_id) orderWorkstations.get(it.order_id)!.add(it.workstation_id);
      }
    }

    rows = staffData.filter((n) => {
      if (n.type !== "new_order" || !n.order_id) return false;
      const ws = orderWorkstations.get(n.order_id);
      if (!ws) return false;
      for (const w of myWorkstations) if (ws.has(w)) return true;
      return false;
    });
  } else {
    // Non-workstation staff: existing table-group routing.
    rows = staffData.filter(
      (n) =>
        visibility.seesAll ||
        (visibility.canSeeTable(n.table_id) && visibility.canSeeRoom(n.room_id))
    );
  }

  return rows.map((n) => ({
    id: n.id,
    type: n.type,
    status: n.status ?? "new",
    table_id: n.table_id,
    table_number: n.restaurant_tables?.number ?? null,
    room_id: n.room_id,
    room_number: n.rooms?.number ?? null,
    session_id: n.session_id,
    created_at: n.created_at,
    acknowledged_at: n.acknowledged_at ?? null,
  }));
}

export async function getNotificationCount(
  restaurantId: string,
  viewer: NotificationViewer
): Promise<number> {
  // Derive from the same routing (table-group + workstation) used to display
  // notifications, so the badge always matches what the staff member can see.
  const items = await getActiveNotifications(restaurantId, viewer);
  return items.filter((n) => n.status === "new").length;
}

// Self-authing poll endpoint for the client. Derives the viewer from the
// session (never trusts client input) and returns the notifications visible to
// them plus the count of unacknowledged ones — used to drive the live badge and
// new-order/waiter-call alerts without a page refresh.
export async function getMyNotifications(): Promise<{
  items: NotificationRow[];
  count: number;
}> {
  const ru = await getRestaurantUser();
  const items = await getActiveNotifications(ru.restaurant_id, ru);
  const count = items.filter((n) => n.status === "new").length;
  return { items, count };
}

// Marks the viewer's currently-visible new-order alerts as seen (acknowledged),
// so the Orders badge clears once they open the queue. Only the notifications
// the viewer is allowed to see (table-group + workstation routed) are touched;
// it never affects other staff's badges. Does not remove orders from the queue
// itself (that's driven by item status).
export async function markMyOrdersSeen(): Promise<void> {
  const ru = await getRestaurantUser();
  const items = await getActiveNotifications(ru.restaurant_id, ru);
  const ids = items
    .filter((n) => n.type === "new_order" && n.status === "new")
    .map((n) => n.id);
  if (ids.length === 0) return;

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any)
    .from("notifications")
    .update({ status: "acknowledged", acknowledged_at: new Date().toISOString() })
    .in("id", ids);
}

export async function acknowledgeNotification(id: string): Promise<void> {
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any)
    .from("notifications")
    .update({ status: "acknowledged", acknowledged_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/employee/notifications");
}

export async function completeNotification(id: string): Promise<void> {
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any)
    .from("notifications")
    .update({ status: "completed" })
    .eq("id", id);
  revalidatePath("/employee/notifications");
}
