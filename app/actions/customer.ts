"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { afterResponse } from "@/lib/push/after";
import { emitTableActivationRequest, emitNewOrder } from "@/lib/notify";
import { notifyStaff } from "@/lib/push/send";
import { resolveOrderItems } from "@/lib/order-items";

export type CustomerOrderItem = {
  id: string;
  name: string;
  quantity: number;
  price: number;
  status: "pending" | "served";
};

export type CustomerOrderStatus = "pending" | "served";

export type CustomerOrder = {
  id: string;
  created_at: string;
  status: CustomerOrderStatus;
  total: number;
  items: CustomerOrderItem[];
};

export type CustomerOrderFeed = {
  orders: CustomerOrder[];
};

// A guest's cart is a REQUEST, not a price list. It says which dish, which
// variant and how many; the name, the price and the kitchen station are all
// resolved from the menu server-side (lib/order-items.ts). This used to carry
// `item_price`, which was inserted onto the bill verbatim — so the phone decided
// what the food cost.
export type CustomerCartItem = {
  menu_item_id: string;
  variant_id: string | null;
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

// True while a table is still awaiting a wipe-down after the last party left. Not exported:
// a "use server" module may only export async server actions, and this is an internal check.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tableNeedsCleaning(service: any, tableId: string): Promise<boolean> {
  const { data } = await service
    .from("restaurant_tables")
    .select("cleaning_since")
    .eq("id", tableId)
    .maybeSingle();
  return !!data?.cleaning_since;
}

// Finds (or lazily creates) the active session a no-PIN ordering customer should
// attach their order to. Only permitted for restaurants configured with
// qr_mode = "ordering_no_pin" — this is the server-side guard that keeps PIN-mode
// restaurants from having sessions auto-created around their PIN gate. Returns an
// existing active session for the table/room when one is present (so staff- and
// customer-side orders converge), otherwise opens a fresh PIN-less session.
export async function ensureCustomerSession(
  restaurantId: string,
  tableId: string | null,
  roomId: string | null
): Promise<{ sessionId: string | null; error?: string }> {
  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: restaurant } = await (service as any)
    .from("restaurants")
    .select("qr_mode, customer_ordering_enabled, is_active")
    .eq("id", restaurantId)
    .maybeSingle();

  if (
    !restaurant ||
    restaurant.is_active === false ||
    restaurant.customer_ordering_enabled === false ||
    restaurant.qr_mode !== "ordering_no_pin"
  ) {
    return { sessionId: null, error: "Ordering is not available." };
  }

  if (!tableId && !roomId) return { sessionId: null, error: "No table or room context." };

  // Reuse an existing active session for this table/room if one exists.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (service as any)
    .from("sessions")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .eq("status", "active");
  if (tableId) q = q.eq("table_id", tableId);
  else q = q.eq("room_id", roomId);

  const { data: existing } = await q.maybeSingle();
  if (existing) return { sessionId: existing.id as string };

  // The table hasn't been cleaned since the last party left, so it isn't ready to seat
  // anyone. The DB refuses the insert anyway (trg_refuse_session_on_dirty_table) — this
  // turns it into something a guest can understand.
  if (tableId && (await tableNeedsCleaning(service, tableId))) {
    return { sessionId: null, error: "This table is being cleaned. Please ask a staff member." };
  }

  // No active session yet — open one without a PIN.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: created, error } = await (service as any)
    .from("sessions")
    .insert({
      restaurant_id: restaurantId,
      type: tableId ? "table" : "room_service",
      table_id: tableId ?? null,
      room_id: roomId ?? null,
      customer_pin: null,
    })
    .select("id")
    .single();

  if (error) return { sessionId: null, error: "Could not start ordering session." };
  return { sessionId: created.id as string };
}

// Inserts an order + its items against a session. Returns the new order id, or
// null on failure. Shared by the direct (submitCustomerOrder) and the
// activation-request (requestTableActivation) paths.
async function insertSessionOrder(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any,
  sessionId: string,
  restaurantId: string,
  items: CustomerCartItem[]
): Promise<{ orderId: string | null; error?: string }> {
  // Re-price against the menu before anything is written. A rejection here is a
  // real answer for the guest ("that's out of stock"), not a generic failure.
  const resolved = await resolveOrderItems(service, restaurantId, items);
  if (!resolved.ok) return { orderId: null, error: resolved.error };

  const { data: order, error: orderErr } = await service
    .from("session_orders")
    .insert({ session_id: sessionId, restaurant_id: restaurantId, created_by: null })
    .select("id")
    .single();
  if (orderErr || !order) return { orderId: null, error: "Failed to create order." };

  const { error: itemsErr } = await service
    .from("session_order_items")
    .insert(resolved.items.map((item) => ({ order_id: order.id, ...item })));
  if (itemsErr) return { orderId: null, error: "Failed to add items." };

  // Ring the stations that have to make it. Silent when the session is still
  // `pending_activation` — emitNewOrder checks — so the no-PIN path, which routes
  // through here to HOLD an order pending approval, does not wake a chef about food
  // nobody has agreed to cook yet.
  await emitNewOrder(service, restaurantId, order.id as string);

  return { orderId: order.id as string };
}

