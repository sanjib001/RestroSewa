"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasPermission, PERMISSIONS, NAV_ACCESS } from "@/lib/permissions";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";
import { buildVisibilityFilter, getAssignedWorkstationIds } from "@/lib/assignments";
import { emitNewOrderNotification } from "@/lib/notify";

export type ActionResult = { error: string } | null;

// ─── Types ────────────────────────────────────────────────────────────────────

export type TableStatus = {
  id: string;
  number: string;
  group_id: string | null;
  session_id: string | null;
  session_opened_at: string | null;
};

export type OrderItemRow = {
  id: string;
  item_name: string;
  item_price: number;
  workstation_name: string | null;
  quantity: number;
  item_status: "pending" | "ready" | "served";
  notes: string | null;
  created_at: string;
  order_id: string;
};

export type SessionDetail = {
  id: string;
  type: string;
  status: string;
  table_id: string | null;
  room_id: string | null;
  table_number: string | null;
  room_number: string | null;
  opened_at: string;
  customer_pin: string | null;
  items: OrderItemRow[];
  total: number;
};

export type CartItem = {
  menu_item_id: string;
  variant_id: string | null;
  item_name: string;
  item_price: number;
  workstation_id: string;
  workstation_name: string;
  quantity: number;
  notes: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── Table Status Overview ────────────────────────────────────────────────────

export async function getTableStatusOverview(
  restaurantId: string
): Promise<TableStatus[]> {
  const service = createServiceClient();

  const [tablesRes, sessionsRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("restaurant_tables")
      .select("id, number, group_id")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .order("number"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("sessions")
      .select("id, table_id, opened_at")
      .eq("restaurant_id", restaurantId)
      .eq("status", "active"),
  ]);

  const tables = (tablesRes.data ?? []) as {
    id: string;
    number: string;
    group_id: string | null;
  }[];
  const sessions = (sessionsRes.data ?? []) as {
    id: string;
    table_id: string;
    opened_at: string;
  }[];

  return tables.map((t) => {
    const session = sessions.find((s) => s.table_id === t.id) ?? null;
    return {
      id: t.id,
      number: t.number,
      group_id: t.group_id,
      session_id: session?.id ?? null,
      session_opened_at: session?.opened_at ?? null,
    };
  });
}

// ─── Open / Navigate to Session ──────────────────────────────────────────────

export async function openTableSession(tableId: string) {
  const ru = await getRestaurantUser();
  const service = createServiceClient();

  // Table-group isolation: staff may only open tables in their assigned groups.
  const visibility = await buildVisibilityFilter(ru.restaurant_id, ru);
  if (!visibility.seesAll && !visibility.canSeeTable(tableId)) {
    redirect("/employee/dashboard");
  }

  // Check for existing active session on this table
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (service as any)
    .from("sessions")
    .select("id")
    .eq("restaurant_id", ru.restaurant_id)
    .eq("table_id", tableId)
    .eq("status", "active")
    .maybeSingle();

  if (existing) {
    redirect(`/employee/session/${existing.id}`);
  }

  // Create new session with a customer ordering PIN
  const customer_pin = String(Math.floor(1000 + Math.random() * 9000));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session, error } = await (service as any)
    .from("sessions")
    .insert({
      restaurant_id: ru.restaurant_id,
      type: "table",
      table_id: tableId,
      customer_pin,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  redirect(`/employee/session/${session.id}`);
}

export async function openRoomSession(roomId: string) {
  const ru = await getRestaurantUser();
  const service = createServiceClient();

  // Isolation: staff may only open rooms in their assigned room types/rooms.
  const visibility = await buildVisibilityFilter(ru.restaurant_id, ru);
  if (!visibility.seesAll && !visibility.canSeeRoom(roomId)) {
    redirect("/employee/dashboard");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (service as any)
    .from("sessions")
    .select("id")
    .eq("restaurant_id", ru.restaurant_id)
    .eq("room_id", roomId)
    .eq("status", "active")
    .maybeSingle();

  if (existing) {
    redirect(`/employee/session/${existing.id}`);
  }

  const customer_pin = String(Math.floor(1000 + Math.random() * 9000));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session, error } = await (service as any)
    .from("sessions")
    .insert({
      restaurant_id: ru.restaurant_id,
      type: "room_service",
      room_id: roomId,
      customer_pin,
    })
    .select("id")
    .single();

  if (error) redirect("/employee/dashboard");
  redirect(`/employee/session/${session.id}`);
}

export async function openWalkInSession() {
  const ru = await getRestaurantUser();
  const service = createServiceClient();

  const customer_pin = String(Math.floor(1000 + Math.random() * 9000));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session, error } = await (service as any)
    .from("sessions")
    .insert({
      restaurant_id: ru.restaurant_id,
      type: "walk_in",
      customer_pin,
    })
    .select("id")
    .single();

  if (error) redirect("/employee/dashboard");
  redirect(`/employee/session/${session.id}`);
}

// ─── Session Detail ───────────────────────────────────────────────────────────

export async function getSessionDetail(
  sessionId: string
): Promise<SessionDetail | null> {
  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session } = await (service as any)
    .from("sessions")
    .select(`id, type, status, opened_at, customer_pin, table_id, room_id, restaurant_tables ( number ), rooms ( number )`)
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: orders } = await (service as any)
    .from("session_orders")
    .select("id")
    .eq("session_id", sessionId);

  const orderIds = ((orders ?? []) as { id: string }[]).map((o) => o.id);
  let items: OrderItemRow[] = [];

  if (orderIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: itemsData } = await (service as any)
      .from("session_order_items")
      .select(
        "id, item_name, item_price, workstation_name, quantity, item_status, notes, created_at, order_id"
      )
      .in("order_id", orderIds)
      .order("created_at");
    items = (itemsData as OrderItemRow[]) ?? [];
  }

  const total = items.reduce(
    (sum, i) => sum + Number(i.item_price) * i.quantity,
    0
  );

  return {
    id: session.id,
    type: session.type,
    status: session.status,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table_id: (session as any).table_id ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    room_id: (session as any).room_id ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table_number: (session as any).restaurant_tables?.number ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    room_number: (session as any).rooms?.number ?? null,
    opened_at: session.opened_at,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    customer_pin: (session as any).customer_pin ?? null,
    items,
    total,
  };
}

