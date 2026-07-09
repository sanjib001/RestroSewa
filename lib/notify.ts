// Shared helper to raise a "new_order" alert through the existing notification
// system. One notification per order (never duplicates the order itself). The
// order_id lets the reader resolve which workstations the order touches, so a
// kitchen/bar/bakery only gets alerted for orders containing their items.
// Routing to the right table-group / workstation happens on read.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceClient = any;

export async function emitNewOrderNotification(
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
    type: "new_order",
    status: "new",
  });
}

// Raises a customer-facing "order ready" alert through the same notification
// system. Scoped to the session so only the guest who placed the order sees it
// (the customer page polls notifications for its own session). One per order —
// the caller dedups. Staff-facing reads exclude `order_ready`.
export async function emitOrderReadyNotification(
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
    type: "order_ready",
    status: "new",
  });
}
