"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";

export type ActionResult = { error: string } | null;

export type TableGroupRow = { id: string; name: string; sort_order: number };
export type TableRow = {
  id: string;
  number: string;
  group_id: string | null;
  qr_token: string;
  is_active: boolean;
};

export type GroupWithTables = TableGroupRow & { tables: TableRow[] };

export async function getTablesWithGroups(
  restaurantId: string
): Promise<{ ungrouped: TableRow[]; groups: GroupWithTables[] }> {
  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: groups } = await (service as any)
    .from("table_groups")
    .select("id, name, sort_order")
    .eq("restaurant_id", restaurantId)
    .order("sort_order")
    .order("name");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tables } = await (service as any)
    .from("restaurant_tables")
    .select("id, number, group_id, qr_token, is_active")
    .eq("restaurant_id", restaurantId)
    .order("number");

  const allTables: TableRow[] = (tables as TableRow[]) ?? [];
  const allGroups = (groups as TableGroupRow[]) ?? [];

  const ungrouped = allTables.filter((t) => !t.group_id);
  const grouped: GroupWithTables[] = allGroups.map((g) => ({
    ...g,
    tables: allTables.filter((t) => t.group_id === g.id),
  }));

  return { ungrouped, groups: grouped };
}

export async function createTableGroup(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_TABLES)) return { error: "Permission denied." };

  const restaurantId = formData.get("restaurant_id") as string;
  if (restaurantId !== ru.restaurant_id) return { error: "Permission denied." };
  const name = (formData.get("name") as string)?.trim();
  if (!name) return { error: "Name is required." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("table_groups")
    .insert({ restaurant_id: restaurantId, name });

  if (error) return { error: error.message };
  revalidatePath("/admin/tables");
  return null;
}

export async function deleteTableGroup(groupId: string): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_TABLES)) return { error: "Permission denied." };

  const service = createServiceClient();

  // Ownership check
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: group } = await (service as any)
    .from("table_groups")
    .select("id, name")
    .eq("id", groupId)
    .eq("restaurant_id", ru.restaurant_id)
    .maybeSingle();
  if (!group) return { error: "Table group not found." };

  // Block deletion while tables still belong to the group. The FK is ON DELETE SET NULL,
  // so deleting now would silently orphan those tables (staff would stop receiving their
  // orders). Require the admin to reassign or remove them first.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: tableCount } = await (service as any)
    .from("restaurant_tables")
    .select("id", { count: "exact", head: true })
    .eq("group_id", groupId);
  if ((tableCount ?? 0) > 0) {
    return {
      error: `This group still has ${tableCount} table${tableCount === 1 ? "" : "s"}. Move ${tableCount === 1 ? "it" : "them"} to another group or delete ${tableCount === 1 ? "it" : "them"} first.`,
    };
  }

  // Block deletion while staff are assigned to the group. The FK is ON DELETE CASCADE,
  // so deleting now would silently drop those staff assignments.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: staffCount } = await (service as any)
    .from("restaurant_user_table_groups")
    .select("restaurant_user_id", { count: "exact", head: true })
    .eq("table_group_id", groupId);
  if ((staffCount ?? 0) > 0) {
    return {
      error: `This group is assigned to ${staffCount} staff member${staffCount === 1 ? "" : "s"}. Unassign ${staffCount === 1 ? "them" : "everyone"} from this group first.`,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("table_groups")
    .delete()
    .eq("id", groupId)
    .eq("restaurant_id", ru.restaurant_id);
  if (error) return { error: error.message };

  revalidatePath("/admin/tables");
  return null;
}

export async function createTable(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_TABLES)) return { error: "Permission denied." };

  const restaurantId = formData.get("restaurant_id") as string;
  if (restaurantId !== ru.restaurant_id) return { error: "Permission denied." };
  const number = (formData.get("number") as string)?.trim();
  const groupId = (formData.get("group_id") as string) || null;

  if (!number) return { error: "Table number/name is required." };
  // Every table must belong to a table group — staff assignment is group-based.
  if (!groupId) return { error: "Select a table group. Create one first if none exist." };

  const service = createServiceClient();

  // Confirm the group belongs to this restaurant
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: group } = await (service as any)
    .from("table_groups")
    .select("id")
    .eq("id", groupId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (!group) return { error: "Invalid table group." };

  // Enforce max_tables resource limit
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: restaurant } = await (service as any)
    .from("restaurants")
    .select("max_tables")
    .eq("id", restaurantId)
    .maybeSingle();

  if (restaurant?.max_tables != null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await (service as any)
      .from("restaurant_tables")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId);
    if ((count ?? 0) >= restaurant.max_tables) {
      return { error: `Table limit reached — subscription allows ${restaurant.max_tables} tables.` };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("restaurant_tables")
    .insert({ restaurant_id: restaurantId, number, group_id: groupId || null });

  if (error) {
    if (error.code === "23505") return { error: "A table with that number already exists." };
    return { error: error.message };
  }
  revalidatePath("/admin/tables");
  return null;
}

