import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSessionDetail } from "@/app/actions/pos";
import { getRestaurantConfig } from "@/lib/restaurant-info";
import { walkInLabel } from "@/lib/walk-ins";
import { getWorkstations } from "@/app/actions/workstations";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { hasPermission, hasAnyPermission, NAV_ACCESS, PERMISSIONS } from "@/lib/permissions";
import { buildVisibilityFilter } from "@/lib/assignments";
import { createServiceClient } from "@/lib/supabase/service";
import { SessionClient } from "./_components/session-client";
import { TransferHistory } from "./_components/transfer-history";
import { SessionSplitView } from "./_components/session-split-view";
import { getAddItemsMenuData } from "@/lib/menu-browser-data";
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

  // Everything below needs only `restaurantUser.restaurant_id`, so it all goes in ONE
  // wave. It used to be three: the visibility filter, then (after ~40 lines of pure
  // permission arithmetic that costs nothing) the restaurant row and the workstation
  // list. Nothing was waiting for anything — they were just written in sequence, and each
  // `await` on its own line is a full network round trip.
  const [visibility, config, workstations] = await Promise.all([
    // Table-group isolation: a staff member may only open a session whose table
    // group (or room) they are assigned to. Admins/managers and walk-ins pass.
    buildVisibilityFilter(restaurantUser.restaurant_id, restaurantUser),
    // Restaurant header details for the KOT / Bill tickets. Cached (60s) and shared with
    // every other document that prints, so this usually costs nothing.
    getRestaurantConfig(restaurantUser.restaurant_id),
    // The station list, so a ticket can sort each item onto the KOT or the BOT. Also cached.
    getWorkstations(restaurantUser.restaurant_id),
  ]);

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

  // Menu data for the desktop/tablet split-view's "Menu" tab — same fetch the
  // standalone mobile `/add` route uses (`lib/menu-browser-data.ts`), so both
  // surfaces always show the identical menu. Not fetched at all for a viewer
  // who can't create orders — there would be no Menu tab to show it in.
  const menuData = canCreateOrders ? await getAddItemsMenuData(restaurantUser) : null;

  const restaurant: RestaurantInfo = {
    name: config.name,
    address: config.address,
    contact_phone: config.contact_phone,
    pan_vat_number: config.pan_vat_number,
    logo_url: config.logo_url,
    paper_width_mm: config.paper_width_mm,
    bill_number_pad: config.bill_number_pad,
    bill_number_label: config.bill_number_label,
    tax_percent: config.tax_percent,
    service_charge_percent: config.service_charge_percent,
  };

  // Discounts exist only where an admin has set a discount PIN. The hash is collapsed to a
  // boolean inside getRestaurantConfig so it never reaches a shared cache or the client;
  // the PIN itself is still checked server-side at payment.
  const discountEnabled = config.discountEnabled;

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
    <SessionSplitView
      sessionId={id}
      canCreateOrders={canCreateOrders}
      menuData={menuData}
    >
      {/* Solid brand-primary fill, not a soft pill — the soft tint (previous
          version, and still what pills elsewhere use) reads as calm, passive
          UI chrome. A back button gets tapped constantly on a busy floor and
          needs to read as an actual button at a glance, so it gets the same
          filled, high-contrast treatment as a primary action. */}
      <Link
        href="/employee/dashboard"
        className="inline-flex items-center gap-1 text-sm font-semibold mb-4 px-3 py-1.5 -ml-1 rounded-lg transition-colors hover:brightness-110 active:brightness-95"
        style={{ color: "#fff", background: "var(--color-primary)" }}
      >
        <ChevronLeft size={15} />
        Back
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

      {/* Where this session has been. Renders nothing unless it has actually moved. */}
      <TransferHistory transfers={session.transfers} />

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
    </SessionSplitView>
  );
}
