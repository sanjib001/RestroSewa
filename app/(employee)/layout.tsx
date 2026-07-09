import { requireRestaurantStaff } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveNotifications } from "@/app/actions/notifications";
import { getStaffNav } from "@/lib/permissions";
import { StaffNav } from "./employee/_components/staff-nav";

export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const { restaurantUser } = await requireRestaurantStaff();

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: restaurant } = await (service as any)
    .from("restaurants")
    .select("name")
    .eq("id", restaurantUser.restaurant_id)
    .single();

  // Split the unread counts: service calls (waiter/bill) drive the Notifications
  // badge, new orders drive the Orders badge. Both are routed by the same
  // table-group + workstation visibility as everything else.
  const notifs = await getActiveNotifications(restaurantUser.restaurant_id, restaurantUser);
  const serviceCount = notifs.filter((n) => n.type !== "new_order" && n.status === "new").length;
  const orderCount = notifs.filter((n) => n.type === "new_order" && n.status === "new").length;

  // Navigation is derived entirely from the staff member's permissions so the
  // visible items always match the backend route guards.
  const navItems = getStaffNav(restaurantUser).map(({ key, label, href, exact }) => ({
    key,
    label,
    href,
    exact,
  }));

  return (
    <div className="min-h-screen" style={{ background: "var(--color-canvas-soft)" }}>
      <StaffNav
        restaurantName={restaurant?.name ?? "Restaurant"}
        displayName={restaurantUser.display_name}
        notificationCount={serviceCount}
        orderCount={orderCount}
        navItems={navItems}
      />
      <main>{children}</main>
    </div>
  );
}