// ─── Submit Order ─────────────────────────────────────────────────────────────

export async function submitOrder(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();

  if (!hasPermission(ru, PERMISSIONS.CREATE_ORDERS)) {
    return { error: "You don't have permission to create orders." };
  }

  const service = createServiceClient();

  const sessionId = formData.get("session_id") as string;
  const itemsJson = formData.get("items") as string;

  let cartItems: CartItem[];
  try {
    cartItems = JSON.parse(itemsJson);
  } catch {
    return { error: "Invalid order data." };
  }

  if (!cartItems?.length) return { error: "No items selected." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: order, error: orderErr } = await (service as any)
    .from("session_orders")
    .insert({
      session_id: sessionId,
      restaurant_id: ru.restaurant_id,
      created_by: ru.id,
    })
    .select("id")
    .single();

  if (orderErr) return { error: "Failed to create order." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: itemsErr } = await (service as any)
    .from("session_order_items")
    .insert(
      cartItems.map((item) => ({
        order_id: order.id,
        menu_item_id: item.menu_item_id,
        variant_id: item.variant_id,
        workstation_id: item.workstation_id,
        item_name: item.item_name,
        item_price: item.item_price,
        workstation_name: item.workstation_name,
        quantity: item.quantity,
        notes: item.notes,
      }))
    );

  if (itemsErr) return { error: "Failed to add items." };

  // Alert the kitchen/bar/bakery (and non-workstation staff) that an order was
  // placed. Routing to the right workstation happens on read.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: sess } = await (service as any)
    .from("sessions")
    .select("table_id, room_id")
    .eq("id", sessionId)
    .maybeSingle();
  await emitNewOrderNotification(service, {
    restaurantId: ru.restaurant_id,
    sessionId,
    orderId: order.id,
    tableId: sess?.table_id ?? null,
    roomId: sess?.room_id ?? null,
  });

  revalidatePath("/employee/queue");
  revalidatePath("/employee/notifications");
  redirect(`/employee/session/${sessionId}`);
}

// ─── Update Item Status ───────────────────────────────────────────────────────

