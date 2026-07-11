"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasPermission, PERMISSIONS, NAV_ACCESS } from "@/lib/permissions";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";
import { buildVisibilityFilter, getAssignedWorkstationIds } from "@/lib/assignments";
import { emitOrderReadyNotification } from "@/lib/notify";
import { computeCreditStats, settlementOf } from "@/lib/credits";
import type { BillSettlement, CreditStats } from "@/lib/credits";

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

  // Only "Menu + Ordering (With PIN)" restaurants use a customer ordering PIN.
  // No-PIN and view-only restaurants get a plain session (no PIN gate / UI).
  const customer_pin = await pinForNewSession(service, ru.restaurant_id);
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

// A customer ordering PIN is only meaningful in "With PIN" mode. For no-PIN and
// view-only restaurants we open sessions without one so the staff session screen
// never surfaces a PIN and the customer never sees a PIN gate.
async function pinForNewSession(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any,
  restaurantId: string
): Promise<string | null> {
  const { data: restaurant } = await service
    .from("restaurants")
    .select("qr_mode")
    .eq("id", restaurantId)
    .maybeSingle();
  const qrMode = restaurant?.qr_mode ?? "ordering_enabled";
  return qrMode === "ordering_enabled"
    ? String(Math.floor(1000 + Math.random() * 9000))
    : null;
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

  const customer_pin = await pinForNewSession(service, ru.restaurant_id);
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

// ─── Table Activation Requests (Menu + Ordering without PIN) ───────────────────
// A no-PIN customer's first order opens a `pending_activation` session (kept out
// of the kitchen queue + table overview) and raises a `table_activation_request`
// notification. Front-of-house staff Accept or Reject it here.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadActivationRequest(service: any, ru: { restaurant_id: string }, notificationId: string) {
  const { data: notif } = await service
    .from("notifications")
    .select("id, restaurant_id, session_id, order_id, table_id, room_id, type, status")
    .eq("id", notificationId)
    .maybeSingle();

  if (!notif || notif.restaurant_id !== ru.restaurant_id || notif.type !== "table_activation_request") {
    return null;
  }
  return notif;
}

export async function approveTableActivation(notificationId: string): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  const service = createServiceClient();

  const notif = await loadActivationRequest(service, ru, notificationId);
  if (!notif) return { error: "Request not found." };

  // Table-group isolation: staff may only act on tables/rooms they can see.
  const visibility = await buildVisibilityFilter(ru.restaurant_id, ru);
  if (!visibility.seesAll && !(visibility.canSeeTable(notif.table_id) && visibility.canSeeRoom(notif.room_id))) {
    return { error: "Not allowed." };
  }

  // Idempotent: a second Accept (e.g. double-tap) is a no-op.
  if (notif.status === "completed") {
    revalidatePath("/employee/notifications");
    return null;
  }

  if (notif.session_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any)
      .from("sessions")
      .update({ status: "active", closed_at: null })
      .eq("id", notif.session_id)
      .eq("restaurant_id", ru.restaurant_id);
  }

  // The table is now active, so the held order surfaces in the Orders queue for
  // the kitchen/workstations. No `new_order` notification is created — the queue
  // is the dedicated place for orders.

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any)
    .from("notifications")
    .update({ status: "completed", acknowledged_at: new Date().toISOString() })
    .eq("id", notif.id);

  revalidatePath("/employee/notifications");
  revalidatePath("/employee/queue");
  revalidatePath("/employee/dashboard");
  return null;
}

