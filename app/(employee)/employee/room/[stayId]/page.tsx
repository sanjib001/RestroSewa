import { notFound } from "next/navigation";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { hasPermission, hasAnyPermission, NAV_ACCESS, PERMISSIONS, ROOM_ACCESS } from "@/lib/permissions";
import { getRoomFolio } from "@/app/actions/rooms";
import { getSessionDetail } from "@/app/actions/pos";
import { getWorkstations } from "@/app/actions/workstations";
import { getRestaurantConfig } from "@/lib/restaurant-info";
import { FolioClient } from "./_components/folio-client";
import { TransferHistory } from "../../session/[id]/_components/transfer-history";

/**
 * The room's ONE screen — the counterpart of a table's session screen.
 *
 * It used to be the folio and nothing else: a bill. The orders and the Print KOT
 * button lived on the generic session screen, and the only route to them was a
 * link labelled "Add a room-service order". So to print a KOT for an order the
 * guest had ALREADY placed from the room QR, staff had to click "add order" —
 * which is exactly the confusing detour that was reported.
 *
 * Now the orders, the KOT, the extras, the bill and the checkout are all here, and
 * the session screen redirects to this page for any room stay. One room, one
 * screen, same as one table, one screen.
 *
 * `getRoomFolio` already refuses a stay in another restaurant, or one in a room
 * this staff member isn't assigned to, so reaching here at all means the viewer
 * is allowed to.
 */
export default async function RoomPage({
  params,
}: {
  params: Promise<{ stayId: string }>;
}) {
  const { stayId } = await params;
  const { restaurantUser } = await requireRestaurantStaff();

  const view = await getRoomFolio(stayId);
  if (!view) notFound();

  const [config, session, workstations] = await Promise.all([
    // The SAME cached config the session screen reads, instead of this page's own
    // uncached `restaurants` select. It removes a round trip, and it carries two things
    // that select never did: the tax/service percentages the printed bill needs, and
    // whether a discount PIN exists at all.
    getRestaurantConfig(restaurantUser.restaurant_id),
    // The stay's session, in the SAME shape the table screen uses — so the room
    // can render the very same ticket components rather than a second set that has
    // to be kept in step.
    view.session_id ? getSessionDetail(view.session_id) : Promise.resolve(null),
    // Station list so each item lands on its own workstation Order Ticket.
    getWorkstations(restaurantUser.restaurant_id),
  ]);

  // KOT/BOT and bill printing is a billing/order-management action — Cashier /
  // Receptionist, NOT a waiter. Gate on the billing permissions only they carry,
  // not CREATE_ORDERS (which waiters hold).
  const canPrintTickets = hasAnyPermission(restaurantUser, [
    PERMISSIONS.PROCESS_PAYMENTS,
    PERMISSIONS.CLOSE_BILLS,
  ]);

  return (
    <>
    {/* Where this guest has been. Renders nothing unless the stay has been moved.
        Matches FolioClient's own container so it lines up with the cards below it. */}
    {session && session.transfers.length > 0 && (
      <div className="max-w-2xl mx-auto px-3 sm:px-5 pt-4">
        <TransferHistory transfers={session.transfers} />
      </div>
    )}
    <FolioClient
      view={view}
      session={session}
      restaurant={{
        name: config.name,
        address: config.address,
        contact_phone: config.contact_phone,
        pan_vat_number: config.pan_vat_number,
        logo_url: config.logo_url,
        paper_width_mm: config.paper_width_mm,
        bill_number_pad: config.bill_number_pad,
        bill_number_label: config.bill_number_label,
        // The room bill used to render with these at 0 while `buildFolio` used the real
        // ones, so a restaurant that ever switches VAT on would have had the folio and its
        // own printed bill disagree.
        tax_percent: config.tax_percent,
        service_charge_percent: config.service_charge_percent,
      }}
      staffName={restaurantUser.display_name}
      workstations={workstations}
      canAddCharges={hasPermission(restaurantUser, PERMISSIONS.CREATE_ORDERS)}
      canCreateOrders={hasPermission(restaurantUser, PERMISSIONS.CREATE_ORDERS)}
      canManageOrders={NAV_ACCESS.canManageOrders(restaurantUser)}
      canCancelOrders={hasPermission(restaurantUser, PERMISSIONS.CANCEL_ORDERS)}
      canCheckOut={hasPermission(restaurantUser, PERMISSIONS.CLOSE_BILLS)}
      canDiscount={hasPermission(restaurantUser, PERMISSIONS.APPLY_DISCOUNTS)}
      // Discounts exist only where an admin has set the restaurant's discount PIN — the
      // same switch the table bill obeys. The hash is collapsed to a boolean inside
      // getRestaurantConfig so it never reaches the client; the PIN itself is verified
      // server-side in `checkOutRoom`.
      discountEnabled={config.discountEnabled}
      // Ticket + bill generation is billing staff only, same as a table. Re-checked server-side.
      canPrintTickets={canPrintTickets}
      canPrintBill={canPrintTickets}
      // Billing + Close Bills, same as a table bill. The action re-checks it.
      canUseCredit={NAV_ACCESS.canManageCredits(restaurantUser)}
      // Taking a deposit rides on check_in: whoever can put a guest in the room is the
      // person who takes their money at the desk.
      canTakeAdvance={ROOM_ACCESS.canCheckIn(restaurantUser)}
      canCheckIn={ROOM_ACCESS.canCheckIn(restaurantUser)}
      canCancelStay={ROOM_ACCESS.canCancelStay(restaurantUser)}
      // CORRECTING one is a different act — it rewrites money already counted into a
      // day's cash. Same gate as the Sales page's tender edit (Process Payments; the
      // admin passes automatically), and the server also demands the Security PIN.
      canEditAdvance={hasPermission(restaurantUser, PERMISSIONS.PROCESS_PAYMENTS)}
    />
    </>
  );
}
