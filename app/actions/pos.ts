"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasPermission, PERMISSIONS, NAV_ACCESS } from "@/lib/permissions";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";
import { WALK_IN_SLOT_COUNT } from "@/lib/walk-ins";
import { buildVisibilityFilter, getAssignedWorkstationIds } from "@/lib/assignments";
import { computeCreditStats, settlementOf } from "@/lib/credits";
import type { BillSettlement, CreditStats } from "@/lib/credits";
import { resolveOrderItems } from "@/lib/order-items";
import { businessDate, businessPeriodBounds, businessToday } from "@/lib/business-day";
import {
  emitNewOrder,
  emitOrderCancelled,
  emitPaymentReceived,
  loadOrderContext,
  captureStations,
} from "@/lib/notify";

export type ActionResult = { error: string } | null;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A table's state, DERIVED rather than stored, so "active" can never disagree with the
 * sessions table. Cleaning is the only fact the table row itself carries.
 *
 *   session open        -> active
 *   else cleaning_since -> cleaning   (bill paid / session closed; awaiting a wipe-down)
 *   else                -> available
 */
export type TableState = "available" | "active" | "cleaning";

export type TableStatus = {
  id: string;
  number: string;
  group_id: string | null;
  session_id: string | null;
  session_opened_at: string | null;
  state: TableState;
  /** When it was left dirty — null unless `state` is "cleaning". */
  cleaning_since: string | null;
};

export type OrderItemRow = {
  id: string;
  item_name: string;
  item_price: number;
  // Both the live FK and the immutable snapshot name. The id is what a printed ticket
  // maps to a workstation's kind (Kitchen → KOT, Bar → BOT); the name is the fallback
  // if the station was later deleted (FK nulled) or renamed.
  workstation_id: string | null;
  workstation_name: string | null;
  quantity: number;
  item_status: "pending" | "served";
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
  /**
   * Set when this session belongs to a hotel STAY. The bill is then the guest's
   * folio — room nights + extras + this food — so it must NOT be settled through
   * the ordinary close-bill path, which would charge for the food alone and leave
   * the guest checked in with the room still occupied.
   */
  room_stay_id: string | null;
  table_number: string | null;
  room_number: string | null;
  /** Which walk-in slot (1..N) this session occupies; null for tables/rooms. */
  walk_in_no: number | null;
  opened_at: string;
  customer_pin: string | null;
  /** Optional walk-in customer details (takeaway / phone / delivery). */
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  /** The order's sequential number, claimed at its first order (see the
   *  assign_session_bill_number trigger). Null when the restaurant hasn't configured
   *  numbering — its documents fall back to derived refs. Shared by KOT/BOT and the bill. */
  bill_number: number | null;
  /** Per-workstation OT numbers stamped for this session (KOT-00125, BOT-00086, …).
   *  Each workstation's own independent number; empty when OT numbering is off. */
  workstation_tickets: { workstation_id: string; ot_number: number; prefix: string | null }[];
  items: OrderItemRow[];
  total: number;
};