export async function updateOrderItemStatus(
  itemId: string,
  status: "pending" | "ready" | "served"
): Promise<ActionResult> {
  const ru = await getRestaurantUser();

  // Only staff allowed to work orders may advance item status.
  if (!NAV_ACCESS.canManageOrders(ru)) {
    return { error: "You don't have permission to update orders." };
  }

  const service = createServiceClient();

  // Resolve the item → order → session so we can enforce restaurant ownership
  // and table-group visibility (a staff member can't touch another group's items).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: item } = await (service as any)
    .from("session_order_items")
    .select("id, order_id")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return { error: "Item not found." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: order } = await (service as any)
    .from("session_orders")
    .select("session_id, restaurant_id")
    .eq("id", item.order_id)
    .maybeSingle();
  if (!order || order.restaurant_id !== ru.restaurant_id) {
    return { error: "Permission denied." };
  }

  const visibility = await buildVisibilityFilter(ru.restaurant_id, ru);
  if (!visibility.seesAll) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: session } = await (service as any)
      .from("sessions")
      .select("table_id, room_id")
      .eq("id", order.session_id)
      .maybeSingle();
    if (
      !session ||
      !visibility.canSeeTable(session.table_id ?? null) ||
      !visibility.canSeeRoom(session.room_id ?? null)
    ) {
      return { error: "Permission denied." };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any)
    .from("session_order_items")
    .update({ item_status: status })
    .eq("id", itemId);
  revalidatePath("/employee/queue");
  revalidatePath(`/employee/session/${order.session_id}`);
  return null;
}

// ─── Close Session with Payment ───────────────────────────────────────────────

export async function closeSessionWithPayment(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();

  if (!hasPermission(ru, PERMISSIONS.CLOSE_BILLS)) {
    return { error: "You don't have permission to close bills." };
  }

  const service = createServiceClient();

  const sessionId   = formData.get("session_id") as string;
  const method      = (formData.get("payment_method") as string) || "cash";
  const cashAmount  = parseFloat(formData.get("cash_amount")   as string) || 0;
  const onlineAmount = parseFloat(formData.get("online_amount") as string) || 0;
  const totalAmount  = parseFloat(formData.get("total_amount")  as string);

  const validMethods = ["cash", "online", "mixed"];
  if (!validMethods.includes(method)) return { error: "Invalid payment method." };
  if (isNaN(totalAmount) || totalAmount < 0) return { error: "Invalid total amount." };
  if (cashAmount < 0 || onlineAmount < 0) return { error: "Amounts cannot be negative." };

  if (method === "mixed") {
    if (Math.abs(cashAmount + onlineAmount - totalAmount) > 0.01) {
      return { error: "The combined Cash and Online amounts must equal the total payable amount." };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any).from("payments").insert({
    restaurant_id:  ru.restaurant_id,
    session_id:     sessionId,
    amount:         totalAmount,
    cash_amount:    cashAmount,
    online_amount:  onlineAmount,
    total_amount:   totalAmount,
    payment_method: method,
    created_by:     ru.id,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any)
    .from("sessions")
    .update({ status: "closed", closed_at: new Date().toISOString() })
    .eq("id", sessionId);

  revalidatePath("/employee/dashboard");
  revalidatePath(`/employee/session/${sessionId}`);
  redirect("/employee/dashboard");
}

// ─── Customer PIN Management (Super Admin) ────────────────────────────────────

export type ActiveSessionPin = {
  id: string;
  type: string;
  customer_pin: string | null;
  opened_at: string;
  table_number: string | null;
};

export async function getActiveSessionsWithPins(
  restaurantId: string
): Promise<ActiveSessionPin[]> {
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("sessions")
    .select("id, type, customer_pin, opened_at, restaurant_tables ( number )")
    .eq("restaurant_id", restaurantId)
    .eq("status", "active")
    .order("opened_at", { ascending: false });

  if (!data) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map((s) => ({
    id: s.id,
    type: s.type,
    customer_pin: s.customer_pin,
    opened_at: s.opened_at,
    table_number: s.restaurant_tables?.number ?? null,
  }));
}

export async function regenerateSessionPin(sessionId: string): Promise<ActionResult> {
  const service = createServiceClient();
  const new_pin = String(Math.floor(1000 + Math.random() * 9000));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("sessions")
    .update({ customer_pin: new_pin })
    .eq("id", sessionId);
  if (error) return { error: "Failed to regenerate PIN." };
  revalidatePath("/superadmin/restaurants");
  return null;
}

export async function clearSessionPin(sessionId: string): Promise<ActionResult> {
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("sessions")
    .update({ customer_pin: null })
    .eq("id", sessionId);
  if (error) return { error: "Failed to clear PIN." };
  revalidatePath("/superadmin/restaurants");
  return null;
}

// ─── Force Close Session ─────────────────────────────────────────────────────

export async function forceCloseSession(sessionId: string): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (
    !hasPermission(ru, PERMISSIONS.CLOSE_BILLS) &&
    !hasPermission(ru, PERMISSIONS.MANAGE_TABLES)
  ) {
    return { error: "Permission denied." };
  }

  const service = createServiceClient();

  // Verify ownership and get table/room context
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session } = await (service as any)
    .from("sessions")
    .select("id, restaurant_id, table_id, room_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session || session.restaurant_id !== ru.restaurant_id)
    return { error: "Permission denied." };

  // Clear pending notifications for this table or room
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const notifQuery = (service as any)
    .from("notifications")
    .update({ status: "completed" })
    .eq("restaurant_id", ru.restaurant_id)
    .in("status", ["new", "acknowledged"]);

  if (session.table_id) {
    await notifQuery.eq("table_id", session.table_id);
  } else if (session.room_id) {
    await notifQuery.eq("room_id", session.room_id);
  }

  // Close the session
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any)
    .from("sessions")
    .update({ status: "closed", closed_at: new Date().toISOString() })
    .eq("id", sessionId);

  revalidatePath("/employee/dashboard");
  redirect("/employee/dashboard");
}

