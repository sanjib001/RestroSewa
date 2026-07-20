import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/current-user";

export type RestaurantUserCtx = {
  id: string;
  restaurant_id: string;
  role: string;
  permissions: string[];
  /** The restaurant's business-day boundary — see `StaffRow.closingHour`. */
  closingHour: number;
};

/**
 * The caller, for server actions.
 *
 * Was: an HTTP auth round-trip plus a staff-row query, EVERY time — and nearly
 * every action calls it, so a dashboard rendering six sections paid for it six
 * times over. It now reads the per-request cache: the first caller in a request
 * pays, the rest are free. Same result, same redirect, same permissions.
 */
export async function getRestaurantUser(): Promise<RestaurantUserCtx> {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  return staff;
}
