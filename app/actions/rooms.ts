"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";
import { buildVisibilityFilter } from "@/lib/assignments";
import { hasPermission, hasAnyPermission, NAV_ACCESS, PERMISSIONS } from "@/lib/permissions";
import { buildFolio, CHARGE_TYPES } from "@/lib/room-billing";
import type { RoomChargeType, RoomFolio } from "@/lib/room-billing";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export type ActionResult = { error: string } | null;

// Staff-facing room operations. Deliberately reuses the permissions the rest of
// the app already defines rather than inventing room-specific ones:
//
//   see a room            view_rooms      (+ the SAME assignment filter as tables)
//   check a guest in      view_rooms      — like opening a table: no extra right
//   add a folio charge    create_orders   — it is a line on a bill
//   check out / settle    close_bills     — like closing any other bill
//   discount the folio    apply_discounts
//   leave it on credit    process_payments + close_bills  (canManageCredits)
//   mark it cleaned       view_rooms      — same as check-in: whoever can put a guest in
//                                           the room is trusted to say it's been made up
//
// So a Receptionist is just a Cashier with view_rooms; no new permission had to
// be granted to anyone, and none of the existing presets change meaning.

const canSeeRooms = (u: { role: string; permissions: string[] }) =>
  hasAnyPermission(u, [PERMISSIONS.VIEW_ROOMS, PERMISSIONS.MANAGE_ROOMS]);

export type RoomStayInfo = {
  stay_id: string;
  guest_name: string;
  guest_phone: string | null;
  guest_count: number;
  room_rate: number;
  check_in_at: string;
  nights_so_far: number;
  running_total: number;
  /** Food ordered against this stay — from the room QR or taken by hand. */
  items_total: number;
  /** Still to go out. This is the number that tells a receptionist to act. */
  items_pending: number;
  /** The stay's session, for "add an order" straight off the card. */
  session_id: string | null;
};

export type RoomOverview = {
  id: string;
  number: string;
  status: "available" | "occupied" | "cleaning" | "maintenance";
  type_id: string;
  type_name: string;
  base_price: number;
  session_id: string | null;
  stay: RoomStayInfo | null;
  /** Who this room belongs to — by room, or inherited from its room type. */
  staff: string[];
};

// ─── Overview ────────────────────────────────────────────────────────────────