// ─── Order Queue (grouped by order, for the staff working queue) ──────────────
// Returns each active order the viewer is allowed to see (by table-group), with
// its table/room/customer context, every item on the order, and an aggregate
// status. This is the primary staff working queue. Self-authing: derives the
// viewer from the session so it can be safely polled from the client.

export type QueueOrderItem = {
  id: string;
  item_name: string;
  quantity: number;
  item_status: "pending" | "ready" | "served";
  notes: string | null;
  workstation_name: string | null;
  item_price: number;
};

export type QueueOrder = {
  order_id: string;
  session_id: string;
  table_number: string | null;
  room_number: string | null;
  session_type: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  created_at: string;
  items: QueueOrderItem[];
  status: "pending" | "ready" | "served";
  total: number;
};

export async function getMyOrderQueue(): Promise<QueueOrder[]> {
  const ru = await getRestaurantUser();
  const restaurantId = ru.restaurant_id;
  const service = createServiceClient();

  const visibility = await buildVisibilityFilter(restaurantId, ru);

  // Workstation routing: staff with assigned workstations (kitchen/bar/bakery)
  // only work items for those workstations, restaurant-wide. Admins/managers
  // (seesAll) always see full orders regardless of any workstation assignment.
  const myWorkstations = await getAssignedWorkstationIds(ru.id);
  const isWorkstationStaff = !visibility.seesAll && myWorkstations.size > 0;

  // session_order_items has no restaurant_id, so scope through active sessions →
  // their orders → the order items.
  // 1. Active sessions for this restaurant (+ table/room/customer context).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: sessions } = await (service as any)
    .from("sessions")
    .select("id, type, table_id, room_id, credit_customer_id, restaurant_tables ( number ), rooms ( number ), credit_customers ( name, phone )")
    .eq("restaurant_id", restaurantId)
    .eq("status", "active");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionMap = new Map(((sessions ?? []) as any[]).map((s) => [s.id, s]));
  const sessionIds = [...sessionMap.keys()];
  if (sessionIds.length === 0) return [];

  // 2. Orders on those sessions.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: orders } = await (service as any)
    .from("session_orders")
    .select("id, session_id, created_at")
    .in("session_id", sessionIds);

  const orderIds = [...new Set(((orders ?? []) as { id: string }[]).map((o) => o.id))];
  if (orderIds.length === 0) return [];

  // 3. All items for those orders.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: items } = await (service as any)
    .from("session_order_items")
    .select("id, order_id, item_name, quantity, item_status, notes, workstation_id, workstation_name, item_price, created_at")
    .in("order_id", orderIds)
    .order("created_at");

  const orderMeta = new Map(
    ((orders ?? []) as { id: string; session_id: string; created_at: string }[]).map((o) => [
      o.id,
      o,
    ])
  );

  // An order is "in the queue" only while it still has a pending/ready item.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeOrderIds = [
    ...new Set(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((items ?? []) as any[])
        .filter((it) => it.item_status === "pending" || it.item_status === "ready")
        .map((it) => it.order_id)
    ),
  ];
  if (activeOrderIds.length === 0) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const itemsByOrder = new Map<string, any[]>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const it of (items ?? []) as any[]) {
    if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, []);
    itemsByOrder.get(it.order_id)!.push(it);
  }

  const result: QueueOrder[] = [];
  for (const orderId of activeOrderIds) {
    const meta = orderMeta.get(orderId);
    if (!meta) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = sessionMap.get(meta.session_id) as any;
    if (!session) continue; // session closed / not active → drop from queue

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rawItems = (itemsByOrder.get(orderId) ?? []) as any[];

    if (visibility.seesAll) {
      // Admins / managers: the whole order, every workstation.
    } else if (isWorkstationStaff) {
      // Workstation staff: only their workstation's items, across all tables.
      // Keep the same order but show just the slice they're responsible for.
      rawItems = rawItems.filter(
        (it) => it.workstation_id && myWorkstations.has(it.workstation_id)
      );
      // Only surface the order if it still has actionable work for them.
      if (!rawItems.some((it) => it.item_status === "pending" || it.item_status === "ready")) {
        continue;
      }
    } else {
      // Non-workstation staff (waiter/supervisor): full order, but only for the
      // table groups they're assigned to.
      if (!(visibility.canSeeTable(session.table_id ?? null) && visibility.canSeeRoom(session.room_id ?? null))) {
        continue;
      }
    }

    if (rawItems.length === 0) continue;

    const orderItems: QueueOrderItem[] = rawItems.map((it) => ({
      id: it.id,
      item_name: it.item_name,
      quantity: it.quantity,
      item_status: it.item_status,
      notes: it.notes,
      workstation_name: it.workstation_name,
      item_price: Number(it.item_price),
    }));

    const anyPending = orderItems.some((i) => i.item_status === "pending");
    const anyReady = orderItems.some((i) => i.item_status === "ready");
    const status: QueueOrder["status"] = anyPending ? "pending" : anyReady ? "ready" : "served";

    result.push({
      order_id: orderId,
      session_id: meta.session_id,
      table_number: session.restaurant_tables?.number ?? null,
      room_number: session.rooms?.number ?? null,
      session_type: session.type ?? null,
      customer_name: session.credit_customers?.name ?? null,
      customer_phone: session.credit_customers?.phone ?? null,
      created_at: meta.created_at,
      items: orderItems,
      status,
      total: orderItems.reduce((s, i) => s + i.item_price * i.quantity, 0),
    });
  }

  // Oldest orders first — the queue works FIFO.
  result.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return result;
}

