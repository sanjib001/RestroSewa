import { redirect } from "next/navigation";
import { hasPermission } from "@/lib/permissions";
import type { Permission } from "@/lib/permissions";
import { getAuthUser, getStaffRow, isSuperAdmin } from "@/lib/auth/current-user";

// Every guard resolves the caller through the request-memoised helpers in
// current-user.ts. The checks themselves are unchanged — same auth, same role,
// same permission, same redirects. What changed is that a page calling four
// guarded things no longer makes four HTTP auth round-trips to Supabase and four
// identical staff-row lookups. It makes one of each.

export type RestaurantUserContext = {
  id: string;
  restaurant_id: string;
  role: string;
  display_name: string;
  permissions: string[];
  /**
   * The restaurant's business-day boundary — see `StaffRow.closingHour`.
   * Server components read it from here to resolve dates before handing them to
   * client components, which must never work the day out themselves.
   */
  closingHour: number;
};

export async function requireSuperAdmin() {
  const user = await getAuthUser();
  if (!user) redirect("/superadmin/login");

  if (!(await isSuperAdmin(user.id))) redirect("/superadmin/login");

  return user;
}

export async function requireRestaurantStaff() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const restaurantUser = await getStaffRow(user.id);
  if (!restaurantUser) redirect("/login");

  return { user, restaurantUser: restaurantUser as RestaurantUserContext };
}

// Accepts restaurant_admin (always passes) OR restaurant_employee with the given
// permission. Redirects to /employee/dashboard if authenticated but lacking it.
export async function requireAdminOrPermission(permission: Permission) {
  const { user, restaurantUser } = await requireRestaurantStaff();

  if (!hasPermission(restaurantUser, permission)) {
    redirect("/employee/dashboard");
  }

  return { user, restaurantUser };
}

export async function requireRestaurantAdmin() {
  const { user, restaurantUser } = await requireRestaurantStaff();

  // The role filter used to be a `.eq("role", …)` in the SQL. Checking it here
  // instead lets the row come from the shared per-request cache, and rejects
  // exactly the same people: a non-admin found no row before, and fails this
  // check now. Both land on /login.
  if (restaurantUser.role !== "restaurant_admin") redirect("/login");

  return { user, restaurantUser };
}
