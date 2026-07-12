"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";

export type ActionResult = { error: string } | null;

// ─── Types ────────────────────────────────────────────────────────────────────

export type CategoryRow = {
  id: string;
  name: string;
  description: string | null;
  workstation_id: string;
  workstation_name: string | null;
  is_active: boolean;
  sort_order: number;
  item_count: number;
};

export type FoodType = "veg" | "non_veg" | "vegan" | "egg";
export type AvailabilityStatus = "available" | "out_of_stock" | "hidden";

export type MenuItemRow = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  food_type: FoodType;
  availability_status: AvailabilityStatus;
  is_available: boolean;
  has_variants: boolean;
  category_id: string;
  workstation_id: string;
  sort_order: number;
  preparation_time: number | null;
  tax_percent: number;
  sku: string | null;
  is_featured: boolean;
  badges: string[];
  time_from: string | null;
  time_until: string | null;
  date_from: string | null;
  date_until: string | null;
  available_days: number[];
  room_service_available: boolean;
  is_deleted: boolean;
};

export type VariantRow = {
  id: string;
  menu_item_id: string;
  name: string;
  price: number;
  is_available: boolean;
  sort_order: number;
};

export type AddonRow = {
  id: string;
  menu_item_id: string;
  name: string;
  price: number;
  is_required: boolean;
  is_available: boolean;
  sort_order: number;
};

const ITEM_COLUMNS = `
  id, name, description, price,
  food_type, availability_status, is_available, has_variants,
  category_id, workstation_id, sort_order,
  preparation_time, tax_percent, sku,
  is_featured, badges, time_from, time_until,
  date_from, date_until, available_days,
  room_service_available, is_deleted
`.trim();

function normalizeItem(raw: Record<string, unknown>): MenuItemRow {
  return {
    id: raw.id as string,
    name: raw.name as string,
    description: (raw.description as string) ?? null,
    price: Number(raw.price),
    food_type: (raw.food_type as FoodType) ?? "veg",
    availability_status: (raw.availability_status as AvailabilityStatus) ?? "available",
    is_available: Boolean(raw.is_available),
    has_variants: Boolean(raw.has_variants),
    category_id: raw.category_id as string,
    workstation_id: raw.workstation_id as string,
    sort_order: Number(raw.sort_order ?? 0),
    preparation_time: raw.preparation_time != null ? Number(raw.preparation_time) : null,
    tax_percent: Number(raw.tax_percent ?? 0),
    sku: (raw.sku as string) ?? null,
    is_featured: Boolean(raw.is_featured),
    badges: Array.isArray(raw.badges) ? (raw.badges as string[]) : [],
    time_from: (raw.time_from as string) ?? null,
    time_until: (raw.time_until as string) ?? null,
    date_from: (raw.date_from as string) ?? null,
    date_until: (raw.date_until as string) ?? null,
    available_days: Array.isArray(raw.available_days)
      ? (raw.available_days as number[])
      : [0, 1, 2, 3, 4, 5, 6],
    room_service_available: Boolean(raw.room_service_available),
    is_deleted: Boolean(raw.is_deleted),
  };
}

// ─── Categories ───────────────────────────────────────────────────────────────

export async function getMenuCategories(restaurantId: string): Promise<CategoryRow[]> {
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("menu_categories")
    .select(`id, name, description, is_active, sort_order, workstation_id, workstations ( name ), menu_items ( id )`)
    .eq("restaurant_id", restaurantId)
    .order("sort_order")
    // Tiebreak on creation order, NOT name. A `name` tiebreak is what turned the
    // whole menu alphabetical while every sort_order sat at 0 — with this, even a
    // genuine tie falls back to the order the admin created them in.
    .order("created_at");

  if (!data) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.map((c: any) => ({
    id: c.id,
    name: c.name,
    description: c.description ?? null,
    workstation_id: c.workstation_id,
    workstation_name: c.workstations?.name ?? null,
    is_active: c.is_active,
    sort_order: c.sort_order,
    item_count: c.menu_items?.length ?? 0,
  }));
}

export async function createCategory(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_MENU)) return { error: "Permission denied." };

  const restaurantId = formData.get("restaurant_id") as string;
  if (restaurantId !== ru.restaurant_id) return { error: "Permission denied." };

  const name = (formData.get("name") as string)?.trim();
  const workstationId = formData.get("workstation_id") as string;

  if (!name || !workstationId) return { error: "Name and workstation are required." };

  const service = createServiceClient();

  // Append to the END of the admin's order. Leaving `sort_order` at its default
  // of 0 is what silently made every menu alphabetical (migration 20260712400000).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: last } = await (service as any)
    .from("menu_categories")
    .select("sort_order")
    .eq("restaurant_id", restaurantId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sortOrder = Number(last?.sort_order ?? 0) + 1;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("menu_categories")
    .insert({ restaurant_id: restaurantId, name, workstation_id: workstationId, sort_order: sortOrder });

  if (error) return { error: error.message };
  revalidatePath("/admin/menu");
  revalidatePath("/employee/menu");
  return null;
}

