import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeClosingHour } from "@/lib/business-day";

/**
 * Who is asking — resolved ONCE per request.
 *
 * `supabase.auth.getUser()` is not a local JWT decode. It is an HTTP round-trip
 * to Supabase Auth to validate the token (~300ms against a remote project), and
 * every guard and every server action was calling it independently. A Cashier's
 * dashboard renders six sections, each fetching through its own action, so a
 * single page load spent about two seconds doing the same auth check seven times
 * and the same staff-row lookup seven times.
 *
 * That is also exactly why the problem scaled with permissions: more permissions
 * meant more sections, which meant more actions, which meant more auth calls. A
 * staff member with two sections barely noticed.
 *
 * React's `cache()` memoises for the lifetime of ONE server request, so every
 * caller inside a single render now shares one result. It is not a cross-request
 * cache — a different user, or the next request, resolves afresh. Nothing about
 * who may see what changes; only the number of times we ask.
 */
export const getAuthUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export type StaffRow = {
  id: string;
  restaurant_id: string;
  role: string;
  display_name: string;
  permissions: string[];
  /**
   * The restaurant's business-day boundary (whole hours; 0 = midnight).
   *
   * It rides along on the staff row rather than being fetched where it's used:
   * every server action already opens with `getRestaurantUser()`, so the hour
   * arrives free inside a value the caller is holding anyway — no extra round
   * trip, and it is structurally bound to the right tenant, so a report cannot
   * accidentally be bucketed with another restaurant's boundary.
   */
  closingHour: number;
};

/** The caller's restaurant_users row, or null. Memoised per request. */
export const getStaffRow = cache(async (authUserId: string): Promise<StaffRow | null> => {
  const service = createServiceClient();
  // `restaurant_users` has exactly one FK to `restaurants`, so the embed is
  // unambiguous and costs nothing beyond one more column on the same query.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("restaurant_users")
    .select("id, restaurant_id, role, display_name, permissions, restaurants ( settings )")
    .eq("auth_user_id", authUserId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .maybeSingle();

  if (!data) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = data as any;
  // PostgREST returns a to-one embed as an object, but tolerate an array so a
  // relationship-shape change can't take down every authenticated request.
  const rest = Array.isArray(raw.restaurants) ? raw.restaurants[0] : raw.restaurants;

  return {
    id: raw.id,
    restaurant_id: raw.restaurant_id,
    role: raw.role,
    display_name: raw.display_name,
    // A row predating the permissions migration can carry null.
    permissions: Array.isArray(raw.permissions) ? raw.permissions : [],
    closingHour: normalizeClosingHour(rest?.settings?.business_closing_hour),
  };
});

/** The caller as staff, or null when not signed in / not staff. Memoised. */
export const getCurrentStaff = cache(async (): Promise<StaffRow | null> => {
  const user = await getAuthUser();
  if (!user) return null;
  return getStaffRow(user.id);
});

/** True when the caller is a super admin. Memoised. */
export const isSuperAdmin = cache(async (authUserId: string): Promise<boolean> => {
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("super_admins")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  return !!data;
});
