import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSessionDetail } from "@/app/actions/pos";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { hasPermission, NAV_ACCESS, PERMISSIONS } from "@/lib/permissions";
import { buildVisibilityFilter } from "@/lib/assignments";
import { createServiceClient } from "@/lib/supabase/service";
import { SessionClient } from "./_components/session-client";
import type { RestaurantInfo } from "./_components/print-tickets";
import { ChevronLeft } from "lucide-react";

// Reads optional percentage charges from the restaurant `settings` JSON. Returns
// undefined when absent/invalid so the bill simply omits the line.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function numFromSettings(settings: any, ...keys: string[]): number | undefined {
  if (!settings || typeof settings !== "object") return undefined;
  for (const k of keys) {
    const v = Number(settings[k]);
    if (!Number.isNaN(v) && v > 0) return v;
  }
  return undefined;
}

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [session, { restaurantUser }] = await Promise.all([
    getSessionDetail(id),
    requireRestaurantStaff(),
  ]);

  if (!session) notFound();

  // Table-group isolation: a staff member may only open a session whose table
  // group (or room) they are assigned to. Admins/managers and walk-ins pass.
  const visibility = await buildVisibilityFilter(restaurantUser.restaurant_id, restaurantUser);
  const canView =
    visibility.seesAll ||
    (visibility.canSeeTable(session.table_id) && visibility.canSeeRoom(session.room_id));
  if (!canView) notFound();

  // A room stay has ONE screen, and this isn't it. Any link that still points
  // here — an old bookmark, the Orders queue, a redirect after adding an item —
  // lands on the room screen, where the orders, the KOT and the full folio all
  // live. Redirecting rather than rendering is what stops the two screens
  // drifting back apart.
  if (session.room_stay_id) {
    redirect(`/employee/room/${session.room_stay_id}`);
  }

  const canCreateOrders = hasPermission(restaurantUser, PERMISSIONS.CREATE_ORDERS);
  const canCloseBills   = hasPermission(restaurantUser, PERMISSIONS.CLOSE_BILLS);
  const canForceClose   =
    hasPermission(restaurantUser, PERMISSIONS.CLOSE_BILLS) ||
    hasPermission(restaurantUser, PERMISSIONS.MANAGE_TABLES);
  // Putting a bill on credit is a Cashier/Receptionist action — Billing +
  // Close Bills. The server action re-checks this.
  const canUseCredit = NAV_ACCESS.canManageCredits(restaurantUser);
  // Cancelling takes an item off the bill and puts its stock back, so it is its
  // own permission rather than something any waiter may do. Re-checked server-side.
  const canCancelOrders = hasPermission(restaurantUser, PERMISSIONS.CANCEL_ORDERS);

  // Everyone who can view the session can also see its ordering PIN.
  const canSeePIN = canView;

  // Restaurant header details for the KOT / Bill tickets.
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rest } = await (service as any)
    .from("restaurants")
    .select("name, address, contact_phone, pan_vat_number, settings")
    .eq("id", restaurantUser.restaurant_id)
    .maybeSingle();

  const restaurant: RestaurantInfo = {
    name: rest?.name ?? "Restaurant",
    address: rest?.address ?? null,
    contact_phone: rest?.contact_phone ?? null,
    pan_vat_number: rest?.pan_vat_number ?? null,
    tax_percent: numFromSettings(rest?.settings, "tax_percent", "tax_rate", "gst_percent"),
    service_charge_percent: numFromSettings(rest?.settings, "service_charge_percent", "service_charge"),
  };

  const label =
    session.type === "table" && session.table_number
      ? `Table ${session.table_number}`
      : session.type === "walk_in"
      ? "Walk-in"
      : session.type === "room_service"
      ? "Room service"
      : "Session";

  return (
    <div className="p-4 sm:p-5 max-w-lg mx-auto">
      <Link
        href="/employee/dashboard"
        className="inline-flex items-center gap-1 text-sm mb-4"
        style={{ color: "var(--color-ink-mute)" }}
      >
        <ChevronLeft size={14} />
        Tables
      </Link>

      <div className="flex items-center justify-between mb-5">
        <h1
          className="text-xl"
          style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}
        >
          {label}
        </h1>
        <span
          className="text-xs px-2 py-0.5 rounded-full border"
          style={{
            color: session.status === "active" ? "#1a7a4a" : "var(--color-ink-mute)",
            borderColor: session.status === "active" ? "#1a7a4a44" : "var(--color-hairline)",
            background: session.status === "active" ? "#f0fdf4" : "transparent",
          }}
        >
          {session.status}
        </span>
      </div>

      <SessionClient
        session={session}
        restaurant={restaurant}
        staffName={restaurantUser.display_name}
        canCreateOrders={canCreateOrders}
        canCloseBills={canCloseBills}
        canForceClose={canForceClose}
        canSeePIN={canSeePIN}
        canUseCredit={canUseCredit}
        canCancelOrders={canCancelOrders}
      />
    </div>
  );
}