// What the client is allowed to choose: which dish, which variant, how many.
// Name, price and workstation are NOT here — they are resolved from the menu
// server-side (lib/order-items.ts), because a client that can name its own price
// will eventually name a bad one.
export type CartItem = {
  menu_item_id: string;
  variant_id: string | null;
  quantity: number;
  notes: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * The tables this staff member may work, with their live session state.
 *
 * Exists so the dashboard's Tables section can refetch ITSELF when a table
 * changes, instead of calling `router.refresh()`. A refresh re-runs the whole
 * route — Sales, Credits, the Menu, every one of their queries — and then throws
 * the results away, because those sections are client components holding their
 * own state. On a busy service that was a full dashboard re-render per order.
 */
export async function getMyTables(): Promise<TableStatus[]> {
  const ru = await getRestaurantUser();
  const [tables, visibility] = await Promise.all([
    getTableStatusOverview(ru.restaurant_id),
    buildVisibilityFilter(ru.restaurant_id, ru),
  ]);
  return tables.filter((t) => visibility.canSeeTable(t.id));
}

// ─── Table Status Overview ────────────────────────────────────────────────────

export async function getTableStatusOverview(
  restaurantId: string
): Promise<TableStatus[]> {
  const service = createServiceClient();

  const [tablesRes, sessionsRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("restaurant_tables")
      .select("id, number, group_id, cleaning_since")
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
    cleaning_since: string | null;
  }[];
  const sessions = (sessionsRes.data ?? []) as {
    id: string;
    table_id: string;
    opened_at: string;
  }[];

  return tables.map((t) => {
    const session = sessions.find((s) => s.table_id === t.id) ?? null;
    // An open session always wins: if someone re-seated a table that was still marked dirty,
    // it is plainly in use, and showing it as "cleaning" would hide a live bill.
    const state: TableState = session ? "active" : t.cleaning_since ? "cleaning" : "available";
    return {
      id: t.id,
      number: t.number,
      group_id: t.group_id,
      session_id: session?.id ?? null,
      session_opened_at: session?.opened_at ?? null,
      state,
      cleaning_since: state === "cleaning" ? t.cleaning_since : null,
    };
  });
}

// ─── Cleaning ────────────────────────────────────────────────────────────────
// A table parks in "cleaning" automatically when its session closes (the
// trg_park_table_for_cleaning trigger — see 20260717160000). This is the way out: one tap,
// back to available.
//
// Gated the same way as OPENING a table: staff may only touch tables in their assigned
// groups. Whoever is trusted to seat a table is trusted to say it's been wiped — anything
// stricter would leave waiters unable to clear their own section, and tables would pile up
// dirty waiting for a manager.
export async function markTableClean(tableId: string): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  const service = createServiceClient();

  const visibility = await buildVisibilityFilter(ru.restaurant_id, ru);
  if (!visibility.seesAll && !visibility.canSeeTable(tableId)) {
    return { error: "That table isn't in your section." };
  }

  // Scoped to the caller's restaurant so a stray id can't clear another tenant's table.
  // Clearing an already-clean table is a no-op, not an error — two staff tapping at once
  // should both just see a clean table.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("restaurant_tables")
    .update({ cleaning_since: null })
    .eq("id", tableId)
    .eq("restaurant_id", ru.restaurant_id);

  if (error) return { error: "Could not mark the table clean. Please try again." };

  // The UPDATE fires rs_ev_tables, so every other dashboard repaints on its own.
  revalidatePath("/employee/dashboard");
  return null;
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

  // A table still awaiting cleaning can't be seated. The DB refuses this too
  // (trg_refuse_session_on_dirty_table); checking here is what turns that exception into a
  // sentence the waiter can act on.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tbl } = await (service as any)
    .from("restaurant_tables")
    .select("cleaning_since")
    .eq("id", tableId)
    .eq("restaurant_id", ru.restaurant_id)
    .maybeSingle();

  if (tbl?.cleaning_since) {
    return { error: "This table still needs cleaning. Mark it clean before seating anyone." };
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

// `openRoomSession` used to live here: it opened a session on a room with no
// stay behind it, which is precisely the bug — the guest got billed for their
// room service and never for the room. A room session is now only ever created
// by `checkInRoom`, which opens the stay and the session together. Removed
// rather than deprecated, so there is no second way to make a stay-less session.

// ─── Walk-ins ─────────────────────────────────────────────────────────────────
// Walk-ins are fixed workspaces (W1, W2, W3 …) that behave exactly like tables: a slot
// stays occupied by its session until the bill is closed, and reopening the slot returns
// to the same session. WALK_IN_SLOT_COUNT / walkInLabel live in lib/walk-ins.ts because a
// "use server" module may only export async functions.

export type WalkInStatus = {
  no: number;
  session_id: string | null;
  session_opened_at: string | null;
  /** Shown on the card so a delivery/takeaway slot is recognisable at a glance. */
  customer_name: string | null;
};

// The N walk-in slots with their live session state — the walk-in counterpart of
// getTableStatusOverview. Walk-ins have no table group, so every staff member who can
// work tables sees all of them (no visibility filter).
export async function getWalkInStatusOverview(
  restaurantId: string
): Promise<WalkInStatus[]> {
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("sessions")
    .select("id, walk_in_no, opened_at, customer_name")
    .eq("restaurant_id", restaurantId)
    .eq("type", "walk_in")
    .eq("status", "active")
    .not("walk_in_no", "is", null);

  const active = (data ?? []) as {
    id: string;
    walk_in_no: number;
    opened_at: string;
    customer_name: string | null;
  }[];

  return Array.from({ length: WALK_IN_SLOT_COUNT }, (_, i) => {
    const no = i + 1;
    const s = active.find((a) => a.walk_in_no === no) ?? null;
    return {
      no,
      session_id: s?.id ?? null,
      session_opened_at: s?.opened_at ?? null,
      customer_name: s?.customer_name ?? null,
    };
  });
}

/** For the dashboard's live refetch — same data, callable from the client action layer. */
export async function getMyWalkIns(): Promise<WalkInStatus[]> {
  const ru = await getRestaurantUser();
  return getWalkInStatusOverview(ru.restaurant_id);
}

// Open (or resume) a walk-in slot. If the slot already has a live session, go straight
// back to it — that is what makes a walk-in persist like a table. Otherwise create one,
// tagged with the slot number. The customer PIN follows the SAME rule as a table: only a
// "With PIN" restaurant gets one, so a "Without PIN" restaurant's walk-in never shows a PIN.
export async function openWalkInSlot(no: number) {
  const ru = await getRestaurantUser();
  const service = createServiceClient();

  if (!Number.isInteger(no) || no < 1 || no > WALK_IN_SLOT_COUNT) {
    redirect("/employee/dashboard");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (service as any)
    .from("sessions")
    .select("id")
    .eq("restaurant_id", ru.restaurant_id)
    .eq("type", "walk_in")
    .eq("status", "active")
    .eq("walk_in_no", no)
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
      type: "walk_in",
      walk_in_no: no,
      customer_pin,
    })
    .select("id")
    .single();

  // A unique-index clash means the slot was taken between our check and insert (another
  // device opened it first) — resolve to that session rather than erroring.
  if (error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: raced } = await (service as any)
      .from("sessions")
      .select("id")
      .eq("restaurant_id", ru.restaurant_id)
      .eq("type", "walk_in")
      .eq("status", "active")
      .eq("walk_in_no", no)
      .maybeSingle();
    if (raced) redirect(`/employee/session/${raced.id}`);
    return { error: "Could not open the walk-in. Please try again." };
  }
  redirect(`/employee/session/${session.id}`);
}