export type ActivationStatus = "none" | "pending" | "approved" | "rejected";

export type ActivationRequestResult = {
  status: "pending" | "approved" | "error";
  sessionId: string | null;
  error?: string;
};

// No-PIN ordering: the customer's order does NOT activate the table. Instead we
// open a `pending_activation` session (invisible to the kitchen queue + table
// overview), persist the order against it, and raise a `table_activation_request`
// for front-of-house staff to Accept/Reject. Once a staff member approves (the
// session becomes active) subsequent orders go straight through the normal path
// — so this only gates the FIRST order until the table is closed.
export async function requestTableActivation(
  restaurantId: string,
  tableId: string | null,
  roomId: string | null,
  items: CustomerCartItem[]
): Promise<ActivationRequestResult> {
  if (!items.length) return { status: "error", sessionId: null, error: "No items in cart." };

  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: restaurant } = await (service as any)
    .from("restaurants")
    .select("qr_mode, customer_ordering_enabled, is_active")
    .eq("id", restaurantId)
    .maybeSingle();

  if (
    !restaurant ||
    restaurant.is_active === false ||
    restaurant.customer_ordering_enabled === false ||
    restaurant.qr_mode !== "ordering_no_pin"
  ) {
    return { status: "error", sessionId: null, error: "Ordering is not available." };
  }
  if (!tableId && !roomId) return { status: "error", sessionId: null, error: "No table or room context." };

  // Any already-open session for this table/room — active (approved) or still
  // awaiting activation.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let openQ = (service as any)
    .from("sessions")
    .select("id, status")
    .eq("restaurant_id", restaurantId)
    .in("status", ["active", "pending_activation"]);
  if (tableId) openQ = openQ.eq("table_id", tableId);
  else openQ = openQ.eq("room_id", roomId);
  const { data: open } = await openQ.order("opened_at", { ascending: false }).limit(1).maybeSingle();

  // Table already activated by staff → order flows straight to the kitchen, no
  // re-verification.
  if (open && open.status === "active") {
    const { orderId, error } = await insertSessionOrder(service, open.id, restaurantId, items);
    if (!orderId) {
      return { status: "error", sessionId: open.id, error: error ?? "Failed to create order." };
    }
    // The order shows up in the Orders queue directly — no notification row.
    revalidatePath("/employee/queue");
    return { status: "approved", sessionId: open.id };
  }

  // Reuse a still-pending session, else open a new one.
  let sessionId = open?.id as string | undefined;
  if (!sessionId && tableId && (await tableNeedsCleaning(service, tableId))) {
    return { status: "error", sessionId: null, error: "This table is being cleaned. Please ask a staff member." };
  }
  if (!sessionId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: created, error } = await (service as any)
      .from("sessions")
      .insert({
        restaurant_id: restaurantId,
        type: tableId ? "table" : "room_service",
        table_id: tableId ?? null,
        room_id: roomId ?? null,
        customer_pin: null,
        status: "pending_activation",
      })
      .select("id")
      .single();
    if (error || !created) return { status: "error", sessionId: null, error: "Could not start ordering session." };
    sessionId = created.id as string;
  }

  const { orderId, error: itemsError } = await insertSessionOrder(
    service,
    sessionId,
    restaurantId,
    items
  );
  if (!orderId) {
    return { status: "error", sessionId, error: itemsError ?? "Failed to create order." };
  }

  // Only one live activation request per session (a second order placed while
  // still pending shouldn't spam staff — it'll surface with the session once
  // approved).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existingReq } = await (service as any)
    .from("notifications")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .eq("session_id", sessionId)
    .eq("type", "table_activation_request")
    .in("status", ["new", "acknowledged"])
    .maybeSingle();

  if (!existingReq) {
    await emitTableActivationRequest(service, {
      restaurantId,
      sessionId,
      orderId,
      tableId: tableId ?? null,
      roomId: roomId ?? null,
    });
  }

  revalidatePath("/employee/notifications");
  return { status: "pending", sessionId };
}

