import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import {
  getMenuCategories,
  getMenuItemsByCategory,
  getAvailableVariants,
} from "@/app/actions/menu";
import type { MenuItemRow } from "@/app/actions/menu";
import { getCustomerNotifState, getCustomerActivationState } from "@/app/actions/customer";
import type { ActivationStatus } from "@/app/actions/customer";
import { CustomerMenu } from "./_components/customer-menu";
import { QrSplash } from "./_components/qr-splash";

// Whether an item belongs on the menu *right now*. This intentionally keeps
// `out_of_stock` items (they render as disabled "Sold out" cards) and only hides
// deleted, admin-hidden, or out-of-schedule items.
function isItemOnMenuNow(item: MenuItemRow): boolean {
  if (item.is_deleted) return false;
  if (item.availability_status === "hidden") return false;

  const now = new Date();
  const dayOfWeek = now.getDay();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const todayStr = now.toISOString().split("T")[0];

  if (item.available_days?.length && !item.available_days.includes(dayOfWeek)) return false;

  if (item.time_from && item.time_until) {
    const [fh, fm] = item.time_from.split(":").map(Number);
    const [uh, um] = item.time_until.split(":").map(Number);
    if (nowMinutes < fh * 60 + fm || nowMinutes > uh * 60 + um) return false;
  }

  if (item.date_from && todayStr < item.date_from) return false;
  if (item.date_until && todayStr > item.date_until) return false;

  return true;
}

export default async function CustomerMenuPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ table?: string; room?: string }>;
}) {
  const { slug } = await params;
  const { table: tableQrToken, room: roomQrToken } = await searchParams;

  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: restaurant } = await (service as any)
    .from("restaurants")
    .select("id, name, logo_url, is_active, customer_ordering_enabled, qr_mode")
    .eq("slug", slug)
    .maybeSingle();

  if (!restaurant || !restaurant.is_active) notFound();

  const orderingEnabled: boolean = restaurant.customer_ordering_enabled ?? true;
  const qrMode: string = restaurant.qr_mode ?? "ordering_enabled";
  // In no-PIN ordering mode a session need not carry a customer PIN, so we pick up
  // any active session for the table/room (staff-opened or customer-created).
  const noPin = qrMode === "ordering_no_pin";

  // ── Table context ──
  let tableId: string | null = null;
  let tableNumber: string | null = null;
  let sessionId: string | null = null;

  if (tableQrToken) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: table } = await (service as any)
      .from("restaurant_tables")
      .select("id, number")
      .eq("restaurant_id", restaurant.id)
      .eq("qr_token", tableQrToken)
      .eq("is_active", true)
      .maybeSingle();

    if (table) {
      tableId = table.id;
      tableNumber = table.number;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let tableSessionQ = (service as any)
        .from("sessions")
        .select("id")
        .eq("restaurant_id", restaurant.id)
        .eq("table_id", tableId);
      // No-PIN also picks up a session that's still awaiting staff activation, so
      // a reload during that wait resumes the "pending approval" state.
      if (noPin) tableSessionQ = tableSessionQ.in("status", ["active", "pending_activation"]);
      else tableSessionQ = tableSessionQ.eq("status", "active").not("customer_pin", "is", null);
      const { data: activeSession } = await tableSessionQ
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      sessionId = activeSession?.id ?? null;
    }
  }

  // ── Room context ──
  let roomId: string | null = null;
  let roomNumber: string | null = null;

  if (roomQrToken && !tableQrToken) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: room } = await (service as any)
      .from("rooms")
      .select("id, number")
      .eq("restaurant_id", restaurant.id)
      .eq("qr_token", roomQrToken)
      .maybeSingle();

    if (room) {
      roomId = room.id;
      roomNumber = room.number;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let roomSessionQ = (service as any)
        .from("sessions")
        .select("id")
        .eq("restaurant_id", restaurant.id)
        .eq("room_id", roomId);
      if (noPin) roomSessionQ = roomSessionQ.in("status", ["active", "pending_activation"]);
      else roomSessionQ = roomSessionQ.eq("status", "active").not("customer_pin", "is", null);
      const { data: activeRoomSession } = await roomSessionQ
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      sessionId = activeRoomSession?.id ?? null;
    }
  }

  const [categories, initialNotifState] = await Promise.all([
    getMenuCategories(restaurant.id),
    getCustomerNotifState(restaurant.id, tableId, roomId, sessionId),
  ]);

  // No-PIN table activation: where does this table stand (waiting / approved /
  // declined)? Resolved server-side so a fresh load / reload shows the right state.
  let initialActivationStatus: ActivationStatus = "none";
  if (noPin && (tableId || roomId)) {
    const st = await getCustomerActivationState(restaurant.id, tableId, roomId, sessionId);
    initialActivationStatus = st.status;
    sessionId = st.sessionId ?? sessionId;
  }

  const activeCategories = categories.filter((c) => c.is_active);
  const itemsByCategory = await Promise.all(
    activeCategories.map((c) => getMenuItemsByCategory(restaurant.id, c.id))
  );
  const allItems: MenuItemRow[] = itemsByCategory.flat().filter(isItemOnMenuNow);
  const categoriesWithItems = activeCategories.filter((c) =>
    allItems.some((i) => i.category_id === c.id)
  );

  // Only AVAILABLE variants come back, so a size that has run out simply isn't
  // offered — the guest never picks something that would be refused on submit.
  const variants = await getAvailableVariants(restaurant.id);

  return (
    <>
      {/* The RestroSewa moment. Overlays the menu while it renders underneath, so
          the guest waits once, not twice. */}
      <QrSplash slug={slug} />

      <CustomerMenu
        restaurantId={restaurant.id}
        restaurantName={restaurant.name}
        restaurantLogo={restaurant.logo_url ?? null}
        tableId={tableId}
        tableNumber={tableNumber}
        roomId={roomId}
        roomNumber={roomNumber}
        sessionId={sessionId}
        orderingEnabled={orderingEnabled}
        qrMode={qrMode}
        categories={categoriesWithItems}
        items={allItems}
        variants={variants}
        initialNotifState={initialNotifState}
        initialActivationStatus={initialActivationStatus}
      />
    </>
  );
}