export async function getRoomsOverview(): Promise<RoomOverview[]> {
  const ru = await getRestaurantUser();
  if (!canSeeRooms(ru)) return [];

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = service as any;
  const rid = ru.restaurant_id;

  const [roomsRes, typesRes, staysRes, sessionsRes, byRoomRes, byTypeRes, staffRes] =
    await Promise.all([
      svc.from("rooms").select("id, number, status, room_type_id").eq("restaurant_id", rid).order("number"),
      svc.from("room_types").select("id, name, base_price").eq("restaurant_id", rid),
      svc
        .from("room_stays")
        .select("id, room_id, guest_name, guest_phone, guest_count, room_rate, check_in_at")
        .eq("restaurant_id", rid)
        .eq("status", "active"),
      svc
        // room_stay_id comes back here too, so the food lookup below already knows
        // which session belongs to which stay — it used to re-query `sessions` a
        // second time just to learn that.
        .from("sessions")
        .select("id, room_id, room_stay_id")
        .eq("restaurant_id", rid)
        .eq("status", "active")
        .not("room_id", "is", null),
      // Scoped to THIS restaurant's staff. These two were reading every
      // assignment row in the entire database — every restaurant's — and then
      // discarding the ones whose user wasn't in `names`. Correct output, but the
      // query grew with the size of the platform rather than the size of the hotel.
      svc
        .from("restaurant_user_rooms")
        .select("restaurant_user_id, room_id, restaurant_users!inner(restaurant_id)")
        .eq("restaurant_users.restaurant_id", rid),
      svc
        .from("restaurant_user_room_types")
        .select("restaurant_user_id, room_type_id, restaurant_users!inner(restaurant_id)")
        .eq("restaurant_users.restaurant_id", rid),
      svc
        .from("restaurant_users")
        .select("id, display_name")
        .eq("restaurant_id", rid)
        .eq("is_active", true)
        .is("deleted_at", null),
    ]);

  const visibility = await buildVisibilityFilter(rid, ru);

  const types = new Map<string, { name: string; base_price: number }>(
    ((typesRes.data ?? []) as { id: string; name: string; base_price: number }[]).map((t) => [
      t.id,
      { name: t.name, base_price: Number(t.base_price) },
    ])
  );
  const names = new Map<string, string>(
    ((staffRes.data ?? []) as { id: string; display_name: string }[]).map((s) => [s.id, s.display_name])
  );
  const stays = (staysRes.data ?? []) as {
    id: string; room_id: string; guest_name: string; guest_phone: string | null;
    guest_count: number; room_rate: number; check_in_at: string;
  }[];
  const sessions = (sessionsRes.data ?? []) as {
    id: string; room_id: string; room_stay_id: string | null;
  }[];

  // Assigned staff, per room, from BOTH grants — pinned directly to the room, or
  // inherited from its room type. Same two-level rule the visibility filter uses,
  // so what the card says matches who can actually open it.
  const pinned = new Map<string, string[]>();
  for (const a of (byRoomRes.data ?? []) as { restaurant_user_id: string; room_id: string }[]) {
    if (!names.has(a.restaurant_user_id)) continue;
    pinned.set(a.room_id, [...(pinned.get(a.room_id) ?? []), a.restaurant_user_id]);
  }
  const perType = new Map<string, string[]>();
  for (const a of (byTypeRes.data ?? []) as { restaurant_user_id: string; room_type_id: string }[]) {
    if (!names.has(a.restaurant_user_id)) continue;
    perType.set(a.room_type_id, [...(perType.get(a.room_type_id) ?? []), a.restaurant_user_id]);
  }

  // What each open stay has run up so far — food and extras — so a card can show
  // a running total instead of making a receptionist open the folio to answer
  // "how much are they up to?".
  //
  // This used to walk stays → sessions → orders → items as FOUR round-trips in
  // series, each waiting on the one before, and then a fifth for the charges. At
  // ~300ms to Supabase that was well over a second of pure latency on every
  // dashboard render — and it re-ran on every realtime event.
  //
  // The session→stay mapping now rides along on the sessions query above, and the
  // items come back in a single join (`!inner` walks session_orders → sessions).
  // What was five serial trips is two, in parallel.
  const stayIds = stays.map((s) => s.id);
  const sessionIds = sessions.filter((s) => s.room_stay_id).map((s) => s.id);
  const stayOfSession = new Map<string, string>(
    sessions.filter((s) => s.room_stay_id).map((s) => [s.id, s.room_stay_id as string])
  );

  const foodByStay = new Map<string, number>();
  const extrasByStay = new Map<string, number>();
  const countByStay = new Map<string, { total: number; pending: number }>();

  if (stayIds.length > 0) {
    const [itemsRes, chargesRes] = await Promise.all([
      sessionIds.length > 0
        ? svc
            .from("session_order_items")
            .select("item_price, quantity, item_status, session_orders!inner(session_id)")
            .in("session_orders.session_id", sessionIds)
            .is("cancelled_at", null)
        : Promise.resolve({ data: [] }),
      svc.from("room_charges").select("room_stay_id, amount").in("room_stay_id", stayIds),
    ]);

    for (const i of (itemsRes.data ?? []) as {
      item_price: number;
      quantity: number;
      item_status: string;
      session_orders: { session_id: string } | { session_id: string }[];
    }[]) {
      // PostgREST returns a to-one embed as an object, but older shapes hand back
      // a single-element array. Accept both rather than depend on which.
      const so = Array.isArray(i.session_orders) ? i.session_orders[0] : i.session_orders;
      const stayId = so && stayOfSession.get(so.session_id);
      if (!stayId) continue;

      foodByStay.set(stayId, (foodByStay.get(stayId) ?? 0) + Number(i.item_price) * i.quantity);

      const c = countByStay.get(stayId) ?? { total: 0, pending: 0 };
      c.total += 1;
      if (i.item_status !== "served") c.pending += 1;
      countByStay.set(stayId, c);
    }

    for (const c of (chargesRes.data ?? []) as { room_stay_id: string; amount: number }[]) {
      extrasByStay.set(c.room_stay_id, (extrasByStay.get(c.room_stay_id) ?? 0) + Number(c.amount));
    }
  }

  const sessionOfStay = new Map<string, string>(
    sessions.filter((s) => s.room_stay_id).map((s) => [s.room_stay_id as string, s.id])
  );

  const rooms = ((roomsRes.data ?? []) as {
    id: string; number: string; status: RoomOverview["status"]; room_type_id: string;
  }[]).filter((r) => visibility.canSeeRoom(r.id));

  return rooms.map((r) => {
    const t = types.get(r.room_type_id);
    const stay = stays.find((s) => s.room_id === r.id) ?? null;

    const assigned = new Set([
      ...(pinned.get(r.id) ?? []),
      ...(perType.get(r.room_type_id) ?? []),
    ]);

    let stayInfo: RoomStayInfo | null = null;
    if (stay) {
      // The same folio maths the bill uses — no second implementation.
      const folio = buildFolio(
        { check_in_at: stay.check_in_at, check_out_at: null, room_rate: Number(stay.room_rate) },
        [],
        [],
        {}
      );
      const counts = countByStay.get(stay.id) ?? { total: 0, pending: 0 };
      stayInfo = {
        stay_id: stay.id,
        guest_name: stay.guest_name,
        guest_phone: stay.guest_phone,
        guest_count: stay.guest_count,
        room_rate: Number(stay.room_rate),
        check_in_at: stay.check_in_at,
        nights_so_far: folio.nights,
        running_total:
          folio.roomTotal + (foodByStay.get(stay.id) ?? 0) + (extrasByStay.get(stay.id) ?? 0),
        items_total: counts.total,
        items_pending: counts.pending,
        session_id: sessionOfStay.get(stay.id) ?? null,
      };
    }

    return {
      id: r.id,
      number: r.number,
      status: r.status,
      type_id: r.room_type_id,
      type_name: t?.name ?? "—",
      base_price: t?.base_price ?? 0,
      session_id: sessions.find((s) => s.room_id === r.id)?.id ?? null,
      stay: stayInfo,
      staff: [...assigned].map((id) => names.get(id)!).sort(),
    };
  });
}

