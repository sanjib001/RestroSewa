"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { revalidateRestaurantInfo } from "@/lib/restaurant-info";
import { subscriptionDaysRemaining } from "@/lib/subscription";

// The (superadmin) layout guards page RENDERING. A server action is a POST
// endpoint in its own right — reachable without ever loading that layout — so
// every action that reads or writes another restaurant's data checks for itself.
export type ActionResult = { error: string } | { redirectTo: string } | null;

export type RestaurantRow = {
  id: string;
  name: string;
  slug: string;
  type: string;
  is_active: boolean;
  subscription_tier: string;
  max_tables: number | null;
  max_rooms: number | null;
  created_at: string;
  logo_url: string | null;
  pan_vat_number: string | null;
  address: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  customer_ordering_enabled: boolean;
  qr_mode: string;
  install_date: string | null;
  subscription_extra_days: number;
};

export type RestaurantDetail = RestaurantRow & { settings: Record<string, unknown> };

export type StaffRow = {
  id: string;
  display_name: string;
  title: string;
  role: string;
  is_active: boolean;
  auth_user_id: string | null;
  created_at: string;
  permissions: string[];
};

export async function getAllRestaurants(): Promise<RestaurantRow[]> {
  await requireSuperAdmin();

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("restaurants")
    .select("id, name, slug, type, is_active, subscription_tier, max_tables, max_rooms, logo_url, pan_vat_number, address, contact_phone, contact_email, customer_ordering_enabled, qr_mode, install_date, subscription_extra_days, created_at")
    .order("created_at", { ascending: false });

  return (data as RestaurantRow[]) ?? [];
}

export async function getRestaurantWithStaff(
  id: string
): Promise<{ restaurant: RestaurantDetail; staff: StaffRow[] } | null> {
  await requireSuperAdmin();

  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: restaurant, error } = await (service as any)
    .from("restaurants")
    .select("id, name, slug, type, is_active, subscription_tier, max_tables, max_rooms, logo_url, pan_vat_number, address, contact_phone, contact_email, customer_ordering_enabled, qr_mode, install_date, subscription_extra_days, settings, created_at")
    .eq("id", id)
    .maybeSingle();

  // ⚠️ A FAILED LOOKUP IS NOT AN ABSENT RESTAURANT, and conflating the two is why a
  // 404 here used to be undiagnosable. `error` was discarded, so a dropped
  // connection, an expired service-role key, a column this select names that the
  // database doesn't have yet (a migration not applied to THIS environment), or a
  // PostgREST schema cache that hadn't picked a new column up all produced
  // `data: null` — identical to "no such row" — and the page rendered `notFound()`.
  // The operator then sees a plain 404 for a restaurant they are looking straight at
  // in the dashboard, with nothing in any log to say why.
  //
  // Throw instead. A 500 with a message is worth far more than a tidy 404 that lies,
  // and the caller's `notFound()` now means only what it says.
  if (error) {
    throw new Error(
      `getRestaurantWithStaff(${id}): restaurant lookup failed — ` +
        `${error.code ?? "?"} ${error.message ?? error}`
    );
  }

  if (!restaurant) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: staff, error: staffError } = await (service as any)
    .from("restaurant_users")
    .select("id, display_name, title, role, is_active, auth_user_id, created_at, permissions")
    .eq("restaurant_id", id)
    .order("role")
    .order("display_name");

  // Same reasoning, different blast radius: `?? []` turned a failed staff query into
  // a restaurant that appears to have NO STAFF. That is worse than an error page —
  // it invites an admin to "re-add" people who already exist.
  if (staffError) {
    throw new Error(
      `getRestaurantWithStaff(${id}): staff lookup failed — ` +
        `${staffError.code ?? "?"} ${staffError.message ?? staffError}`
    );
  }

  return {
    restaurant: restaurant as RestaurantDetail,
    staff: (staff as StaffRow[]) ?? [],
  };
}

export async function createRestaurant(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  await requireSuperAdmin();

  const name = (formData.get("name") as string)?.trim();
  const slug = (formData.get("slug") as string)?.trim();
  const type = formData.get("type") as string;
  const tier = formData.get("subscription_tier") as string;
  const maxTablesRaw = formData.get("max_tables") as string | null;
  const maxRoomsRaw = formData.get("max_rooms") as string | null;

  if (!name || !slug) return { error: "Name and slug are required." };
  if (!/^[a-z0-9-]+$/.test(slug))
    return { error: "Slug may only contain lowercase letters, numbers and hyphens." };

  const validTypes = ["restaurant", "hotel", "restaurant_hotel"];
  if (!validTypes.includes(type)) return { error: "Invalid business type." };

  const needsTables = type === "restaurant" || type === "restaurant_hotel";
  const needsRooms = type === "hotel" || type === "restaurant_hotel";

  const maxTables = maxTablesRaw ? parseInt(maxTablesRaw, 10) : null;
  const maxRooms = maxRoomsRaw ? parseInt(maxRoomsRaw, 10) : null;

  if (needsTables && (!maxTables || maxTables < 1))
    return { error: "Maximum tables must be at least 1." };
  if (needsRooms && (!maxRooms || maxRooms < 1))
    return { error: "Maximum rooms must be at least 1." };

  const orderingEnabled = formData.get("customer_ordering_enabled") === "true";
  const qrMode = (formData.get("qr_mode") as string) || "ordering_enabled";
  const validQrModes = ["ordering_enabled", "ordering_no_pin", "view_only"];
  if (!validQrModes.includes(qrMode)) return { error: "Invalid ordering mode." };

  // Defaults the subscription clock to today rather than leaving it null — a
  // superadmin who forgets to touch it still gets a real countdown, and can
  // correct the date later if the actual install happened on a different day.
  const today = new Date();
  const installDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (service as any)
    .from("restaurants")
    .insert({
      name,
      slug,
      type,
      subscription_tier: tier || "free",
      max_tables: needsTables ? maxTables : null,
      max_rooms: needsRooms ? maxRooms : null,
      customer_ordering_enabled: orderingEnabled,
      qr_mode: qrMode,
      install_date: installDate,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505")
      return { error: "That slug is already taken — choose a different one." };
    return { error: error.message };
  }

  return { redirectTo: `/superadmin/restaurants/${data.id}` };
}

export async function toggleRestaurantStatus(id: string, makeActive: boolean) {
  await requireSuperAdmin();

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any)
    .from("restaurants")
    .update({ is_active: makeActive })
    .eq("id", id);

  revalidateRestaurantInfo(id);
  revalidatePath(`/superadmin/restaurants/${id}`);
  revalidatePath("/superadmin/dashboard");
}