export async function updateTable(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_TABLES)) return { error: "Permission denied." };

  const id = formData.get("id") as string;
  const number = (formData.get("number") as string)?.trim();
  const groupId = (formData.get("group_id") as string) || null;

  if (!number) return { error: "Table number/name is required." };
  // Every table must belong to a table group — staff assignment is group-based.
  if (!groupId) return { error: "Select a table group." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (service as any)
    .from("restaurant_tables")
    .select("restaurant_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing || existing.restaurant_id !== ru.restaurant_id)
    return { error: "Permission denied." };

  // Confirm the group belongs to this restaurant
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: group } = await (service as any)
    .from("table_groups")
    .select("id")
    .eq("id", groupId)
    .eq("restaurant_id", ru.restaurant_id)
    .maybeSingle();
  if (!group) return { error: "Invalid table group." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("restaurant_tables")
    .update({ number, group_id: groupId || null })
    .eq("id", id);

  if (error) {
    if (error.code === "23505") return { error: "A table with that number already exists." };
    return { error: error.message };
  }
  revalidatePath("/admin/tables");
  return null;
}

export async function toggleTableStatus(id: string, isActive: boolean) {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_TABLES)) return;
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any)
    .from("restaurant_tables")
    .update({ is_active: isActive })
    .eq("id", id);
  revalidatePath("/admin/tables");
}

export async function deleteTable(id: string): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_TABLES)) return { error: "Permission denied." };
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("restaurant_tables")
    .delete()
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/tables");
  return null;
}

export async function regenerateTableQr(tableId: string): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_TABLES)) return { error: "Permission denied." };
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (service as any)
    .from("restaurant_tables")
    .select("restaurant_id")
    .eq("id", tableId)
    .maybeSingle();
  if (!existing || existing.restaurant_id !== ru.restaurant_id)
    return { error: "Permission denied." };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("restaurant_tables")
    .update({ qr_token: crypto.randomUUID() })
    .eq("id", tableId);
  if (error) return { error: error.message };
  revalidatePath("/admin/tables");
  return null;
}

export async function setTableGroupWaiters(
  groupId: string,
  userIds: string[]
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_TABLES)) return { error: "Permission denied." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (service as any)
    .from("table_groups")
    .select("restaurant_id")
    .eq("id", groupId)
    .maybeSingle();
  if (!existing || existing.restaurant_id !== ru.restaurant_id)
    return { error: "Permission denied." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any)
    .from("restaurant_user_table_groups")
    .delete()
    .eq("table_group_id", groupId);

  if (userIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (service as any)
      .from("restaurant_user_table_groups")
      .insert(userIds.map((uid) => ({ restaurant_user_id: uid, table_group_id: groupId })));
    if (error) return { error: "Failed to save assignments." };
  }

  revalidatePath("/admin/tables");
  return null;
}

export async function getRestaurantSlug(restaurantId: string): Promise<string | null> {
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("restaurants")
    .select("slug")
    .eq("id", restaurantId)
    .maybeSingle();
  return (data as { slug: string } | null)?.slug ?? null;
}