/**
 * Move a category one place up or down in the admin's order.
 *
 * The swap happens in a single DB transaction (`swap_category_order`), so a
 * reorder can never leave two categories sharing a position — and the customer
 * menu, which reads the same `sort_order`, reflects it on the next load.
 */
export async function moveCategory(
  id: string,
  direction: "up" | "down"
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_MENU)) return { error: "Permission denied." };

  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: me } = await (service as any)
    .from("menu_categories")
    .select("id, sort_order")
    .eq("id", id)
    .eq("restaurant_id", ru.restaurant_id)
    .maybeSingle();

  if (!me) return { error: "Category not found." };

  // The neighbour is the nearest category on that side — not `sort_order ± 1`,
  // which would break the moment positions aren't perfectly contiguous.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: neighbour } = await (service as any)
    .from("menu_categories")
    .select("id")
    .eq("restaurant_id", ru.restaurant_id)
    .filter("sort_order", direction === "up" ? "lt" : "gt", me.sort_order)
    .order("sort_order", { ascending: direction !== "up" })
    .limit(1)
    .maybeSingle();

  // Already first / last — a no-op, not an error.
  if (!neighbour) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("swap_category_order", {
    p_restaurant_id: ru.restaurant_id,
    p_a: me.id,
    p_b: neighbour.id,
  });

  if (error) return { error: "Could not reorder the category." };

  revalidatePath("/admin/menu");
  revalidatePath("/employee/menu");
  return null;
}

export async function updateCategory(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_MENU)) return { error: "Permission denied." };

  const id = formData.get("id") as string;
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;
  const workstationId = formData.get("workstation_id") as string;

  if (!name || !workstationId) return { error: "Name and workstation are required." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (service as any)
    .from("menu_categories")
    .select("restaurant_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing || existing.restaurant_id !== ru.restaurant_id)
    return { error: "Permission denied." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("menu_categories")
    .update({ name, description, workstation_id: workstationId })
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/admin/menu");
  revalidatePath("/employee/menu");
  return null;
}

export async function toggleCategoryStatus(id: string, isActive: boolean) {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_MENU)) return;
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any).from("menu_categories").update({ is_active: isActive }).eq("id", id);
  revalidatePath("/admin/menu");
  revalidatePath("/employee/menu");
}

export async function deleteCategory(id: string): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_MENU)) return { error: "Permission denied." };
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).from("menu_categories").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") return { error: "Remove all items in this category first." };
    return { error: error.message };
  }
  revalidatePath("/admin/menu");
  revalidatePath("/employee/menu");
  return null;
}

// ─── Menu Items ───────────────────────────────────────────────────────────────

export async function getMenuItemsByCategory(
  restaurantId: string,
  categoryId: string
): Promise<MenuItemRow[]> {
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("menu_items")
    .select(ITEM_COLUMNS)
    .eq("restaurant_id", restaurantId)
    .eq("category_id", categoryId)
    .eq("is_deleted", false)
    .order("sort_order")
    .order("name");

  if (!data) return [];
  return (data as Record<string, unknown>[]).map(normalizeItem);
}

export async function createMenuItem(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_MENU)) return { error: "Permission denied." };

  const restaurantId = formData.get("restaurant_id") as string;
  if (restaurantId !== ru.restaurant_id) return { error: "Permission denied." };
  const categoryId   = formData.get("category_id") as string;
  const name         = (formData.get("name") as string)?.trim();
  const description  = (formData.get("description") as string)?.trim() || null;
  const price        = parseFloat(formData.get("price") as string);
  const foodType     = (formData.get("food_type") as string) || "veg";

  if (!name || !categoryId) return { error: "Name and category are required." };
  if (isNaN(price) || price < 0) return { error: "Price must be a non-negative number." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: cat } = await (service as any)
    .from("menu_categories")
    .select("workstation_id")
    .eq("id", categoryId)
    .single();

  if (!cat) return { error: "Category not found." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).from("menu_items").insert({
    restaurant_id: restaurantId,
    category_id: categoryId,
    workstation_id: cat.workstation_id,
    name,
    description,
    price,
    food_type: foodType,
    availability_status: "available",
  });

  if (error) return { error: error.message };
  revalidatePath("/admin/menu");
  revalidatePath("/employee/menu");
  return null;
}