// ─── Check in ────────────────────────────────────────────────────────────────

export async function checkInRoom(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!canSeeRooms(ru)) return { error: "You don't have permission to manage rooms." };

  const roomId = String(formData.get("room_id") ?? "");
  const guestName = String(formData.get("guest_name") ?? "").trim();
  const guestPhone = String(formData.get("guest_phone") ?? "").trim();
  const guestCount = parseInt(String(formData.get("guest_count") ?? "1"), 10) || 1;
  const notes = String(formData.get("notes") ?? "").trim();

  if (!roomId) return { error: "No room selected." };
  if (!guestName) return { error: "Enter the guest's name." };

  // The same room isolation that governs tables: staff may only work the rooms
  // they are assigned to.
  const visibility = await buildVisibilityFilter(ru.restaurant_id, ru);
  if (!visibility.seesAll && !visibility.canSeeRoom(roomId)) {
    return { error: "That room isn't assigned to you." };
  }

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = service as any;

  // A room-service guest orders from the same QR flow, so the same PIN rule
  // applies: only "With PIN" restaurants get one.
  const { data: rest } = await svc
    .from("restaurants")
    .select("qr_mode")
    .eq("id", ru.restaurant_id)
    .maybeSingle();
  const pin =
    (rest?.qr_mode ?? "ordering_enabled") === "ordering_enabled"
      ? String(Math.floor(1000 + Math.random() * 9000))
      : null;

  const { data, error } = await svc.rpc("check_in_room", {
    p_restaurant_id: ru.restaurant_id,
    p_room_id: roomId,
    p_guest_name: guestName,
    p_guest_phone: guestPhone || null,
    p_guest_count: guestCount,
    p_notes: notes || null,
    p_customer_pin: pin,
    p_created_by: ru.id,
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("ROOM_OCCUPIED")) return { error: "Someone is already checked into this room." };
    if (msg.includes("ROOM_HAS_OPEN_SESSION")) {
      return { error: "This room still has an open session from before check-in existed. Settle that bill first." };
    }
    if (msg.includes("ROOM_UNAVAILABLE")) return { error: "This room is under maintenance." };
    if (msg.includes("ROOM_NEEDS_CLEANING"))
      return { error: "This room is still being cleaned. Mark it clean before checking a guest in." };
    if (msg.includes("GUEST_NAME_REQUIRED")) return { error: "Enter the guest's name." };
    if (msg.includes("ROOM_NOT_FOUND")) return { error: "That room no longer exists." };
    return { error: "Could not check the guest in. Please try again." };
  }

  revalidatePath("/employee/dashboard");
  redirect(`/employee/session/${data.session_id}`);
}

