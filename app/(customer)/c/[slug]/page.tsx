import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { getMenuCategories, getMenuItemsByCategory } from "@/app/actions/menu";
import type { MenuItemRow } from "@/app/actions/menu";
import { getCustomerNotifState } from "@/app/actions/customer";
import type { CustomerNotifState } from "@/app/actions/customer";
import { CustomerMenu } from "./_components/customer-menu";

function isItemAvailableNow(item: MenuItemRow): boolean {
  if (item.availability_status !== "available") return false;
  if (item.is_deleted) return false;

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
    .select("id, name, is_active, customer_ordering_enabled, qr_mode")
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
        .eq("table_id", tableId)
        .eq("status", "active");
      if (!noPin) tableSessionQ = tableSessionQ.not("customer_pin", "is", null);
      const { data: activeSession } = await tableSessionQ.maybeSingle();
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
        .eq("room_id", roomId)
        .eq("status", "active");
      if (!noPin) roomSessionQ = roomSessionQ.not("customer_pin", "is", null);
      const { data: activeRoomSession } = await roomSessionQ.maybeSingle();
      sessionId = activeRoomSession?.id ?? null;
    }
  }

  const [categories, initialNotifState] = await Promise.all([
    getMenuCategories(restaurant.id),
    getCustomerNotifState(restaurant.id, tableId, roomId, sessionId),
  ]);

  const activeCategories = categories.filter((c) => c.is_active);
  const itemsByCategory = await Promise.all(
    activeCategories.map((c) => getMenuItemsByCategory(restaurant.id, c.id))
  );
  const allItems: MenuItemRow[] = itemsByCategory.flat().filter(isItemAvailableNow);
  const categoriesWithItems = activeCategories.filter((c) =>
    allItems.some((i) => i.category_id === c.id)
  );

  return (
    <CustomerMenu
      restaurantId={restaurant.id}
      restaurantName={restaurant.name}
      tableId={tableId}
      tableNumber={tableNumber}
      roomId={roomId}
      roomNumber={roomNumber}
      sessionId={sessionId}
      orderingEnabled={orderingEnabled}
      qrMode={qrMode}
      categories={categoriesWithItems}
      items={allItems}
      initialNotifState={initialNotifState}
    />
  );
}
