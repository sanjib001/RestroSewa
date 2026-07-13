import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import {
  getMenuCategories,
  getMenuItemsByCategory,
  getAvailableVariants,
} from "@/app/actions/menu";
import { createServiceClient } from "@/lib/supabase/service";
import type { MenuItemRow } from "@/app/actions/menu";
import { MenuBrowser } from "./_components/menu-browser";
import { ChevronLeft } from "lucide-react";

export default async function AddItemsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: sessionId } = await params;
  const { restaurantUser } = await requireRestaurantStaff();

  if (!hasPermission(restaurantUser, PERMISSIONS.CREATE_ORDERS)) {
    redirect(`/employee/session/${sessionId}`);
  }
  const { restaurant_id } = restaurantUser;

  // Verify session belongs to this restaurant
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session } = await (service as any)
    .from("sessions")
    .select("id, status")
    .eq("id", sessionId)
    .eq("restaurant_id", restaurant_id)
    .maybeSingle();

  if (!session || session.status !== "active") notFound();

  const categories = await getMenuCategories(restaurant_id);
  const activeCategories = categories.filter((c) => c.is_active);

  const itemsByCategory = await Promise.all(
    activeCategories.map((c) => getMenuItemsByCategory(restaurant_id, c.id))
  );
  const allItems: MenuItemRow[] = itemsByCategory.flat().filter((i) => i.availability_status === "available");

  // Variants for the whole menu in one query — a staff member taking an order
  // needs to pick the size at the counter, same as a guest does on their phone.
  const variants = await getAvailableVariants(restaurant_id);

  return (
    <div className="flex flex-col h-[calc(100vh-56px)]">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 border-b shrink-0"
        style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
      >
        <Link
          href={`/employee/session/${sessionId}`}
          className="flex items-center gap-1 text-sm"
          style={{ color: "var(--color-ink-mute)" }}
        >
          <ChevronLeft size={14} />
          Back
        </Link>
        <span
          className="text-sm font-medium"
          style={{ color: "var(--color-ink)" }}
        >
          Add items
        </span>
      </div>

      <MenuBrowser
        sessionId={sessionId}
        categories={activeCategories}
        items={allItems}
        variants={variants}
      />
    </div>
  );
}