// ─── Sales Summary ────────────────────────────────────────────────────────────
// Aggregates the existing payments data into the figures the Sales screen needs.
// No duplicate records are created — everything is derived from `payments`.

export type SalesTxn = {
  id: string;
  amount: number;
  method: string;
  cash_amount: number;
  online_amount: number;
  created_at: string;
  table_number: string | null;
  room_number: string | null;
  session_type: string | null;
  customer_name: string | null;
};

// The period a viewer can filter the Sales screen by. "all" = all-time,
// "custom" = an explicit [from, to] date range.
export type SalesPeriod = "today" | "week" | "month" | "year" | "all" | "custom";

// Sales figures for whichever period is selected, plus an always-computed
// overview so the period cards can show their own totals at a glance.
export type SalesReport = {
  period: SalesPeriod;
  from: string | null;
  to: string | null;
  overview: { today: number; week: number; month: number; year: number; total: number };
  periodTotal: number;
  orderCount: number;
  avgOrderValue: number;
  breakdown: { cash: number; online: number; card: number; other: number };
  transactions: SalesTxn[];
};

// Resolves a period (or custom range) to millisecond [from, to] bounds. The
// today/week/month/year bounds match how the overview totals are computed so a
// selected card's total always equals its period detail.
function resolveSalesRange(
  period: SalesPeriod,
  from?: string | null,
  to?: string | null
): { fromMs: number; toMs: number } {
  const now = new Date();
  const nowMs = now.getTime();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const startOfYear = new Date(now.getFullYear(), 0, 1).getTime();
  const weekAgo = nowMs - 7 * 24 * 60 * 60 * 1000;

  switch (period) {
    case "today":
      return { fromMs: startOfToday, toMs: Infinity };
    case "week":
      return { fromMs: weekAgo, toMs: Infinity };
    case "month":
      return { fromMs: startOfMonth, toMs: Infinity };
    case "year":
      return { fromMs: startOfYear, toMs: Infinity };
    case "custom": {
      const f = from ? new Date(from).getTime() : -Infinity;
      // `to` is a calendar day — include the whole day by pushing to its end.
      const t = to ? new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1 : Infinity;
      return { fromMs: Number.isNaN(f) ? -Infinity : f, toMs: Number.isNaN(t) ? Infinity : t };
    }
    case "all":
    default:
      return { fromMs: -Infinity, toMs: Infinity };
  }
}