export async function updateMenuItem(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_MENU)) return { error: "Permission denied." };

  const id = formData.get("id") as string;
  if (!id) return { error: "Invalid item." };

  const name         = (formData.get("name") as string)?.trim();
  const description  = (formData.get("description") as string)?.trim() || null;
  const price        = parseFloat(formData.get("price") as string);
  const foodType     = formData.get("food_type") as string;
  const status       = formData.get("availability_status") as string;
  const prepTime     = formData.get("preparation_time") as string;
  const taxPct       = formData.get("tax_percent") as string;
  const sku          = (formData.get("sku") as string)?.trim() || null;
  const isFeatured   = formData.get("is_featured") === "true";
  const roomService  = formData.get("room_service_available") === "true";

  // Array fields sent as JSON
  let badges: string[] = [];
  let availableDays: number[] = [0, 1, 2, 3, 4, 5, 6];
  try { badges = JSON.parse((formData.get("badges") as string) || "[]"); } catch { /* keep default */ }
  try { availableDays = JSON.parse((formData.get("available_days") as string) || "[0,1,2,3,4,5,6]"); } catch { /* keep default */ }

  const timeFrom  = (formData.get("time_from") as string)?.trim() || null;
  const timeUntil = (formData.get("time_until") as string)?.trim() || null;
  const dateFrom  = (formData.get("date_from") as string)?.trim() || null;
  const dateUntil = (formData.get("date_until") as string)?.trim() || null;

  if (!name) return { error: "Name is required." };
  if (isNaN(price) || price < 0) return { error: "Price must be non-negative." };

  const validFoodTypes = ["veg", "non_veg", "vegan", "egg"];
  if (!validFoodTypes.includes(foodType)) return { error: "Invalid food type." };

  const validStatuses = ["available", "out_of_stock", "hidden"];
  if (!validStatuses.includes(status)) return { error: "Invalid availability status." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).from("menu_items").update({
    name,
    description,
    price,
    food_type: foodType,
    availability_status: status,
    is_available: status === "available",
    preparation_time: prepTime ? parseInt(prepTime, 10) : null,
    tax_percent: taxPct ? parseFloat(taxPct) : 0,
    sku,
    is_featured: isFeatured,
    badges,
    time_from: timeFrom || null,
    time_until: timeUntil || null,
    date_from: dateFrom || null,
    date_until: dateUntil || null,
    available_days: availableDays,
    room_service_available: roomService,
  }).eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/admin/menu");
  revalidatePath("/employee/menu");
  return null;
}

export async function softDeleteMenuItem(id: string): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_MENU)) return { error: "Permission denied." };
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("menu_items")
    .update({ is_deleted: true, availability_status: "hidden", is_available: false })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/menu");
  revalidatePath("/employee/menu");
  return null;
}

export async function toggleItemAvailability(id: string, isAvailable: boolean) {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_MENU)) return;
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any).from("menu_items").update({
    is_available: isAvailable,
    availability_status: isAvailable ? "available" : "out_of_stock",
  }).eq("id", id);
  revalidatePath("/admin/menu");
  revalidatePath("/employee/menu");
}

// ─── Variants ─────────────────────────────────────────────────────────────────

export async function getItemVariantsAndAddons(itemId: string): Promise<{
  variants: VariantRow[];
  addons: AddonRow[];
}> {
  const service = createServiceClient();
  const [vRes, aRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("menu_item_variants")
      .select("id, menu_item_id, name, price, is_available, sort_order")
      .eq("menu_item_id", itemId)
      .order("sort_order").order("name"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("menu_item_addons")
      .select("id, menu_item_id, name, price, is_required, is_available, sort_order")
      .eq("menu_item_id", itemId)
      .order("sort_order").order("name"),
  ]);
  return {
    variants: (vRes.data as VariantRow[]) ?? [],
    addons:   (aRes.data as AddonRow[]) ?? [],
  };
}

export async function createVariant(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_MENU)) return { error: "Permission denied." };

  const menuItemId   = formData.get("menu_item_id") as string;
  const restaurantId = formData.get("restaurant_id") as string;
  const name         = (formData.get("name") as string)?.trim();
  const price        = parseFloat(formData.get("price") as string);

  if (!name || !menuItemId) return { error: "Name is required." };
  if (isNaN(price) || price < 0) return { error: "Price must be non-negative." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("menu_item_variants")
    .insert({ restaurant_id: restaurantId, menu_item_id: menuItemId, name, price });

  if (error) return { error: error.message };
  revalidatePath("/admin/menu");
  revalidatePath("/employee/menu");
  return null;
}

export async function deleteVariant(id: string): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_MENU)) return { error: "Permission denied." };
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).from("menu_item_variants").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/menu");
  revalidatePath("/employee/menu");
  return null;
}

// ─── Add-ons ──────────────────────────────────────────────────────────────────

export async function createAddon(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_MENU)) return { error: "Permission denied." };

  const menuItemId   = formData.get("menu_item_id") as string;
  const restaurantId = formData.get("restaurant_id") as string;
  const name         = (formData.get("name") as string)?.trim();
  const price        = parseFloat(formData.get("price") as string) || 0;
  const isRequired   = formData.get("is_required") === "true";

  if (!name || !menuItemId) return { error: "Name is required." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("menu_item_addons")
    .insert({ restaurant_id: restaurantId, menu_item_id: menuItemId, name, price, is_required: isRequired });

  if (error) return { error: error.message };
  revalidatePath("/admin/menu");
  revalidatePath("/employee/menu");
  return null;
}

export async function deleteAddon(id: string): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_MENU)) return { error: "Permission denied." };
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).from("menu_item_addons").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/menu");
  revalidatePath("/employee/menu");
  return null;
}
