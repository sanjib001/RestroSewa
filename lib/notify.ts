// Helpers to raise notifications through the shared notifications table.
//
// Note: placing an order does NOT create a notification. Orders live in the
// Orders queue (driven by order rows); the Notifications panel is reserved for
// actionable events (table activation requests, waiter calls, bill requests).

import { afterResponse } from "@/lib/push/after";
import { notifyStaff } from "@/lib/push/send";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceClient = any;

type ItemRow = { item_name: string; quantity: number; item_price: number | string | null };

// Raises a "table activation request" for no-PIN ordering. The customer has
// placed a first order against a `pending_activation` session (invisible to the
// kitchen queue / table overview); this alerts front-of-house staff who can see
// the table so they can Accept (activate + send to kitchen) or Reject it. The
// order_id lets the staff card show the order summary; routing to the right
// table-group happens on read (workstation-only staff never see it).
export async function emitTableActivationRequest(
  service: ServiceClient,
  params: {
    restaurantId: string;
    sessionId: string;
    orderId: string;
    tableId: string | null;
    roomId: string | null;
  }
): Promise<void> {
  const { data: created } = await service
    .from("notifications")
    .insert({
      restaurant_id: params.restaurantId,
      table_id: params.tableId,
      room_id: params.roomId,
      session_id: params.sessionId,
      order_id: params.orderId,
      type: "table_activation_request",
      status: "new",
    })
    .select("id, type, table_id, room_id, restaurant_tables ( number ), rooms ( number )")
    .single();

  if (!created) return;

  // An activation request is the one alert with real money attached — staff are being
  // asked to approve an order from a table that isn't even open yet. So the push
  // carries the item count and the total, and the decision can be made from the lock
  // screen rather than requiring a walk to the till to find out what's at stake.
  const { data: items } = await service
    .from("session_order_items")
    .select("item_name, quantity, item_price")
    .eq("order_id", params.orderId)
    .is("cancelled_at", null);

  const summary = ((items ?? []) as ItemRow[]).map((it) => ({
    name: it.item_name,
    quantity: it.quantity,
    price: Number(it.item_price ?? 0),
  }));

  // After the response, so the guest placing the order isn't held up by a push
  // service — and so a push failure can never fail their order.
  afterResponse(async () => {
    await notifyStaff(params.restaurantId, {
      id: created.id,
      type: created.type,
      table_id: created.table_id,
      room_id: created.room_id,
      table_number: created.restaurant_tables?.number ?? null,
      room_number: created.rooms?.number ?? null,
      order_summary: summary,
      order_total: summary.reduce((s, i) => s + i.price * i.quantity, 0),
    });
  });
}

// `emitOrderReadyNotification` used to live here. It fired when every item on an
// order turned `ready`, telling the guest their food was on its way.
//
// The `ready` state has been removed from the system — an item is now either
// pending or served — so there is no moment left at which to raise it. The 49
// historical `order_ready` rows stay in the table as history; nothing writes a
// new one, and the staff panel already filtered them out.

// ─── Workstation events: the chef's and the bartender's alerts ────────────────
//
// These are the two people who most need a phone to buzz — hands full, back to the
// screen — and until now they received nothing at all, because the notification
// routing deliberately excludes workstation staff from front-of-house service calls.
//
// The notification rows are written for PUSH, not for the panel. `new_order` has
// always been excluded from the Notifications list (an order belongs in the Orders
// queue, not in a list of things to acknowledge) and it stays excluded. Both things
// are true at once: it should not appear in a list, and it IS worth waking someone
// for.

type OrderItemRow = {
  workstation_id: string | null;
  workstation_name: string | null;
  item_name: string;
  quantity: number;
  item_price: number | string | null;
};

export type StationWork = Map<string, { name: string; items: OrderItemRow[] }>;

/**
 * Read an order's live items, grouped by the station that has to make them.
 *
 * MUST BE CALLED BEFORE A CANCELLATION LANDS. It filters out cancelled rows — which
 * is right for a new order and exactly wrong for a cancellation, where by the time
 * the RPC returns there is nothing left to name. So cancellation captures first, then
 * cancels, then emits what it captured.
 *
 * @param itemIds restrict to these items (a single-item cancellation); omit for the
 *                whole order.
 */