// Save the optional customer details on a walk-in (takeaway / phone / delivery). Editable
// any time before the bill is closed; scoped to the caller's restaurant.
export async function updateWalkInCustomer(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.CREATE_ORDERS)) return { error: "Permission denied." };
  const service = createServiceClient();

  const sessionId = (formData.get("session_id") as string) || "";
  const name = ((formData.get("customer_name") as string) || "").trim() || null;
  const phone = ((formData.get("customer_phone") as string) || "").trim() || null;
  const address = ((formData.get("customer_address") as string) || "").trim() || null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: sess } = await (service as any)
    .from("sessions")
    .select("id, restaurant_id, type, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (!sess || sess.restaurant_id !== ru.restaurant_id || sess.type !== "walk_in")
    return { error: "Walk-in not found." };
  if (sess.status !== "active") return { error: "This walk-in is already closed." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("sessions")
    .update({ customer_name: name, customer_phone: phone, customer_address: address })
    .eq("id", sessionId);

  if (error) return { error: error.message };
  revalidatePath(`/employee/session/${sessionId}`);
  return null;
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

  // The table is now active, so the held order surfaces in the Orders queue for the
  // kitchen/workstations — and THIS is the moment the kitchen is told about it. Not
  // when the guest placed it: until a staff member approved the table, nobody had
  // agreed to cook anything. Now they have.
  if (notif.order_id) {
    await emitNewOrder(service, ru.restaurant_id, notif.order_id);
  }

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

  // Closing the session, releasing the stock the held order reserved, and
  // resolving the notification happen in ONE transaction. Rejecting an order the
  // customer never received must not leave its ingredients deducted.
  //
  // The session close inside is a compare-and-swap on `pending_activation`, so if
  // a colleague accepted the table a moment ago, nothing is cancelled.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("reject_table_activation", {
    p_restaurant_id: ru.restaurant_id,
    p_session_id: notif.session_id,
    p_notification_id: notif.id,
    p_by: ru.id,
  });

  if (error) return { error: "Failed to reject the request." };

  revalidatePath("/employee/notifications");
  revalidatePath("/employee/dashboard");
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
    .select(`id, type, status, opened_at, customer_pin, table_id, room_id, room_stay_id, walk_in_no, customer_name, customer_phone, customer_address, bill_number, restaurant_tables ( number ), rooms ( number )`)
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
        "id, item_name, item_price, workstation_id, workstation_name, quantity, item_status, notes, created_at, order_id"
      )
      .in("order_id", orderIds)
      // A cancelled item is off the bill and back on the shelf — it must not be
      // shown, and must not be charged for.
      .is("cancelled_at", null)
      .order("created_at");
    items = (itemsData as OrderItemRow[]) ?? [];
  }

  const total = items.reduce(
    (sum, i) => sum + Number(i.item_price) * i.quantity,
    0
  );

  // Per-workstation OT numbers stamped for this session (KOT-00125, BOT-00086, …).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: otRows } = await (service as any)
    .from("workstation_ticket_numbers")
    .select("workstation_id, ot_number, prefix")
    .eq("session_id", session.id);
  const workstation_tickets = ((otRows ?? []) as {
    workstation_id: string;
    ot_number: number;
    prefix: string | null;
  }[]);

  return {
    id: session.id,
    type: session.type,
    status: session.status,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table_id: (session as any).table_id ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    room_id: (session as any).room_id ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    room_stay_id: (session as any).room_stay_id ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table_number: (session as any).restaurant_tables?.number ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    room_number: (session as any).rooms?.number ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    walk_in_no: (session as any).walk_in_no ?? null,
    opened_at: session.opened_at,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    customer_pin: (session as any).customer_pin ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    customer_name: (session as any).customer_name ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    customer_phone: (session as any).customer_phone ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    customer_address: (session as any).customer_address ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bill_number: (session as any).bill_number ?? null,
    workstation_tickets,
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

  // Name, price, variant and workstation are all resolved from the menu — the
  // cart only ever chooses WHAT and HOW MANY. See lib/order-items.ts.
  const resolved = await resolveOrderItems(service, ru.restaurant_id, cartItems);
  if (!resolved.ok) return { error: resolved.error };

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
    .insert(resolved.items.map((item) => ({ order_id: order.id, ...item })));

  if (itemsErr) return { error: "Failed to add items." };

  // The order shows up in the Orders queue (driven by order rows) and NOT in the
  // Notifications panel, which stays a list of things to acknowledge. But it does now
  // ring the stations that have to make it — a chef with their hands full and their
  // back to the screen cannot see a queue.
  await emitNewOrder(service, ru.restaurant_id, order.id as string);

  revalidatePath("/employee/queue");
  redirect(`/employee/session/${sessionId}`);
}

