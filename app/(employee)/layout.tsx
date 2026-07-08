import { requireRestaurantStaff } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/service";
import { getNotificationCount } from "@/app/actions/notifications";
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

  const notificationCount = await getNotificationCount(restaurantUser.restaurant_id, restaurantUser);

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
        notificationCount={notificationCount}
        navItems={navItems}
      />
      <main>{children}</main>
    </div>
  );
}