export async function updateRestaurant(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  await requireSuperAdmin();

  const id = formData.get("id") as string;
  if (!id) return { error: "Invalid request." };

  const name = (formData.get("name") as string)?.trim();
  if (!name) return { error: "Business name is required." };

  const tier = formData.get("subscription_tier") as string;
  const maxTablesRaw = formData.get("max_tables") as string | null;
  const maxRoomsRaw = formData.get("max_rooms") as string | null;
  const logoUrl = (formData.get("logo_url") as string)?.trim() || null;
  const panVat = (formData.get("pan_vat_number") as string)?.trim() || null;
  const address = (formData.get("address") as string)?.trim() || null;
  const contactPhone = (formData.get("contact_phone") as string)?.trim() || null;
  const contactEmail = (formData.get("contact_email") as string)?.trim() || null;
  const orderingEnabled = formData.get("customer_ordering_enabled") === "true";
  const qrMode = formData.get("qr_mode") as string || "ordering_enabled";
  const isActive = formData.get("is_active") === "true";
  const installDate = (formData.get("install_date") as string)?.trim() || null;
  const extraDaysRaw = (formData.get("subscription_extra_days") as string) ?? "";
  const extraDays = extraDaysRaw === "" ? 0 : parseInt(extraDaysRaw, 10);

  const validTiers = ["free", "basic", "pro"];
  if (!validTiers.includes(tier)) return { error: "Invalid subscription tier." };

  const validQrModes = ["ordering_enabled", "ordering_no_pin", "view_only"];
  if (!validQrModes.includes(qrMode)) return { error: "Invalid QR mode." };

  if (installDate && isNaN(new Date(installDate).getTime()))
    return { error: "Invalid install date." };
  if (isNaN(extraDays) || extraDays < 0 || extraDays > 3650)
    return { error: "Additional days must be between 0 and 3650." };

  const maxTables = maxTablesRaw ? parseInt(maxTablesRaw, 10) : null;
  const maxRooms = maxRoomsRaw ? parseInt(maxRoomsRaw, 10) : null;

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("restaurants")
    .update({
      name,
      logo_url: logoUrl,
      pan_vat_number: panVat,
      address,
      contact_phone: contactPhone,
      contact_email: contactEmail,
      subscription_tier: tier,
      max_tables: maxTables,
      max_rooms: maxRooms,
      customer_ordering_enabled: orderingEnabled,
      qr_mode: qrMode,
      is_active: isActive,
      install_date: installDate,
      subscription_extra_days: extraDays,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  // Name, PAN, address, logo and qr_mode are all in the cached config, and qr_mode decides
  // whether a newly opened table mints a customer PIN — so it must take effect at once.
  revalidateRestaurantInfo(id);
  revalidatePath(`/superadmin/restaurants/${id}`);
  revalidatePath("/superadmin/dashboard");
  return null;
}

/**
 * The Settings-page "Subscription" card's own save path — separate from
 * `updateRestaurant` because that form already has its own explicit
 * Active/Inactive control (`edit-restaurant-form.tsx`'s radio pair) that a
 * superadmin may deliberately set for reasons unrelated to the subscription
 * clock. This one has no such field to conflict with, so it's free to
 * reactivate a restaurant itself the moment the new dates put it back in
 * credit — "renew the subscription" should not need a second, separate click.
 */
export async function updateSubscriptionDates(
  restaurantId: string,
  installDate: string,
  extraDays: number
): Promise<ActionResult> {
  await requireSuperAdmin();

  if (!restaurantId) return { error: "Invalid request." };
  if (!installDate || isNaN(new Date(installDate).getTime()))
    return { error: "Choose a valid install date." };
  if (!Number.isFinite(extraDays) || extraDays < 0 || extraDays > 3650)
    return { error: "Additional days must be between 0 and 3650." };

  const remaining = subscriptionDaysRemaining(installDate, extraDays);

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: any = { install_date: installDate, subscription_extra_days: extraDays };
  // Only ever turns a restaurant ON here — never off. Taking one offline stays
  // the dedicated Activate/Deactivate toggle's job (`toggleRestaurantStatus`),
  // so this can't be used to silently deactivate anything.
  if (remaining !== null && remaining > 0) update.is_active = true;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("restaurants")
    .update(update)
    .eq("id", restaurantId);

  if (error) return { error: error.message };

  revalidateRestaurantInfo(restaurantId);
  revalidatePath(`/superadmin/restaurants/${restaurantId}`);
  revalidatePath("/superadmin/settings");
  revalidatePath("/superadmin/dashboard");
  return null;
}