// ─── Update Item Status ───────────────────────────────────────────────────────

export async function updateOrderItemStatus(
  itemId: string,
  status: "pending" | "served"
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

  // One state change, one write. An item is pending until it reaches the guest,
  // and then it is served.
  //
  // This used to also fan out: when the last item on an order turned `ready` it
  // re-read every item on the order, checked for an existing alert, re-read the
  // session, and raised an `order_ready` notification — four extra round-trips on
  // the hot path of a kitchen tapping through a rush. With `ready` gone there is
  // no moment left to announce, and the whole block goes with it.
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

  const sessionId    = formData.get("session_id") as string;
  const method       = ((formData.get("payment_method") as string) || "cash").toLowerCase();
  const cashAmount   = parseFloat(formData.get("cash_amount")   as string) || 0;
  const onlineAmount = parseFloat(formData.get("online_amount") as string) || 0;
  const cardAmount   = parseFloat(formData.get("card_amount")   as string) || 0;
  // The client sends `total_amount` = the PAYABLE (order total − discount) — the net amount
  // actually collected, and what every report treats as the sale. `discount_amount` rides
  // alongside it purely so the bill can show the reduction.
  const totalAmount  = parseFloat(formData.get("total_amount")  as string);
  const discount     = parseFloat(formData.get("discount_amount") as string) || 0;

  const validMethods = ["cash", "online", "card", "mixed", "credit"];
  if (!validMethods.includes(method)) return { error: "Invalid payment method." };
  if (isNaN(totalAmount) || totalAmount < 0) return { error: "Invalid total amount." };
  if (cashAmount < 0 || onlineAmount < 0 || cardAmount < 0) {
    return { error: "Amounts cannot be negative." };
  }
  // The order total is payable + discount, so a discount that exceeded it would have
  // driven the payable negative — already refused above. Only the sign is left to check.
  if (isNaN(discount) || discount < 0) {
    return { error: "Invalid discount amount." };
  }

  // A discount needs the restaurant's discount PIN — money coming off the till is an
  // authorized act, not a cashier's own call. This check is the ONLY thing that enforces
  // it: the form is a POST endpoint any logged-in staff member can hit directly, so
  // hiding the field client-side protects nothing on its own.
  //
  // `verify_discount_pin` returns false when the restaurant has no PIN configured, which
  // is what makes "no PIN" mean "discounts off" rather than "discounts unguarded".
  if (discount > 0) {
    const pin = ((formData.get("discount_pin") as string) || "").trim();
    if (!pin) return { error: "Enter the discount PIN to apply a discount." };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: pinOk, error: pinErr } = await (service as any).rpc("verify_discount_pin", {
      p_restaurant_id: ru.restaurant_id,
      p_pin: pin,
    });
    // A failed CHECK must never be read as a pass — refuse on error too.
    if (pinErr || pinOk !== true) {
      return { error: "Incorrect discount PIN. The discount was not applied." };
    }
  }

  // A hotel stay is NOT billable here. This path charges the session's food and
  // closes it; for a stay that would collect the room service, skip the room
  // nights entirely, and leave the guest checked in with the room still occupied.
  // It has to be refused server-side and not merely hidden in the UI, because the
  // form is a POST endpoint that anyone can reach directly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: sess } = await (service as any)
    .from("sessions")
    // table/room come along for the ride so the "payment received" alert can say WHERE
    // — the row is already being read, and a second query to name a table would be
    // one more round-trip on the hot path of closing a bill.
    .select("room_stay_id, table_id, room_id, restaurant_tables ( number ), rooms ( number )")
    .eq("id", sessionId)
    .eq("restaurant_id", ru.restaurant_id)
    .maybeSingle();

  if (sess?.room_stay_id) {
    return { error: "This is a room stay — settle it from the guest's folio, so the room nights are billed too." };
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
      p_discount:       discount,
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
    total_amount:    totalAmount,
    discount_amount: discount,
    payment_method: method,
    created_by:     ru.id,
  });

  // Tell whoever handles billing. Routed by JOB, not by table group: a payment is the
  // cashier's business wherever in the building it came from.
  await emitPaymentReceived(service, {
    restaurantId: ru.restaurant_id,
    sessionId,
    tableId: sess?.table_id ?? null,
    roomId: sess?.room_id ?? null,
    tableNumber: sess?.restaurant_tables?.number ?? null,
    roomNumber: sess?.rooms?.number ?? null,
    amount: totalAmount,
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
    // Cancelled items don't count: a table whose only order was cancelled is
    // empty again, and any assigned staff member may close it.
    .is("cancelled_at", null)
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

  // Releasing the stock, clearing the table's notifications and closing the
  // session happen in ONE transaction.
  //
  // Anything still pending or ready never reached the customer, so its
  // ingredients go back on the shelf. Items already SERVED stay deducted — they
  // were genuinely consumed, whether or not the bill was ever settled.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("force_close_session", {
    p_restaurant_id: ru.restaurant_id,
    p_session_id: sessionId,
    p_by: ru.id,
  });

  if (error) return { error: "Failed to close the session." };

  revalidatePath("/employee/dashboard");
  redirect("/employee/dashboard");
}