// A room parks in "cleaning" automatically at checkout (see check_out_room). This is the way
// out: housekeeping taps once and it's sellable again.
//
// Same right as checking a guest IN (view_rooms + the room assignment filter) — whoever can
// put a guest in the room is trusted to say it's been made up. Gating this behind
// manage_rooms would leave the Waiter/Cashier presets unable to release a room, and rooms
// would sit dirty waiting for a manager.
export async function markRoomClean(roomId: string): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!canSeeRooms(ru)) return { error: "You don't have permission to manage rooms." };

  const visibility = await buildVisibilityFilter(ru.restaurant_id, ru);
  if (!visibility.seesAll && !visibility.canSeeRoom(roomId)) {
    return { error: "That room isn't assigned to you." };
  }

  const service = createServiceClient();
  // Only a room actually being cleaned is released. Scoping the UPDATE to status='cleaning'
  // means this can never yank an OCCUPIED room out from under a guest, or quietly undo
  // 'maintenance' — a stray tap does nothing rather than something wrong.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("rooms")
    .update({ status: "available" })
    .eq("id", roomId)
    .eq("restaurant_id", ru.restaurant_id)
    .eq("status", "cleaning");

  if (error) return { error: "Could not mark the room clean. Please try again." };

  // The UPDATE fires rs_ev_rooms, so reception's screen repaints without a refresh.
  revalidatePath("/employee/dashboard");
  return null;
}

// ─── The folio ───────────────────────────────────────────────────────────────

export type RoomFolioView = {
  stay_id: string;
  room_id: string;
  room_number: string;
  type_name: string;
  guest_name: string;
  guest_phone: string | null;
  guest_count: number;
  notes: string | null;
  status: "active" | "checked_out";
  session_id: string | null;
  folio: RoomFolio;
  /** Editable extras, so the panel can offer a remove button on each. */
  charges: { id: string; type: RoomChargeType; description: string; amount: number }[];
};

/**
 * Everything the folio is made of, read once.
 *
 * Both the folio view and the checkout go through here, so the bill the
 * receptionist reads and the amount the guest is charged are produced by ONE
 * call to buildFolio over ONE set of inputs. The only difference between them is
 * the discount. Re-deriving the total anywhere else would be a second
 * implementation of the same rule, and the two would eventually disagree — which
 * is the whole reason lib/room-billing.ts exists.
 *
 * Returns null when the stay isn't this restaurant's, or isn't the caller's room.
 */
async function loadFolioInputs(stayId: string) {
  const ru = await getRestaurantUser();
  if (!canSeeRooms(ru)) return null;

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = service as any;

  const { data: stay } = await svc
    .from("room_stays")
    .select(
      "id, room_id, guest_name, guest_phone, guest_count, notes, room_rate, check_in_at, check_out_at, status, rooms ( number, room_type_id )"
    )
    .eq("id", stayId)
    .eq("restaurant_id", ru.restaurant_id)
    .maybeSingle();

  if (!stay) return null;

  const visibility = await buildVisibilityFilter(ru.restaurant_id, ru);
  if (!visibility.seesAll && !visibility.canSeeRoom(stay.room_id)) return null;

  const [typeRes, chargesRes, sessionRes, restRes] = await Promise.all([
    svc.from("room_types").select("name").eq("id", stay.rooms?.room_type_id).maybeSingle(),
    svc
      .from("room_charges")
      .select("id, type, description, amount")
      .eq("room_stay_id", stayId)
      .order("created_at"),
    svc.from("sessions").select("id, status").eq("room_stay_id", stayId).maybeSingle(),
    svc.from("restaurants").select("settings").eq("id", ru.restaurant_id).maybeSingle(),
  ]);

  // F&B ordered against this stay's session — this is what puts room service on
  // the room bill instead of on a ticket of its own.
  let food: { id: string; item_name: string; item_price: number; quantity: number }[] = [];
  const sessionId = sessionRes.data?.id ?? null;
  if (sessionId) {
    const { data: orders } = await svc.from("session_orders").select("id").eq("session_id", sessionId);
    const orderIds = ((orders ?? []) as { id: string }[]).map((o) => o.id);
    if (orderIds.length > 0) {
      const { data: items } = await svc
        .from("session_order_items")
        .select("id, item_name, item_price, quantity")
        .in("order_id", orderIds)
        .is("cancelled_at", null)
        .order("created_at");
      food = ((items ?? []) as typeof food).map((i) => ({ ...i, item_price: Number(i.item_price) }));
    }
  }

  const settings = (restRes.data?.settings ?? {}) as Record<string, unknown>;
  const num = (...keys: string[]) => {
    for (const k of keys) {
      const v = Number(settings[k]);
      if (Number.isFinite(v) && v > 0) return v;
    }
    return 0;
  };

  const charges = ((chargesRes.data ?? []) as RoomFolioView["charges"]).map((c) => ({
    ...c,
    amount: Number(c.amount),
  }));

  return {
    ru,
    svc,
    stay,
    charges,
    food,
    sessionId,
    typeName: (typeRes.data?.name as string) ?? "—",
    config: {
      taxPercent: num("tax_percent", "tax_rate", "gst_percent"),
      servicePercent: num("service_charge_percent", "service_charge"),
    },
  };
}

