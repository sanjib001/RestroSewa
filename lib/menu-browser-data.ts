import "server-only";
import { getMenuCategories, getMenuItemsByCategory, getAvailableVariants } from "@/app/actions/menu";
import type { CategoryRow, MenuItemRow, VariantRow } from "@/app/actions/menu";
import { getWorkstations } from "@/app/actions/workstations";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import type { RestaurantUserContext } from "@/lib/auth/guards";

export type AddItemsMenuData = {
  categories: CategoryRow[];
  items: MenuItemRow[];
  variants: VariantRow[];
  canAddCustom: boolean;
  workstations: { id: string; name: string }[];
};

/**
 * Everything `MenuBrowser` needs to render, in one call. Factored out of
 * `session/[id]/add/page.tsx` (the standalone mobile route) so the
 * desktop/tablet split-view (`session/[id]/page.tsx`) can fetch the identical
 * data without copying the fetch-and-filter logic a second time — the two
 * surfaces must always see the same menu, never two independently-assembled
 * versions of it.
 */
export async function getAddItemsMenuData(
  restaurantUser: Pick<RestaurantUserContext, "restaurant_id" | "role" | "permissions">
): Promise<AddItemsMenuData> {
  const { restaurant_id } = restaurantUser;

  const categories = await getMenuCategories(restaurant_id);
  const activeCategories = categories.filter((c) => c.is_active);

  const itemsByCategory = await Promise.all(
    activeCategories.map((c) => getMenuItemsByCategory(restaurant_id, c.id))
  );
  const items: MenuItemRow[] = itemsByCategory.flat().filter((i) => i.availability_status === "available");

  // Variants for the whole menu in one query — a staff member taking an order
  // needs to pick the size at the counter, same as a guest does on their phone.
  const variants = await getAvailableVariants(restaurant_id);

  // Custom (off-menu) items are gated by their own permission and can be routed to a
  // workstation. Fetch the stations for the picker only when the user may add them.
  const canAddCustom = hasPermission(restaurantUser, PERMISSIONS.MANAGE_CUSTOM_ITEMS);
  const workstations = canAddCustom
    ? (await getWorkstations(restaurant_id)).map((w) => ({ id: w.id, name: w.name }))
    : [];

  return { categories: activeCategories, items, variants, canAddCustom, workstations };
}