// Self-authing sales report. Derives the restaurant from the session (never
// trusts client input) and enforces the same sales permission as the page, so
// the client can safely re-query it on every filter change. Everything is
// derived from the existing `payments` rows — no records are created.
export async function getSalesReport(params?: {
  period?: SalesPeriod;
  from?: string | null;
  to?: string | null;
}): Promise<SalesReport> {
  const ru = await getRestaurantUser();
  if (!NAV_ACCESS.canSeeSales(ru)) {
    return {
      period: params?.period ?? "today",
      from: params?.from ?? null,
      to: params?.to ?? null,
      overview: { today: 0, week: 0, month: 0, year: 0, total: 0 },
      periodTotal: 0,
      orderCount: 0,
      avgOrderValue: 0,
      breakdown: { cash: 0, online: 0, card: 0, other: 0 },
      transactions: [],
    };
  }

  const period = params?.period ?? "today";
  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("payments")
    .select("id, amount, total_amount, cash_amount, online_amount, payment_method, created_at, sessions ( type, restaurant_tables ( number ), rooms ( number ), credit_customers ( name ) )")
    .eq("restaurant_id", ru.restaurant_id)
    .order("created_at", { ascending: false });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []) as any[];

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const startOfYear = new Date(now.getFullYear(), 0, 1).getTime();

  const { fromMs, toMs } = resolveSalesRange(period, params?.from, params?.to);

  const overview = { today: 0, week: 0, month: 0, year: 0, total: 0 };
  const breakdown = { cash: 0, online: 0, card: 0, other: 0 };
  let periodTotal = 0;
  let orderCount = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inRange: any[] = [];

  for (const p of rows) {
    const value = Number(p.total_amount ?? p.amount ?? 0);
    const ts = new Date(p.created_at).getTime();

    // Overview totals — always over all rows, independent of the filter.
    overview.total += value;
    if (ts >= startOfToday) overview.today += value;
    if (ts >= weekAgo) overview.week += value;
    if (ts >= startOfMonth) overview.month += value;
    if (ts >= startOfYear) overview.year += value;

    // Selected-period aggregation.
    if (ts >= fromMs && ts <= toMs) {
      const cash = Number(p.cash_amount ?? 0);
      const online = Number(p.online_amount ?? 0);
      periodTotal += value;
      orderCount += 1;
      // cash/online/mixed rows carry the split in cash_amount/online_amount.
      // card/upi/other legacy rows carry the whole value under amount.
      breakdown.cash += cash;
      breakdown.online += online;
      if (p.payment_method === "card") breakdown.card += value;
      else if (p.payment_method === "upi" || p.payment_method === "other") breakdown.other += value;
      inRange.push(p);
    }
  }

  const avgOrderValue = orderCount > 0 ? periodTotal / orderCount : 0;

  const transactions: SalesTxn[] = inRange.slice(0, 200).map((p) => ({
    id: p.id,
    amount: Number(p.total_amount ?? p.amount ?? 0),
    method: p.payment_method,
    cash_amount: Number(p.cash_amount ?? 0),
    online_amount: Number(p.online_amount ?? 0),
    created_at: p.created_at,
    table_number: p.sessions?.restaurant_tables?.number ?? null,
    room_number: p.sessions?.rooms?.number ?? null,
    session_type: p.sessions?.type ?? null,
    customer_name: p.sessions?.credit_customers?.name ?? null,
  }));

  return {
    period,
    from: params?.from ?? null,
    to: params?.to ?? null,
    overview,
    periodTotal,
    orderCount,
    avgOrderValue,
    breakdown,
    transactions,
  };
}