// Tells the no-PIN customer page where its table stands: awaiting approval,
// approved (order sent), or declined. Scoped to the session (the activation
// notification survives a rejection's session close, so we can still show
// "declined"). A fresh scan with no session returns "none".
export async function getCustomerActivationState(
  restaurantId: string,
  tableId: string | null,
  roomId: string | null,
  sessionId?: string | null
): Promise<{ status: ActivationStatus; sessionId: string | null }> {
  const service = createServiceClient();

  let resolvedSessionId: string | null = null;
  let sessionStatus: string | null = null;

  if (sessionId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: s } = await (service as any)
      .from("sessions")
      .select("id, status")
      .eq("id", sessionId)
      .maybeSingle();
    if (s) {
      resolvedSessionId = s.id;
      sessionStatus = s.status;
    }
  }

  if (!resolvedSessionId && (tableId || roomId)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (service as any)
      .from("sessions")
      .select("id, status")
      .eq("restaurant_id", restaurantId)
      .in("status", ["active", "pending_activation"]);
    if (tableId) q = q.eq("table_id", tableId);
    else q = q.eq("room_id", roomId);
    const { data: s } = await q.order("opened_at", { ascending: false }).limit(1).maybeSingle();
    if (s) {
      resolvedSessionId = s.id;
      sessionStatus = s.status;
    }
  }

  if (!resolvedSessionId) return { status: "none", sessionId: null };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: notif } = await (service as any)
    .from("notifications")
    .select("status")
    .eq("session_id", resolvedSessionId)
    .eq("type", "table_activation_request")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (notif) {
    if (notif.status === "completed") return { status: "approved", sessionId: resolvedSessionId };
    if (notif.status === "resolved") return { status: "rejected", sessionId: resolvedSessionId };
    return { status: "pending", sessionId: resolvedSessionId };
  }

  if (sessionStatus === "pending_activation") return { status: "pending", sessionId: resolvedSessionId };
  if (sessionStatus === "active") return { status: "approved", sessionId: resolvedSessionId };
  return { status: "none", sessionId: resolvedSessionId };
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

  const { orderId, error } = await insertSessionOrder(service, sessionId, restaurantId, items);
  if (!orderId) return { error: error ?? "Failed to create order." };

  // The order appears in the staff Orders queue directly (driven by order rows) —
  // we deliberately do NOT create a notification row for it, so the Notifications
  // panel stays reserved for actionable events.
  revalidatePath("/employee/queue");
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
  const { data: created, error } = await (service as any)
    .from("notifications")
    .insert({
      restaurant_id: restaurantId,
      table_id: tableId ?? null,
      room_id: roomId ?? null,
      session_id: sessionId,
      type,
      status: "new",
    })
    // The row comes back so the push can name the table without a second read.
    .select("id, type, table_id, room_id, restaurant_tables ( number ), rooms ( number )")
    .single();

  if (error) return { error: error.message };

  // Wake the staff who are allowed to see this table.
  //
  // `after()` runs this once the response has already gone back to the guest. That
  // matters: the guest tapped "call waiter" and deserves an instant acknowledgement,
  // not a spinner held open while we negotiate TLS with a push service in Frankfurt.
  // It also means a push failure cannot fail the guest's request — the notification
  // row is committed either way, and the panel will show it regardless.
  //
  // Note the dedup guard above: an impatient guest tapping the button five times
  // produces ONE notification, and therefore one push. Without it this would be a
  // spam cannon pointed at the staff's lock screens.
  if (created) {
    afterResponse(async () => {
      await notifyStaff(restaurantId, {
        id: created.id,
        type: created.type,
        table_id: created.table_id,
        room_id: created.room_id,
        table_number: created.restaurant_tables?.number ?? null,
        room_number: created.rooms?.number ?? null,
      });
    });
  }

  revalidatePath("/employee/notifications");
  return {};
}

// Live feed for the customer page: the session's own orders, with per-item
// status. Scoped strictly to the session, so a guest only ever sees their own
// order — never another table's. Polled by the customer page.
//
// It used to also carry unseen `order_ready` alerts, for a one-time "your food is
// ready" toast. The `ready` state no longer exists, so there is nothing to
// announce and nothing to acknowledge.
export async function getCustomerOrderFeed(
  sessionId: string | null
): Promise<CustomerOrderFeed> {
  if (!sessionId) return { orders: [] };

  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: orderRows } = await (service as any)
    .from("session_orders")
    .select("id, created_at, session_order_items ( id, item_name, quantity, item_price, item_status, cancelled_at )")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orders: CustomerOrder[] = ((orderRows ?? []) as any[]).map((o) => {
    // A cancelled item is off the bill and back on the shelf, so it leaves the
    // guest's order too — their total must never include something they were not
    // charged for. An order whose items were all cancelled drops out below.
    const items: CustomerOrderItem[] = ((o.session_order_items ?? []) as any[])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((it: any) => !it.cancelled_at)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((it: any) => ({
        id: it.id,
        name: it.item_name,
        quantity: it.quantity,
        price: Number(it.item_price ?? 0),
        status: it.item_status,
      }));

    // Order-level status derived from its items: served once every item has gone
    // out, pending until then.
    const status: CustomerOrderStatus =
      items.length > 0 && items.every((i) => i.status === "served") ? "served" : "pending";

    const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    return { id: o.id, created_at: o.created_at, status, total, items };
  })
  // Only surface orders that still have items (defensive).
  .filter((o) => o.items.length > 0);

  return { orders };
}
