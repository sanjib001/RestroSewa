// Helpers to raise notifications through the shared notifications table.
//
// Note: placing an order does NOT create a notification. Orders live in the
// Orders queue (driven by order rows); the Notifications panel is reserved for
// actionable events (table activation requests, waiter calls, bill requests).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceClient = any;

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
  await service.from("notifications").insert({
    restaurant_id: params.restaurantId,
    table_id: params.tableId,
    room_id: params.roomId,
    session_id: params.sessionId,
    order_id: params.orderId,
    type: "table_activation_request",
    status: "new",
  });
}

// `emitOrderReadyNotification` used to live here. It fired when every item on an
// order turned `ready`, telling the guest their food was on its way.
//
// The `ready` state has been removed from the system — an item is now either
// pending or served — so there is no moment left at which to raise it. The 49
// historical `order_ready` rows stay in the table as history; nothing writes a
// new one, and the staff panel already filtered them out.
