import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSessionDetail } from "@/app/actions/pos";
import { walkInLabel } from "@/lib/walk-ins";
import { getWorkstations } from "@/app/actions/workstations";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { hasPermission, hasAnyPermission, NAV_ACCESS, PERMISSIONS } from "@/lib/permissions";
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
  // KOT/BOT printing is a billing/order-management action — Cashier / Receptionist,
  // NOT a waiter. It used to be gated on CREATE_ORDERS, which waiters hold, so any
  // waiter could print kitchen tickets. Billing permissions are the ones only
  // Cashier / Receptionist / Manager carry.
  const canPrintTickets = hasAnyPermission(restaurantUser, [
    PERMISSIONS.PROCESS_PAYMENTS,
    PERMISSIONS.CLOSE_BILLS,
  ]);
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

  // Restaurant header details for the KOT / Bill tickets, plus the station list so a
  // ticket can sort each item onto the KOT (kitchen) or the BOT (bar).
  const service = createServiceClient();
  const [{ data: rest }, workstations] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("restaurants")
      .select("name, address, contact_phone, pan_vat_number, logo_url, settings, discount_pin_hash")
      .eq("id", restaurantUser.restaurant_id)
      .maybeSingle(),
    getWorkstations(restaurantUser.restaurant_id),
  ]);

  const restaurant: RestaurantInfo = {
    name: rest?.name ?? "Restaurant",
    address: rest?.address ?? null,
    contact_phone: rest?.contact_phone ?? null,
    pan_vat_number: rest?.pan_vat_number ?? null,
    logo_url: rest?.logo_url ?? null,
    paper_width_mm: rest?.settings?.print_paper_width === "58" ? 58 : 80,
    bill_number_pad: Number.isFinite(Number(rest?.settings?.bill_number_pad)) ? Number(rest?.settings?.bill_number_pad) : 0,
    bill_number_label: rest?.settings?.bill_number_label === "order" ? "order" : "bill",
    tax_percent: numFromSettings(rest?.settings, "tax_percent", "tax_rate", "gst_percent"),
    service_charge_percent: numFromSettings(rest?.settings, "service_charge_percent", "service_charge"),
  };

  // Discounts exist only where an admin has set a discount PIN. Collapsed to a boolean here
  // so the hash never crosses to the client; the PIN itself is still checked server-side at
  // payment, so this only decides whether the field is worth showing.
  const discountEnabled = !!rest?.discount_pin_hash;

  const label =
    session.type === "table" && session.table_number
      ? `Table ${session.table_number}`
      : session.type === "walk_in"
      ? session.walk_in_no
        ? `Walk-in ${walkInLabel(session.walk_in_no)}`
        : "Walk-in"
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
            color: session.status === "active" ? "var(--color-success)" : "var(--color-ink-mute)",
            borderColor: session.status === "active" ? "color-mix(in srgb, var(--color-success) 27%, transparent)" : "var(--color-hairline)",
            background: session.status === "active" ? "var(--color-success-bg)" : "transparent",
          }}
        >
          {session.status}
        </span>
      </div>

      <SessionClient
        session={session}
        restaurant={restaurant}
        staffName={restaurantUser.display_name}
        workstations={workstations}
        canCreateOrders={canCreateOrders}
        canCloseBills={canCloseBills}
        canPrintTickets={canPrintTickets}
        canForceClose={canForceClose}
        canSeePIN={canSeePIN}
        canUseCredit={canUseCredit}
        canCancelOrders={canCancelOrders}
        discountEnabled={discountEnabled}
      />
    </div>
  );
}
