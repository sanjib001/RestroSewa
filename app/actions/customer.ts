"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { emitNewOrderNotification } from "@/lib/notify";

export type CustomerCartItem = {
  menu_item_id: string;
  item_name: string;
  item_price: number;
  workstation_id: string;
  workstation_name: string;
  quantity: number;
};

export async function verifyCustomerPin(
  sessionId: string | null,
  pin: string,
  tableId?: string | null,
  roomId?: string | null
): Promise<{ success: boolean; resolvedSessionId: string | null }> {
  const service = createServiceClient();

  // Try exact session lookup first
  if (sessionId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: session } = await (service as any)
      .from("sessions")
      .select("id, customer_pin")
      .eq("id", sessionId)
      .eq("status", "active")
      .maybeSingle();

    if (session) {
      const success = session.customer_pin === pin;
      return { success, resolvedSessionId: success ? (session.id as string) : null };
    }
  }

  // Session not found (stale page) — look up the current active session for this table/room
  if (!tableId && !roomId) return { success: false, resolvedSessionId: null };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (service as any)
    .from("sessions")
    .select("id, customer_pin")
    .eq("status", "active")
    .not("customer_pin", "is", null);

  if (tableId) q = q.eq("table_id", tableId);
  else q = q.eq("room_id", roomId);

  const { data: fresh } = await q.maybeSingle();
  if (!fresh) return { success: false, resolvedSessionId: null };

  const success = fresh.customer_pin === pin;
  return { success, resolvedSessionId: success ? (fresh.id as string) : null };
}

export async function checkSessionActive(
  sessionId: string
): Promise<{ active: boolean }> {
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session } = await (service as any)
    .from("sessions")
    .select("status")
    .eq("id", sessionId)
    .maybeSingle();
  return { active: session?.status === "active" };
}

export async function submitCustomerOrder(
  sessionId: string,
  restaurantId: string,
  items: CustomerCartItem[]
): Promise<{ error?: string }> {
  if (!items.length) return { error: "No items in cart." };

  const service = createServiceClient();

  // Verify session is still active
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session } = await (service as any)
    .from("sessions")
    .select("status, restaurant_id, table_id, room_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session || session.status !== "active") return { error: "Session is no longer active." };
  if (session.restaurant_id !== restaurantId) return { error: "Invalid session." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: order, error: orderErr } = await (service as any)
    .from("session_orders")
    .insert({ session_id: sessionId, restaurant_id: restaurantId, created_by: null })
    .select("id")
    .single();
  if (orderErr) return { error: "Failed to create order." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: itemsErr } = await (service as any)
    .from("session_order_items")
    .insert(
      items.map((item) => ({
        order_id: order.id,
        menu_item_id: item.menu_item_id,
        variant_id: null,
        workstation_id: item.workstation_id,
        item_name: item.item_name,
        item_price: item.item_price,
        workstation_name: item.workstation_name,
        quantity: item.quantity,
        notes: null,
      }))
    );
  if (itemsErr) return { error: "Failed to add items." };

  // Alert staff via the existing notification system. Routing (table-group +
  // workstation) happens on read, so we just record the event with its order_id.
  await emitNewOrderNotification(service, {
    restaurantId,
    sessionId,
    orderId: order.id,
    tableId: session.table_id ?? null,
    roomId: session.room_id ?? null,
  });

  revalidatePath("/employee/queue");
  revalidatePath("/employee/notifications");
  revalidatePath(`/employee/session/${sessionId}`);
  return {};
}

export type NotificationStatus = "new" | "acknowledged" | null;

export type CustomerNotifState = {
  call_waiter: NotificationStatus;
  request_bill: NotificationStatus;
};

export async function getCustomerNotifState(
  restaurantId: string,
  tableId: string | null,
  roomId?: string | null,
  sessionId?: string | null
): Promise<CustomerNotifState> {
  if (!tableId && !roomId) return { call_waiter: null, request_bill: null };
  // Without a session we have no scope to filter by — return clean state so
  // buttons are enabled and the server-side dedup handles actual conflicts.
  if (!sessionId) return { call_waiter: null, request_bill: null };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("notifications")
    .select("type, status")
    .eq("restaurant_id", restaurantId)
    .eq("session_id", sessionId)
    .in("type", ["call_waiter", "request_bill"])
    .in("status", ["new", "acknowledged"]);

  const rows = (data ?? []) as { type: string; status: string }[];
  const find = (t: string) =>
    (rows.find((r) => r.type === t)?.status as NotificationStatus) ?? null;

  return { call_waiter: find("call_waiter"), request_bill: find("request_bill") };
}

export async function sendNotification(
  restaurantId: string,
  tableId: string | null,
  type: "call_waiter" | "request_bill",
  roomId?: string | null
): Promise<{ error?: string; alreadyPending?: boolean }> {
  const service = createServiceClient();

  const contextId = tableId ?? roomId ?? null;
  if (!contextId) return { error: "No table or room context." };

  // Resolve the active session first — dedup is scoped to the session so that
  // stale notifications from previous dining sessions don't block new guests.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sessionQuery = (service as any)
    .from("sessions")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .eq("status", "active");
  if (tableId) sessionQuery = sessionQuery.eq("table_id", tableId);
  else if (roomId) sessionQuery = sessionQuery.eq("room_id", roomId);

  const { data: session } = await sessionQuery.maybeSingle();
  const sessionId: string | null = session?.id ?? null;

  // Prevent duplicate active notifications within the same session.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let dupQuery = (service as any)
    .from("notifications")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .eq("type", type)
    .in("status", ["new", "acknowledged"]);

  if (sessionId) {
    dupQuery = dupQuery.eq("session_id", sessionId);
  } else {
    // No active session — fall back to table/room scope to prevent spam.
    if (tableId) dupQuery = dupQuery.eq("table_id", tableId);
    else if (roomId) dupQuery = dupQuery.eq("room_id", roomId);
  }

  const { data: existing } = await dupQuery.maybeSingle();
  if (existing) return { alreadyPending: true };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).from("notifications").insert({
    restaurant_id: restaurantId,
    table_id: tableId ?? null,
    room_id: roomId ?? null,
    session_id: sessionId,
    type,
    status: "new",
  });

  if (error) return { error: error.message };
  revalidatePath("/employee/notifications");
  return {};
}