export async function rejectTableActivation(notificationId: string): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  const service = createServiceClient();

  const notif = await loadActivationRequest(service, ru, notificationId);
  if (!notif) return { error: "Request not found." };

  const visibility = await buildVisibilityFilter(ru.restaurant_id, ru);
  if (!visibility.seesAll && !(visibility.canSeeTable(notif.table_id) && visibility.canSeeRoom(notif.room_id))) {
    return { error: "Not allowed." };
  }

  if (notif.status === "resolved") {
    revalidatePath("/employee/notifications");
    return null;
  }

  // Close the pending session — the held order never reaches the kitchen (the
  // queue only reads active sessions) and the table stays free.
  if (notif.session_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any)
      .from("sessions")
      .update({ status: "closed", closed_at: new Date().toISOString() })
      .eq("id", notif.session_id)
      .eq("restaurant_id", ru.restaurant_id)
      .eq("status", "pending_activation"); // never close an already-active table
  }

  // Keep the notification as the record of the decision — the customer page
  // polls it to show the "request declined" state.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any)
    .from("notifications")
    .update({ status: "resolved", acknowledged_at: new Date().toISOString() })
    .eq("id", notif.id);

  revalidatePath("/employee/notifications");
  return null;
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

  // The order shows up in the Orders queue (driven by order rows) — no
  // `new_order` notification is created, keeping the Notifications panel for
  // actionable events only.
  revalidatePath("/employee/queue");
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

  // Tell the customer their food is ready — but only once the *whole* order is
  // ready (every item ready or served). A single item flipping in a multi-item
  // order shouldn't fire the alert. Reuses the notification system, scoped to
  // the session so only that guest is notified.
  if (status === "ready") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: orderItems } = await (service as any)
      .from("session_order_items")
      .select("item_status")
      .eq("order_id", item.order_id);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all = (orderItems ?? []) as { item_status: string }[];
    const fullyReady =
      all.length > 0 &&
      all.every((it) => it.item_status === "ready" || it.item_status === "served") &&
      all.some((it) => it.item_status === "ready");

    if (fullyReady) {
      // Dedup: don't re-alert if this order already has an order_ready event.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existing } = await (service as any)
        .from("notifications")
        .select("id")
        .eq("order_id", item.order_id)
        .eq("type", "order_ready")
        .maybeSingle();

      if (!existing) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: session } = await (service as any)
          .from("sessions")
          .select("table_id, room_id")
          .eq("id", order.session_id)
          .maybeSingle();
        await emitOrderReadyNotification(service, {
          restaurantId: ru.restaurant_id,
          sessionId: order.session_id,
          orderId: item.order_id,
          tableId: session?.table_id ?? null,
          roomId: session?.room_id ?? null,
        });
      }
    }
  }

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

  const sessionId    = formData.get("session_id") as string;
  const method       = ((formData.get("payment_method") as string) || "cash").toLowerCase();
  const cashAmount   = parseFloat(formData.get("cash_amount")   as string) || 0;
  const onlineAmount = parseFloat(formData.get("online_amount") as string) || 0;
  const cardAmount   = parseFloat(formData.get("card_amount")   as string) || 0;
  const totalAmount  = parseFloat(formData.get("total_amount")  as string);

  const validMethods = ["cash", "online", "card", "mixed", "credit"];
  if (!validMethods.includes(method)) return { error: "Invalid payment method." };
  if (isNaN(totalAmount) || totalAmount < 0) return { error: "Invalid total amount." };
  if (cashAmount < 0 || onlineAmount < 0 || cardAmount < 0) {
    return { error: "Amounts cannot be negative." };
  }

  if (method === "mixed") {
    if (Math.abs(cashAmount + onlineAmount - totalAmount) > 0.01) {
      return { error: "The combined Cash and Online amounts must equal the total payable amount." };
    }
  }

  // ── Credit: close the bill with part (or all) of it still owed ──────────────
  // The payment row, the credit and the session close are written together by
  // `close_bill_with_credit` so a bill can never be closed without its credit
  // (or vice-versa). No second bill is created — the payments row still carries
  // the FULL bill value, and only the tendered split is recorded against it.
  if (method === "credit") {
    if (!NAV_ACCESS.canManageCredits(ru)) {
      return { error: "You don't have permission to put a bill on credit." };
    }

    // Either the cashier picked an existing credit account (the returning
    // customer), or they're creating one. Picking an existing account is what
    // stops a regular from collecting a second Credit ID.
    const customerId    = ((formData.get("credit_customer_id")    as string) || "").trim();
    const customerName  = ((formData.get("credit_customer_name")  as string) || "").trim();
    const customerPhone = ((formData.get("credit_customer_phone") as string) || "").trim();
    const creditNotes   = ((formData.get("credit_notes")          as string) || "").trim();

    if (!customerId && !customerName) {
      return { error: "Choose an existing customer, or enter a name for a new credit account." };
    }
    if (totalAmount <= 0) return { error: "Invalid total amount." };

    const paidNow = cashAmount + onlineAmount + cardAmount;
    if (paidNow >= totalAmount) {
      return {
        error: "Nothing would be left on credit. Use Cash, Online or Card to settle the bill in full.",
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: customer, error } = await (service as any).rpc("close_bill_with_credit", {
      p_restaurant_id:  ru.restaurant_id,
      p_session_id:     sessionId,
      p_total:          totalAmount,
      p_cash:           cashAmount,
      p_online:         onlineAmount,
      p_card:           cardAmount,
      // An existing account wins; otherwise the RPC finds-or-creates one by phone.
      p_customer_id:    customerId || null,
      p_customer_name:  customerName || null,
      p_customer_phone: customerPhone || null,
      p_notes:          creditNotes || null,
      p_created_by:     ru.id,
    });

    if (error) {
      const msg = error.message ?? "";
      if (msg.includes("SESSION_NOT_OPEN")) {
        return { error: "This session has already been closed." };
      }
      if (msg.includes("INVALID_DOWN_PAYMENT")) {
        return { error: "The amount paid now must be less than the bill total." };
      }
      if (msg.includes("CUSTOMER_NAME_REQUIRED")) {
        return { error: "Enter the customer's name." };
      }
      if (msg.includes("CUSTOMER_NOT_FOUND")) {
        return { error: "That customer's credit account no longer exists." };
      }
      return { error: "Could not put this bill on credit. Please try again." };
    }

    revalidatePath("/employee/dashboard");
    revalidatePath("/employee/credits");
    revalidatePath("/employee/sales");
    revalidatePath(`/employee/session/${sessionId}`);

    // Back to the STAFF DASHBOARD (not the standalone Credits page), which scrolls
    // to its Credits section and opens this customer's account. `redirect` from a
    // server action is a client-side RSC navigation, not a full page reload.
    redirect(`/employee/dashboard?credit=${customer?.id ?? ""}`);
  }

  // ── Paid in full ────────────────────────────────────────────────────────────
  // cash/online/mixed carry their split; card records the whole value under
  // card_amount. In every case the split adds up to the total.
  const split =
    method === "card"
      ? { cash_amount: 0, online_amount: 0, card_amount: totalAmount }
      : { cash_amount: cashAmount, online_amount: onlineAmount, card_amount: 0 };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any).from("payments").insert({
    restaurant_id:  ru.restaurant_id,
    session_id:     sessionId,
    amount:         totalAmount,
    ...split,
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

// Whether a session has any placed order items (used to decide who may close it).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sessionHasOrders(service: any, sessionId: string): Promise<boolean> {
  const { data: orders } = await service
    .from("session_orders")
    .select("id")
    .eq("session_id", sessionId);
  const orderIds = ((orders ?? []) as { id: string }[]).map((o) => o.id);
  if (orderIds.length === 0) return false;

  const { data: items } = await service
    .from("session_order_items")
    .select("id")
    .in("order_id", orderIds)
    .limit(1);
  return ((items ?? []) as unknown[]).length > 0;
}

// Force close (deactivate) a table/room session without taking payment.
//
// Access rules:
//  - Cashiers / managers (CLOSE_BILLS or MANAGE_TABLES) may force close ANY of
//    their sessions, orders or not — existing behavior, unchanged.
//  - Any assigned staff member (table-group / room visibility) may force close a
//    session ONLY while it has no orders — e.g. a table opened by mistake. Once
//    an order exists, closing is reserved for the Cashier.
export async function forceCloseSession(sessionId: string): Promise<ActionResult> {
  const ru = await getRestaurantUser();
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

  const privileged =
    hasPermission(ru, PERMISSIONS.CLOSE_BILLS) ||
    hasPermission(ru, PERMISSIONS.MANAGE_TABLES);

  // Table-group isolation: non-privileged staff may only act on tables/rooms they
  // are assigned to (admins / managers see all).
  const visibility = await buildVisibilityFilter(ru.restaurant_id, ru);
  const isAssigned =
    visibility.seesAll ||
    (visibility.canSeeTable(session.table_id) && visibility.canSeeRoom(session.room_id));

  if (!privileged && !isAssigned) return { error: "Permission denied." };

  // Non-privileged staff may only deactivate an empty (accidentally opened)
  // session — a table with orders is the Cashier's to close.
  if (!privileged && (await sessionHasOrders(service, sessionId))) {
    return { error: "This table contains active orders and can only be closed by the Cashier." };
  }

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
  /** The FULL value of the bill — including anything that went on credit. */
  amount: number;
  method: string;
  cash_amount: number;
  online_amount: number;
  card_amount: number;
  created_at: string;
  table_number: string | null;
  room_number: string | null;
  session_type: string | null;
  customer_name: string | null;
  /** Paid in full / partially on credit / fully on credit. */
  settlement: BillSettlement;
  /** Present only when the bill was closed with a balance owing. */
  credit_id: string | null;
  credit_number: string | null;
  /** The amount that went on credit when this bill was closed. */
  credit_unpaid: number;
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
  /**
   * How the period's billed value was tendered. `credit` is the part that was
   * NOT paid — so cash + online + card + credit + other = periodTotal, and the
   * breakdown always explains the whole of Sales.
   */
  breakdown: { cash: number; online: number; card: number; credit: number; other: number };
  /** Outstanding / collected / created, plus status counts. */
  credit: CreditStats;
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
  const emptyCredit: CreditStats = {
    outstanding: 0,
    collected: 0,
    created: 0,
    pendingCount: 0,
    fullyPaidCount: 0,
    openCount: 0,
  };

  if (!NAV_ACCESS.canSeeSales(ru)) {
    return {
      period: params?.period ?? "today",
      from: params?.from ?? null,
      to: params?.to ?? null,
      overview: { today: 0, week: 0, month: 0, year: 0, total: 0 },
      periodTotal: 0,
      orderCount: 0,
      avgOrderValue: 0,
      breakdown: { cash: 0, online: 0, card: 0, credit: 0, other: 0 },
      credit: emptyCredit,
      transactions: [],
    };
  }

  const period = params?.period ?? "today";
  const service = createServiceClient();

  // `credits` is embedded off `payments` via credits.payment_id — a bill that
  // went on credit carries its credit record with it, so no second query per row.
  // Credit figures are only fetched for staff allowed to see customer debt.
  const canSeeCredits = NAV_ACCESS.canManageCredits(ru);

  // Outstanding is counted over ACCOUNTS (who owes), credit-extended over BILLS.
  const [paymentsRes, accountsRes, creditsRes, repaymentsRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("payments")
      .select(
        "id, amount, total_amount, cash_amount, online_amount, card_amount, payment_method, created_at, sessions ( type, restaurant_tables ( number ), rooms ( number ), credit_customers ( name ) ), credits ( id, credit_number, customer_name, down_payment )"
      )
      .eq("restaurant_id", ru.restaurant_id)
      .order("created_at", { ascending: false }),
    canSeeCredits
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (service as any)
          .from("credit_customers")
          .select("balance")
          .eq("restaurant_id", ru.restaurant_id)
      : Promise.resolve({ data: [] }),
    canSeeCredits
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (service as any)
          .from("credits")
          .select("bill_amount, down_payment, created_at")
          .eq("restaurant_id", ru.restaurant_id)
      : Promise.resolve({ data: [] }),
    canSeeCredits
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (service as any)
          .from("credit_payments")
          .select("amount, created_at")
          .eq("restaurant_id", ru.restaurant_id)
      : Promise.resolve({ data: [] }),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (paymentsRes.data ?? []) as any[];

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const startOfYear = new Date(now.getFullYear(), 0, 1).getTime();

  const { fromMs, toMs } = resolveSalesRange(period, params?.from, params?.to);

  const overview = { today: 0, week: 0, month: 0, year: 0, total: 0 };
  const breakdown = { cash: 0, online: 0, card: 0, credit: 0, other: 0 };
  let periodTotal = 0;
  let orderCount = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inRange: any[] = [];

  for (const p of rows) {
    // A credit bill still records its FULL value here — accrual: the sale
    // happened when it was billed, whether or not the money has arrived.
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
      const card = Number(p.card_amount ?? 0);
      periodTotal += value;
      orderCount += 1;

      // Every row carries its tendered split; the breakdown is what was actually
      // taken, by tender.
      breakdown.cash += cash;
      breakdown.online += online;
      breakdown.card += card;

      if (p.payment_method === "credit") {
        // The gap between the bill and what was tendered went on credit.
        breakdown.credit += Math.max(0, value - (cash + online + card));
      } else if (p.payment_method === "card" && card === 0) {
        // Legacy card rows, written before card_amount existed, carry the whole
        // value under amount only.
        breakdown.card += value;
      } else if (p.payment_method === "upi" || p.payment_method === "other") {
        breakdown.other += value;
      }
      inRange.push(p);
    }
  }

  const avgOrderValue = orderCount > 0 ? periodTotal / orderCount : 0;

  const transactions: SalesTxn[] = inRange.slice(0, 200).map((p) => {
    const value = Number(p.total_amount ?? p.amount ?? 0);
    const cash = Number(p.cash_amount ?? 0);
    const online = Number(p.online_amount ?? 0);
    const card = Number(p.card_amount ?? 0);
    // Reverse embed — 0 or 1 credit per payment.
    const credit = Array.isArray(p.credits) ? p.credits[0] ?? null : p.credits ?? null;
    const settlement = settlementOf({
      payment_method: p.payment_method,
      total_amount: value,
      cash_amount: cash,
      online_amount: online,
      card_amount: card,
    });

    return {
      id: p.id,
      amount: value,
      method: p.payment_method,
      cash_amount: cash,
      online_amount: online,
      card_amount: card,
      created_at: p.created_at,
      table_number: p.sessions?.restaurant_tables?.number ?? null,
      room_number: p.sessions?.rooms?.number ?? null,
      session_type: p.sessions?.type ?? null,
      // The credit record names the customer who owes; fall back to any legacy
      // customer attached to the session.
      customer_name: credit?.customer_name ?? p.sessions?.credit_customers?.name ?? null,
      settlement,
      credit_id: credit?.id ?? null,
      credit_number: credit?.credit_number ?? null,
      credit_unpaid:
        settlement === "paid" ? 0 : Math.max(0, value - (cash + online + card)),
    };
  });

  return {
    period,
    from: params?.from ?? null,
    to: params?.to ?? null,
    overview,
    periodTotal,
    orderCount,
    avgOrderValue,
    breakdown,
    credit: computeCreditStats(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (accountsRes.data ?? []) as any[],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (creditsRes.data ?? []) as any[],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (repaymentsRes.data ?? []) as any[],
      fromMs,
      toMs
    ),
    transactions,
  };
}

// ─── Sales CSV Export ─────────────────────────────────────────────────────────
// Exports the sales transactions for the SAME filter the Sales screen is showing
// (period or custom range). Reuses `resolveSalesRange` + the `payments` table, so
// numbers match the dashboard exactly. Unlike the on-screen list this is not
// capped at 200 rows. Self-authing + sales-permission gated.

const SALES_METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  online: "Online",
  mixed: "Cash + Online",
  card: "Card",
  credit: "Credit",
  upi: "UPI",
  other: "Other",
};

