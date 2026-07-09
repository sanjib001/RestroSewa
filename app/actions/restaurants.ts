"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

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
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("restaurants")
    .select("id, name, slug, type, is_active, subscription_tier, max_tables, max_rooms, logo_url, pan_vat_number, address, contact_phone, contact_email, customer_ordering_enabled, qr_mode, created_at")
    .order("created_at", { ascending: false });

  return (data as RestaurantRow[]) ?? [];
}

export async function getRestaurantWithStaff(
  id: string
): Promise<{ restaurant: RestaurantDetail; staff: StaffRow[] } | null> {
  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: restaurant } = await (service as any)
    .from("restaurants")
    .select("id, name, slug, type, is_active, subscription_tier, max_tables, max_rooms, logo_url, pan_vat_number, address, contact_phone, contact_email, customer_ordering_enabled, qr_mode, settings, created_at")
    .eq("id", id)
    .maybeSingle();

  if (!restaurant) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: staff } = await (service as any)
    .from("restaurant_users")
    .select("id, display_name, title, role, is_active, auth_user_id, created_at, permissions")
    .eq("restaurant_id", id)
    .order("role")
    .order("display_name");

  return {
    restaurant: restaurant as RestaurantDetail,
    staff: (staff as StaffRow[]) ?? [],
  };
}

export async function createRestaurant(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
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
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any)
    .from("restaurants")
    .update({ is_active: makeActive })
    .eq("id", id);

  revalidatePath(`/superadmin/restaurants/${id}`);
  revalidatePath("/superadmin/dashboard");
}

export async function updateRestaurant(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
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

  const validTiers = ["free", "basic", "pro"];
  if (!validTiers.includes(tier)) return { error: "Invalid subscription tier." };

  const validQrModes = ["ordering_enabled", "ordering_no_pin", "view_only"];
  if (!validQrModes.includes(qrMode)) return { error: "Invalid QR mode." };

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
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath(`/superadmin/restaurants/${id}`);
  revalidatePath("/superadmin/dashboard");
  return null;
}