export async function captureStations(
  service: ServiceClient,
  orderId: string,
  itemIds?: string[]
): Promise<StationWork> {
  let q = service
    .from("session_order_items")
    .select("id, workstation_id, workstation_name, item_name, quantity, item_price")
    .eq("order_id", orderId)
    .is("cancelled_at", null);

  if (itemIds?.length) q = q.in("id", itemIds);

  const { data } = await q;

  const byStation: StationWork = new Map();

  for (const it of ((data ?? []) as OrderItemRow[])) {
    // An item with no station has nobody to route to — a menu item the admin never
    // assigned to one. It still reaches the Orders queue; it just cannot ring a
    // phone, because there is no phone to ring.
    if (!it.workstation_id) continue;

    if (!byStation.has(it.workstation_id)) {
      byStation.set(it.workstation_id, {
        name: it.workstation_name ?? "your station",
        items: [],
      });
    }
    byStation.get(it.workstation_id)!.items.push(it);
  }

  return byStation;
}

/**
 * The order's place in the restaurant — which table, which room, whose session.
 * Everything the alert needs to say WHERE, in one read.
 */
export async function loadOrderContext(
  service: ServiceClient,
  restaurantId: string,
  orderId: string
): Promise<OrderContext | null> {
  const { data } = await service
    .from("session_orders")
    .select(
      "id, session_id, sessions ( status, table_id, room_id, restaurant_tables ( number ), rooms ( number ) )"
    )
    .eq("id", orderId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();

  if (!data) return null;

  const s = data.sessions;
  return {
    restaurantId,
    orderId,
    sessionId: data.session_id ?? null,
    sessionStatus: s?.status ?? null,
    tableId: s?.table_id ?? null,
    roomId: s?.room_id ?? null,
    tableNumber: s?.restaurant_tables?.number ?? null,
    roomNumber: s?.rooms?.number ?? null,
  };
}

type OrderContext = {
  restaurantId: string;
  orderId: string;
  tableId: string | null;
  roomId: string | null;
  sessionId: string | null;
  sessionStatus: string | null;
  tableNumber: string | null;
  roomNumber: string | null;
};

/**
 * Raise a per-station alert for an order.
 *
 * ONE NOTIFICATION PER STATION, not one per order. An order of two cocktails and a
 * curry is two different jobs in two different rooms, and a single alert saying
 * "3 items" would tell the bartender nothing about what to pour and the chef nothing
 * about what to cook. So the Bar gets an alert naming the cocktails and the Kitchen
 * gets one naming the curry — and each is tagged by station, so they don't collapse
 * into one another in the tray.
 */
async function emitWorkstationOrderEvent(
  service: ServiceClient,
  type: "new_order" | "order_cancelled",
  ctx: OrderContext,
  byStation: StationWork
): Promise<void> {
  if (byStation.size === 0) return;

  for (const [workstationId, station] of byStation) {
    const { data: created } = await service
      .from("notifications")
      .insert({
        restaurant_id: ctx.restaurantId,
        table_id: ctx.tableId,
        room_id: ctx.roomId,
        session_id: ctx.sessionId,
        order_id: ctx.orderId,
        type,
        status: "new",
      })
      .select("id")
      .single();

    if (!created) continue;

    const summary = station.items.map((it) => ({
      name: it.item_name,
      quantity: it.quantity,
      price: Number(it.item_price ?? 0),
    }));

    afterResponse(async () => {
      await notifyStaff(ctx.restaurantId, {
        id: created.id,
        type,
        table_id: ctx.tableId,
        room_id: ctx.roomId,
        table_number: ctx.tableNumber,
        room_number: ctx.roomNumber,
        workstation_ids: [workstationId],
        workstation_name: station.name,
        order_summary: summary,
        order_total: summary.reduce((s, i) => s + i.price * i.quantity, 0),
      });
    });
  }
}

/**
 * A new order has hit the queue — wake the stations that have to make it.
 *
 * SAFE TO CALL FROM ANYWHERE an order is written, including the no-PIN path where the
 * order is HELD pending a staff member's approval. That is why the session status is
 * checked here rather than at each call site: an order against a `pending_activation`
 * session is invisible to the kitchen queue by design — the guest has ordered, but no
 * one has agreed to serve them yet — and ringing the chef's phone about food they must
 * not start cooking would be worse than useless. The kitchen is told when the table is
 * approved, which is the moment the order actually becomes theirs.
 *
 * Putting the guard in one place means a future call site cannot forget it.
 */
export async function emitNewOrder(
  service: ServiceClient,
  restaurantId: string,
  orderId: string
): Promise<void> {
  const ctx = await loadOrderContext(service, restaurantId, orderId);
  if (!ctx) return;
  if (ctx.sessionStatus !== "active") return; // held — the kitchen isn't cooking this yet

  const byStation = await captureStations(service, orderId);
  await emitWorkstationOrderEvent(service, "new_order", ctx, byStation);

  // …and the floor's copy: one plain alert to everyone who COVERS this table.
  await emitGeneralNewOrder(service, ctx);
}

/**
 * The front-of-house copy of a new order.
 *
 * One plain alert — "New order — Table A3 · 3 items" — to everyone who COVERS this table (waiter,
 * cashier, manager), routed by PLACE, not station. The stations already got their item-specific
 * alerts above; `canSeeNotification` deliberately excludes workstation staff, so the two audiences
 * are DISJOINT and nobody is pinged twice.
 *
 * It names the WHOLE order as a count (front-of-house cares that an order landed, not which station
 * makes what), and it fires even when no item has a station assigned — an unrouted menu item still
 * needs a waiter to know it was ordered, and previously nobody was told.
 */
async function emitGeneralNewOrder(service: ServiceClient, ctx: OrderContext): Promise<void> {
  const { data: created } = await service
    .from("notifications")
    .insert({
      restaurant_id: ctx.restaurantId,
      table_id: ctx.tableId,
      room_id: ctx.roomId,
      session_id: ctx.sessionId,
      order_id: ctx.orderId,
      type: "new_order",
      status: "new",
    })
    .select("id")
    .single();

  if (!created) return;

  const { data: items } = await service
    .from("session_order_items")
    .select("item_name, quantity, item_price")
    .eq("order_id", ctx.orderId)
    .is("cancelled_at", null);

  const summary = ((items ?? []) as ItemRow[]).map((it) => ({
    name: it.item_name,
    quantity: it.quantity,
    price: Number(it.item_price ?? 0),
  }));

  afterResponse(async () => {
    await notifyStaff(ctx.restaurantId, {
      id: created.id,
      type: "new_order",
      table_id: ctx.tableId,
      room_id: ctx.roomId,
      table_number: ctx.tableNumber,
      room_number: ctx.roomNumber,
      // No workstation_ids ⇒ routed by PLACE (recipientsFor → canSeeNotification, which excludes
      // station staff). No workstation_name ⇒ the general payload, not the per-station one.
      order_summary: summary,
      order_total: summary.reduce((s, i) => s + i.price * i.quantity, 0),
      category: "orders", // a front-of-house order alert, not a "station" one
    });
  });
}

/**
 * An order (or some of its items) was cancelled — tell the stations to STOP.
 *
 * Takes the work ALREADY CAPTURED, because by the time the caller knows the
 * cancellation succeeded, the rows it would need to describe are marked cancelled and
 * `captureStations` can no longer see them. Callers capture first, cancel, then emit.
 */
export async function emitOrderCancelled(
  service: ServiceClient,
  ctx: OrderContext,
  captured: StationWork
): Promise<void> {
  await emitWorkstationOrderEvent(service, "order_cancelled", ctx, captured);
}

/**
 * Money has been taken. Goes to whoever handles billing, wherever the table was —
 * a payment follows the job, not the floor plan.
 */
export async function emitPaymentReceived(
  service: ServiceClient,
  params: {
    restaurantId: string;
    sessionId: string | null;
    tableId: string | null;
    roomId: string | null;
    tableNumber: string | null;
    roomNumber: string | null;
    amount: number;
  }
): Promise<void> {
  const { data: created } = await service
    .from("notifications")
    .insert({
      restaurant_id: params.restaurantId,
      table_id: params.tableId,
      room_id: params.roomId,
      session_id: params.sessionId,
      type: "payment_received",
      status: "new",
    })
    .select("id")
    .single();

  if (!created) return;

  afterResponse(async () => {
    await notifyStaff(params.restaurantId, {
      id: created.id,
      type: "payment_received",
      table_id: params.tableId,
      room_id: params.roomId,
      table_number: params.tableNumber,
      room_number: params.roomNumber,
      amount: params.amount,
    });
  });
}
