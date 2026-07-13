import { notFound } from "next/navigation";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { hasPermission, NAV_ACCESS, PERMISSIONS } from "@/lib/permissions";
import { getRoomFolio } from "@/app/actions/rooms";
import { getSessionDetail } from "@/app/actions/pos";
import { createServiceClient } from "@/lib/supabase/service";
import { FolioClient } from "./_components/folio-client";

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

  const service = createServiceClient();
  const [restRes, session] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("restaurants")
      .select("name, address, contact_phone, pan_vat_number, logo_url")
      .eq("id", restaurantUser.restaurant_id)
      .maybeSingle(),
    // The stay's session, in the SAME shape the table screen uses — so the room
    // can render the very same KOT component rather than a second one that has to
    // be kept in step.
    view.session_id ? getSessionDetail(view.session_id) : Promise.resolve(null),
  ]);

  const rest = restRes.data;

  return (
    <FolioClient
      view={view}
      session={session}
      restaurant={{
        name: rest?.name ?? "",
        address: rest?.address ?? null,
        contact_phone: rest?.contact_phone ?? null,
        pan_vat_number: rest?.pan_vat_number ?? null,
      }}
      staffName={restaurantUser.display_name}
      canAddCharges={hasPermission(restaurantUser, PERMISSIONS.CREATE_ORDERS)}
      canCreateOrders={hasPermission(restaurantUser, PERMISSIONS.CREATE_ORDERS)}
      canManageOrders={NAV_ACCESS.canManageOrders(restaurantUser)}
      canCancelOrders={hasPermission(restaurantUser, PERMISSIONS.CANCEL_ORDERS)}
      canCheckOut={hasPermission(restaurantUser, PERMISSIONS.CLOSE_BILLS)}
      canDiscount={hasPermission(restaurantUser, PERMISSIONS.APPLY_DISCOUNTS)}
      // Billing + Close Bills, same as a table bill. The action re-checks it.
      canUseCredit={NAV_ACCESS.canManageCredits(restaurantUser)}
    />
  );
}