// ─── Cancel an order / a single item ─────────────────────────────────────────
// Scenario 4: an order (or one line of it) is cancelled before it is served.
// Only the cancelled items are released; anything already served stays deducted.
//
// Gated on CANCEL_ORDERS — cancelling moves both money (it leaves the bill) and
// stock (it returns to the shelf), so it is not something any waiter may do.

export async function cancelOrder(orderId: string): Promise<ActionResult> {
  const ru = await getRestaurantUser();

  if (!hasPermission(ru, PERMISSIONS.CANCEL_ORDERS)) {
    return { error: "You don't have permission to cancel orders." };
  }

  const service = createServiceClient();

  // Capture what the stations are working on BEFORE the cancel lands. Afterwards
  // every item is marked cancelled and there is nothing left to name — "stop" is not
  // a useful instruction if you can't say stop WHAT.
  const ctx = await loadOrderContext(service, ru.restaurant_id, orderId);
  const captured = await captureStations(service, orderId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("cancel_order", {
    p_restaurant_id: ru.restaurant_id,
    p_order_id: orderId,
    p_by: ru.id,
  });

  if (error) return { error: "Failed to cancel the order." };

  // Only now — the cancellation is real. Something may already be on the heat, and
  // every second it stays there is food in the bin.
  if (ctx) await emitOrderCancelled(service, ctx, captured);

  revalidatePath("/employee/queue");
  revalidatePath("/employee/dashboard");
  return null;
}

export async function cancelOrderItem(itemId: string): Promise<ActionResult> {
  const ru = await getRestaurantUser();

  if (!hasPermission(ru, PERMISSIONS.CANCEL_ORDERS)) {
    return { error: "You don't have permission to cancel orders." };
  }

  const service = createServiceClient();

  // Which order does this item belong to? Needed to describe it, and captured before
  // the RPC for the same reason as cancelOrder above.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: item } = await (service as any)
    .from("session_order_items")
    .select("order_id")
    .eq("id", itemId)
    .maybeSingle();

  const ctx = item?.order_id
    ? await loadOrderContext(service, ru.restaurant_id, item.order_id)
    : null;
  // Scoped to this ONE item — the rest of the order is still being cooked, and telling
  // the kitchen to stop the whole ticket would be a lie.
  const captured = item?.order_id
    ? await captureStations(service, item.order_id, [itemId])
    : null;

  // Returns 0 when the item was already served or already cancelled — the RPC
  // refuses rather than silently releasing stock that was actually consumed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (service as any).rpc("cancel_order_item", {
    p_restaurant_id: ru.restaurant_id,
    p_item_id: itemId,
    p_by: ru.id,
  });

  if (error) return { error: "Failed to cancel the item." };
  if (Number(data ?? 0) === 0) {
    return { error: "That item has already been served or cancelled." };
  }

  if (ctx && captured) await emitOrderCancelled(service, ctx, captured);

  revalidatePath("/employee/queue");
  revalidatePath("/employee/dashboard");
  return null;
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
  item_status: "pending" | "served";
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
  status: "pending" | "served";
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
    // Cancelled items are off the queue — the kitchen must not cook them.
    .is("cancelled_at", null)
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
        .filter((it) => it.item_status === "pending")
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
      if (!rawItems.some((it) => it.item_status === "pending")) {
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

    // An order is pending while anything on it still is; once every item has gone
    // out, the order is served. There is no middle any more.
    const status: QueueOrder["status"] = orderItems.some((i) => i.item_status === "pending")
      ? "pending"
      : "served";

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
  /** The FULL value of the bill — including anything that went on credit. Already NET of
   *  `discount`: the discounted figure IS the sale everywhere in the system. */
  amount: number;
  /** Knocked off at payment. Informational only — it is not part of `amount`. */
  discount: number;
  method: string;
  cash_amount: number;
  online_amount: number;
  card_amount: number;
  created_at: string;
  /**
   * The BUSINESS day this bill belongs to (YYYY-MM-DD), resolved on the server.
   *
   * The list used to group by re-deriving the day from `created_at` in the
   * browser, which meant the grouping could disagree with the totals in the same
   * payload — on a device in another timezone, and every night once a business
   * day can end after midnight. Now both come from one server computation.
   */
  business_date: string;
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
  /** Total knocked off across the period. Sits ALONGSIDE `periodTotal` rather than adding to
   *  it — Sales is the net figure; this just says how much was given away to get there. */
  discountsTotal: number;
  /** Outstanding / collected / created, plus status counts. */
  credit: CreditStats;
  transactions: SalesTxn[];
  /** Today's business date (YYYY-MM-DD) — what the list compares against to say "Today". */
  businessToday: string;
  /** Yesterday's, so the client needs no date arithmetic of its own at all. */
  businessYesterday: string;
};