export async function getRoomFolio(stayId: string): Promise<RoomFolioView | null> {
  const input = await loadFolioInputs(stayId);
  if (!input) return null;

  const { stay, charges, food, sessionId, typeName, config } = input;

  return {
    stay_id: stay.id,
    room_id: stay.room_id,
    room_number: stay.rooms?.number ?? "—",
    type_name: typeName,
    guest_name: stay.guest_name,
    guest_phone: stay.guest_phone,
    guest_count: stay.guest_count,
    notes: stay.notes,
    status: stay.status,
    session_id: sessionId,
    charges,
    folio: buildFolio(
      {
        check_in_at: stay.check_in_at,
        check_out_at: stay.check_out_at,
        room_rate: Number(stay.room_rate),
      },
      charges,
      food,
      config
    ),
  };
}

// ─── Extra charges (§5: the future-ready bit, working today) ──────────────────

export async function addRoomCharge(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  // Posting a charge is adding a line to a bill — the same right as adding an
  // item to an order.
  if (!hasPermission(ru, PERMISSIONS.CREATE_ORDERS)) {
    return { error: "You don't have permission to add charges." };
  }

  const stayId = String(formData.get("stay_id") ?? "");
  const type = String(formData.get("type") ?? "other") as RoomChargeType;
  const description = String(formData.get("description") ?? "").trim();
  const amount = parseFloat(String(formData.get("amount") ?? ""));

  if (!stayId) return { error: "No stay selected." };
  if (!CHARGE_TYPES.some((t) => t.key === type)) return { error: "Unknown charge type." };
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter an amount above zero." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = service as any;

  const { data: stay } = await svc
    .from("room_stays")
    .select("id, room_id, status")
    .eq("id", stayId)
    .eq("restaurant_id", ru.restaurant_id)
    .maybeSingle();

  if (!stay) return { error: "That stay no longer exists." };
  // A checked-out folio is history. Letting a charge land on it would change a
  // bill the guest has already paid and walked away from.
  if (stay.status !== "active") return { error: "This guest has already checked out." };

  const visibility = await buildVisibilityFilter(ru.restaurant_id, ru);
  if (!visibility.seesAll && !visibility.canSeeRoom(stay.room_id)) {
    return { error: "That room isn't assigned to you." };
  }

  const { error } = await svc.from("room_charges").insert({
    restaurant_id: ru.restaurant_id,
    room_stay_id: stayId,
    type,
    description: description || CHARGE_TYPES.find((t) => t.key === type)!.label,
    amount,
    created_by: ru.id,
  });

  if (error) return { error: "Could not add the charge." };

  revalidatePath("/employee/dashboard");
  return null;
}

export async function removeRoomCharge(chargeId: string): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.CREATE_ORDERS)) {
    return { error: "You don't have permission to remove charges." };
  }

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = service as any;

  const { data: charge } = await svc
    .from("room_charges")
    .select("id, room_stay_id, room_stays ( status, room_id )")
    .eq("id", chargeId)
    .eq("restaurant_id", ru.restaurant_id)
    .maybeSingle();

  if (!charge) return { error: "That charge no longer exists." };
  if (charge.room_stays?.status !== "active") {
    return { error: "This guest has already checked out." };
  }

  const visibility = await buildVisibilityFilter(ru.restaurant_id, ru);
  if (!visibility.seesAll && !visibility.canSeeRoom(charge.room_stays?.room_id ?? null)) {
    return { error: "That room isn't assigned to you." };
  }

  await svc.from("room_charges").delete().eq("id", chargeId);
  revalidatePath("/employee/dashboard");
  return null;
}