const SALES_STATUS_LABEL: Record<BillSettlement, string> = {
  paid: "Paid in Full",
  partial_credit: "Partially Paid (Credit)",
  full_credit: "Fully on Credit",
};

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

export async function exportSalesCsv(params?: {
  period?: SalesPeriod;
  from?: string | null;
  to?: string | null;
}): Promise<{ filename: string; csv: string } | { error: string }> {
  const ru = await getRestaurantUser();
  if (!NAV_ACCESS.canSeeSales(ru)) {
    return { error: "You don't have permission to export sales." };
  }

  const period = params?.period ?? "today";
  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("payments")
    .select(
      "id, amount, total_amount, cash_amount, online_amount, card_amount, payment_method, created_at, created_by, sessions ( type, restaurant_tables ( number ), rooms ( number ), credit_customers ( name ) ), credits ( credit_number, customer_name )"
    )
    .eq("restaurant_id", ru.restaurant_id)
    .order("created_at", { ascending: false });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []) as any[];
  const { fromMs, toMs } = resolveSalesRange(period, params?.from, params?.to);
  const inRange = rows.filter((p) => {
    const ts = new Date(p.created_at).getTime();
    return ts >= fromMs && ts <= toMs;
  });

  // Resolve cashier (created_by) → display name in one lookup.
  const cashierIds = [...new Set(inRange.map((p) => p.created_by).filter(Boolean))] as string[];
  const cashierNames = new Map<string, string>();
  if (cashierIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: users } = await (service as any)
      .from("restaurant_users")
      .select("id, display_name")
      .in("id", cashierIds);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const u of (users ?? []) as any[]) cashierNames.set(u.id, u.display_name);
  }

  const header = [
    "Date & Time",
    "Bill/Order ID",
    "Table Number",
    "Customer",
    "Payment Method",
    "Payment Status",
    "Total Amount",
    "Amount Paid",
    "On Credit",
    "Credit ID",
    "Cashier",
    "Transaction Status",
  ];
  const lines = [header.map(csvCell).join(",")];

  for (const p of inRange) {
    const dt = new Date(p.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
    const table = p.sessions?.restaurant_tables?.number
      ? `Table ${p.sessions.restaurant_tables.number}`
      : p.sessions?.rooms?.number
      ? `Room ${p.sessions.rooms.number}`
      : p.sessions?.type === "walk_in"
      ? "Walk-in"
      : "";

    const value = Number(p.total_amount ?? p.amount ?? 0);
    const cash = Number(p.cash_amount ?? 0);
    const online = Number(p.online_amount ?? 0);
    const card = Number(p.card_amount ?? 0);
    const credit = Array.isArray(p.credits) ? p.credits[0] ?? null : p.credits ?? null;

    const settlement = settlementOf({
      payment_method: p.payment_method,
      total_amount: value,
      cash_amount: cash,
      online_amount: online,
      card_amount: card,
    });

    // A credit bill is billed in full but only part-tendered — spell out both the
    // money taken and the money still owed, so the sheet reconciles.
    const tendered = settlement === "paid" ? value : cash + online + card;
    const onCredit = Math.max(0, value - tendered);

    const customer = credit?.customer_name ?? p.sessions?.credit_customers?.name ?? "";
    const method = SALES_METHOD_LABEL[p.payment_method] ?? p.payment_method ?? "";
    const cashier = cashierNames.get(p.created_by) ?? "";

    lines.push(
      [
        dt,
        p.id,
        table,
        customer,
        method,
        SALES_STATUS_LABEL[settlement],
        value.toFixed(2),
        tendered.toFixed(2),
        onCredit.toFixed(2),
        credit?.credit_number ?? "",
        cashier,
        "Completed",
      ]
        .map(csvCell)
        .join(",")
    );
  }

  // Leading BOM so Excel opens UTF-8 correctly; CRLF line endings for Windows.
  const csv = "﻿" + lines.join("\r\n");
  const stamp = new Date().toISOString().slice(0, 10);
  return { filename: `sales_${period}_${stamp}.csv`, csv };
}