/**
 * Resolves a period (or custom range) to millisecond [from, to) bounds.
 *
 * Delegates to the app-wide business-day definition, which fixed three ways this
 * used to disagree with the Finance report for the same restaurant on the same
 * day:
 *   - "This week" was a rolling 168 hours here and the last 7 days there.
 *   - A custom `from`/`to` was parsed with `new Date("YYYY-MM-DD")`, i.e. as UTC,
 *     so a range started 5h45m late in Nepal.
 *   - The upper bound was `Infinity`; it is now the end of the current business
 *     day, which matters once a day can end after midnight.
 */
function resolveSalesRange(
  period: SalesPeriod,
  hour: number,
  from?: string | null,
  to?: string | null
): { fromMs: number; toMs: number } {
  if (period === "all") return { fromMs: -Infinity, toMs: Infinity };
  const b = businessPeriodBounds(period, hour, from, to);
  return { fromMs: b.from.getTime(), toMs: b.to.getTime() };
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
      discountsTotal: 0,
      credit: emptyCredit,
      transactions: [],
      businessToday: businessToday(ru.closingHour),
      businessYesterday: businessDate(
        new Date(businessPeriodBounds("yesterday", ru.closingHour).from),
        ru.closingHour
      ),
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
        "id, amount, total_amount, discount_amount, cash_amount, online_amount, card_amount, payment_method, created_at, sessions ( type, restaurant_tables ( number ), rooms ( number ), credit_customers ( name ) ), credits ( id, credit_number, customer_name, down_payment )"
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

  // The overview cards come from the SAME resolver as the selected period, so a
  // card's total always equals the detail you get by clicking it. They used to be
  // re-derived inline here, which is exactly how "this week" drifted into meaning
  // two different things on one screen.
  const startOfToday = businessPeriodBounds("today", ru.closingHour).from.getTime();
  const weekAgo = businessPeriodBounds("week", ru.closingHour).from.getTime();
  const startOfMonth = businessPeriodBounds("month", ru.closingHour).from.getTime();
  const startOfYear = businessPeriodBounds("year", ru.closingHour).from.getTime();

  const { fromMs, toMs } = resolveSalesRange(period, ru.closingHour, params?.from, params?.to);

  const overview = { today: 0, week: 0, month: 0, year: 0, total: 0 };
  const breakdown = { cash: 0, online: 0, card: 0, credit: 0, other: 0 };
  let periodTotal = 0;
  let orderCount = 0;
  let discountsTotal = 0;
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
    // `toMs` is EXCLUSIVE (it is the next business day's first instant), so a
    // bill landing exactly on the boundary belongs to the next day only — `<=`
    // would count it in both.
    if (ts >= fromMs && ts < toMs) {
      const cash = Number(p.cash_amount ?? 0);
      const online = Number(p.online_amount ?? 0);
      const card = Number(p.card_amount ?? 0);
      periodTotal += value;
      orderCount += 1;
      // Not added to periodTotal: `value` is already net of it.
      discountsTotal += Number(p.discount_amount ?? 0);

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
      discount: Number(p.discount_amount ?? 0),
      method: p.payment_method,
      cash_amount: cash,
      online_amount: online,
      card_amount: card,
      created_at: p.created_at,
      business_date: businessDate(new Date(p.created_at), ru.closingHour),
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
    discountsTotal,
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
    businessToday: businessToday(ru.closingHour),
    businessYesterday: businessDate(
      new Date(businessPeriodBounds("yesterday", ru.closingHour).from),
      ru.closingHour
    ),
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
      "id, amount, total_amount, discount_amount, cash_amount, online_amount, card_amount, payment_method, created_at, created_by, sessions ( type, restaurant_tables ( number ), rooms ( number ), credit_customers ( name ) ), credits ( credit_number, customer_name )"
    )
    .eq("restaurant_id", ru.restaurant_id)
    .order("created_at", { ascending: false });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []) as any[];
  const { fromMs, toMs } = resolveSalesRange(period, ru.closingHour, params?.from, params?.to);
  const inRange = rows.filter((p) => {
    const ts = new Date(p.created_at).getTime();
    return ts >= fromMs && ts < toMs; // upper bound exclusive — see getSalesReport
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
    "Discount",
    // Already net of Discount — the discounted figure is the sale.
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
        Number(p.discount_amount ?? 0).toFixed(2),
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
  /** The NET sale — what was actually collected, i.e. the order total minus `discount`. */
  total: number;
  /** Knocked off at payment. Shown on the bill so `total` reconciles with the items above it. */
  discount: number;
  cashier_name: string | null;
  order_ids: string[];
  location: string;
  /** The restaurant's own sequential bill number, stamped at payment. Null when the
   *  restaurant hasn't configured custom numbering (bill falls back to a derived ref). */
  bill_number: number | null;
  /** How to format/label that number on the bill (from the restaurant's settings). */
  bill_number_pad: number;
  bill_number_label: "bill" | "order";
  /** Walk-in customer details (takeaway / delivery), when present. */
  customer: { name: string | null; phone: string | null; address: string | null } | null;
  restaurant: {
    name: string;
    address: string | null;
    contact_phone: string | null;
    pan_vat_number: string | null;
    logo_url?: string | null;
    paper_width_mm?: 58 | 80;
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
      "id, bill_number, amount, total_amount, discount_amount, cash_amount, online_amount, card_amount, payment_method, created_at, created_by, session_id, restaurant_id, sessions ( type, bill_number, customer_name, customer_phone, customer_address, restaurant_tables ( number ), rooms ( number ) ), credits ( credit_number, customer_name, customer_phone, paid_amount, balance )"
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
        // Never print a cancelled item on the bill.
        .is("cancelled_at", null)
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
    .select("name, address, contact_phone, pan_vat_number, logo_url, settings")
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
    discount: Number(p.discount_amount ?? 0),
    cashier_name,
    order_ids,
    location,
    // The order's number lives on the SESSION now (shared with its KOT/BOT). Fall back to
    // the payment's own stamped number for bills closed under the old payment-time model.
    bill_number: p.sessions?.bill_number ?? p.bill_number ?? null,
    bill_number_pad: Number.isFinite(Number(rest?.settings?.bill_number_pad)) ? Number(rest?.settings?.bill_number_pad) : 0,
    bill_number_label: rest?.settings?.bill_number_label === "order" ? "order" : "bill",
    customer:
      p.sessions?.customer_name || p.sessions?.customer_phone || p.sessions?.customer_address
        ? {
            name: p.sessions?.customer_name ?? null,
            phone: p.sessions?.customer_phone ?? null,
            address: p.sessions?.customer_address ?? null,
          }
        : null,
    restaurant: {
      name: rest?.name ?? "Restaurant",
      address: rest?.address ?? null,
      contact_phone: rest?.contact_phone ?? null,
      pan_vat_number: rest?.pan_vat_number ?? null,
      logo_url: rest?.logo_url ?? null,
      paper_width_mm: rest?.settings?.print_paper_width === "58" ? 58 : 80,
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