// ─── Check out ───────────────────────────────────────────────────────────────

export async function checkOutRoom(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.CLOSE_BILLS)) {
    return { error: "You don't have permission to close bills." };
  }

  const stayId = String(formData.get("stay_id") ?? "");
  const method = String(formData.get("payment_method") ?? "cash").toLowerCase();
  const cash = parseFloat(String(formData.get("cash_amount") ?? "0")) || 0;
  const online = parseFloat(String(formData.get("online_amount") ?? "0")) || 0;
  const card = parseFloat(String(formData.get("card_amount") ?? "0")) || 0;
  const discountRaw = parseFloat(String(formData.get("discount") ?? "0")) || 0;

  if (!stayId) return { error: "No stay selected." };
  if (!["cash", "online", "card", "mixed", "credit"].includes(method)) {
    return { error: "Invalid payment method." };
  }
  if (cash < 0 || online < 0 || card < 0) return { error: "Amounts cannot be negative." };

  if (discountRaw > 0 && !hasPermission(ru, PERMISSIONS.APPLY_DISCOUNTS)) {
    return { error: "You don't have permission to apply a discount." };
  }

  // THE important line. The client tells us what it *thinks* the bill is; we
  // ignore it entirely and rebuild the folio here from the stay, its charges and
  // its orders. So a tampered form cannot check a guest out for ₹1, and a browser
  // tab left open overnight cannot under-bill a stay that has since grown another
  // night. Same function, same inputs, one extra term — the discount.
  const input = await loadFolioInputs(stayId);
  if (!input) return { error: "That stay no longer exists." };

  const { svc, stay, charges, food, config } = input;
  if (stay.status !== "active") return { error: "This guest has already checked out." };

  const folio = buildFolio(
    {
      check_in_at: stay.check_in_at,
      check_out_at: null, // billing to NOW — the guest is leaving this instant
      room_rate: Number(stay.room_rate),
    },
    charges,
    food,
    { ...config, discount: discountRaw }
  );

  const total = folio.grandTotal;
  const paid = cash + online + card;

  if (method === "mixed" && Math.abs(cash + online - total) > 0.01) {
    return { error: "The combined Cash and Online amounts must equal the total payable amount." };
  }

  let customerId: string | null = null;
  let customerName: string | null = null;
  let customerPhone: string | null = null;
  let creditNotes: string | null = null;

  if (method === "credit") {
    if (!NAV_ACCESS.canManageCredits(ru)) {
      return { error: "You don't have permission to put a bill on credit." };
    }
    customerId = (String(formData.get("credit_customer_id") ?? "") || "").trim() || null;
    customerName = (String(formData.get("credit_customer_name") ?? "") || "").trim() || null;
    customerPhone = (String(formData.get("credit_customer_phone") ?? "") || "").trim() || null;
    creditNotes = (String(formData.get("credit_notes") ?? "") || "").trim() || null;

    if (!customerId && !customerName) {
      return { error: "Choose an existing customer, or enter a name for a new credit account." };
    }
    if (paid >= total) {
      return { error: "Nothing would be left on credit. Settle it in full instead." };
    }
  } else if (Math.abs(paid - total) > 0.01) {
    return { error: `The amount tendered must equal the total of ₹${total.toFixed(2)}.` };
  }

  const { error } = await svc.rpc("check_out_room", {
    p_restaurant_id: ru.restaurant_id,
    p_stay_id: stayId,
    p_total: total,
    p_cash: cash,
    p_online: online,
    p_card: card,
    p_method: method === "credit" ? "credit" : method,
    p_customer_id: customerId,
    // A hotel already knows who the guest is — default the credit account to them
    // rather than making the receptionist retype a name they just checked in.
    p_customer_name: customerName ?? stay.guest_name,
    p_customer_phone: customerPhone ?? stay.guest_phone,
    p_notes: creditNotes,
    p_created_by: ru.id,
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("STAY_ALREADY_CLOSED")) return { error: "This guest has already checked out." };
    if (msg.includes("STAY_NOT_FOUND")) return { error: "That stay no longer exists." };
    if (msg.includes("INVALID_DOWN_PAYMENT")) {
      return { error: "The amount paid now must be less than the bill total." };
    }
    return { error: "Could not check the guest out. Please try again." };
  }

  revalidatePath("/employee/dashboard");
  revalidatePath("/employee/sales");
  redirect("/employee/dashboard");
}