// ─── Reprint a Paid Bill ──────────────────────────────────────────────────────
// Reassembles a completed transaction's receipt from the existing `payments`
// row + its session's orders/items — no new bill or record is created. Used by
// the Sales dashboard to reprint a bill after payment. Sales-permission gated.

export type PaidBillItem = { id: string; item_name: string; item_price: number; quantity: number };

export type PaidBill = {
  payment_id: string;
  created_at: string;
  method: string;
  cash_amount: number;
  online_amount: number;
  card_amount: number;
  total: number;
  cashier_name: string | null;
  order_ids: string[];
  location: string;
  restaurant: {
    name: string;
    address: string | null;
    contact_phone: string | null;
    pan_vat_number: string | null;
    tax_percent?: number;
    service_charge_percent?: number;
  };
  items: PaidBillItem[];
  /** Paid in full, or closed with a balance owing. */
  settlement: BillSettlement;
  /** Present only for a bill that went on credit — the state of that debt NOW. */
  credit: {
    credit_number: string;
    customer_name: string;
    customer_phone: string | null;
    paid_amount: number;
    balance: number;
  } | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function settingsNumber(settings: any, ...keys: string[]): number | undefined {
  if (!settings || typeof settings !== "object") return undefined;
  for (const k of keys) {
    const v = Number(settings[k]);
    if (!Number.isNaN(v) && v > 0) return v;
  }
  return undefined;
}

export async function getPaidBill(paymentId: string): Promise<PaidBill | { error: string }> {
  const ru = await getRestaurantUser();
  if (!NAV_ACCESS.canSeeSales(ru)) {
    return { error: "You don't have permission to view bills." };
  }

  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: p } = await (service as any)
    .from("payments")
    .select(
      "id, amount, total_amount, cash_amount, online_amount, card_amount, payment_method, created_at, created_by, session_id, restaurant_id, sessions ( type, restaurant_tables ( number ), rooms ( number ) ), credits ( credit_number, customer_name, customer_phone, paid_amount, balance )"
    )
    .eq("id", paymentId)
    .maybeSingle();

  if (!p || p.restaurant_id !== ru.restaurant_id) return { error: "Bill not found." };

  // Items via the session's orders (the same records the bill was totalled from).
  let items: PaidBillItem[] = [];
  let order_ids: string[] = [];
  if (p.session_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: orders } = await (service as any)
      .from("session_orders")
      .select("id")
      .eq("session_id", p.session_id);
    order_ids = ((orders ?? []) as { id: string }[]).map((o) => o.id);
    if (order_ids.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: its } = await (service as any)
        .from("session_order_items")
        .select("id, item_name, item_price, quantity, created_at")
        .in("order_id", order_ids)
        .order("created_at");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items = ((its ?? []) as any[]).map((it) => ({
        id: it.id,
        item_name: it.item_name,
        item_price: Number(it.item_price),
        quantity: it.quantity,
      }));
    }
  }

  // Cashier name (created_by → restaurant_users.display_name).
  let cashier_name: string | null = null;
  if (p.created_by) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: u } = await (service as any)
      .from("restaurant_users")
      .select("display_name")
      .eq("id", p.created_by)
      .maybeSingle();
    cashier_name = u?.display_name ?? null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rest } = await (service as any)
    .from("restaurants")
    .select("name, address, contact_phone, pan_vat_number, settings")
    .eq("id", ru.restaurant_id)
    .maybeSingle();

  const location = p.sessions?.restaurant_tables?.number
    ? `Table ${p.sessions.restaurant_tables.number}`
    : p.sessions?.rooms?.number
    ? `Room ${p.sessions.rooms.number}`
    : p.sessions?.type === "walk_in"
    ? "Walk-in"
    : "—";

  const total = Number(p.total_amount ?? p.amount ?? 0);
  const cash = Number(p.cash_amount ?? 0);
  const online = Number(p.online_amount ?? 0);
  const card = Number(p.card_amount ?? 0);
  const credit = Array.isArray(p.credits) ? p.credits[0] ?? null : p.credits ?? null;

  return {
    payment_id: p.id,
    created_at: p.created_at,
    method: p.payment_method,
    cash_amount: cash,
    online_amount: online,
    card_amount: card,
    total,
    cashier_name,
    order_ids,
    location,
    restaurant: {
      name: rest?.name ?? "Restaurant",
      address: rest?.address ?? null,
      contact_phone: rest?.contact_phone ?? null,
      pan_vat_number: rest?.pan_vat_number ?? null,
      tax_percent: settingsNumber(rest?.settings, "tax_percent", "tax_rate", "gst_percent"),
      service_charge_percent: settingsNumber(rest?.settings, "service_charge_percent", "service_charge"),
    },
    items,
    settlement: settlementOf({
      payment_method: p.payment_method,
      total_amount: total,
      cash_amount: cash,
      online_amount: online,
      card_amount: card,
    }),
    credit: credit
      ? {
          credit_number: credit.credit_number,
          customer_name: credit.customer_name,
          customer_phone: credit.customer_phone ?? null,
          paid_amount: Number(credit.paid_amount),
          balance: Number(credit.balance),
        }
      : null,
  };
}
