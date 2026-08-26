import { requireRestaurantStaff } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/service";
import { STOCK_ACCESS } from "@/lib/permissions";
import { hasRooms, normalizeBusinessType } from "@/lib/business-type";
import { AdminSidebar } from "./admin/_components/admin-sidebar";
import { OfflineGate } from "@/components/pwa/offline-gate";
import { SubscriptionWatermark } from "@/components/subscription-watermark";
import { subscriptionDaysRemaining } from "@/lib/subscription";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Layout allows any active staff member — individual pages guard their own permissions.
  const { restaurantUser } = await requireRestaurantStaff();

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: restaurant, error } = await (service as any)
    .from("restaurants")
    .select("name, logo_url, type, install_date, subscription_extra_days")
    .eq("id", restaurantUser.restaurant_id)
    .single();

  // Every downstream default in this layout (name, logo, showRooms, the
  // watermark) silently swallowed a failed query as "restaurant just has no
  // name/logo set" — exactly how a migration lagging behind this layout's own
  // code (querying columns the database doesn't have yet) presented as a
  // missing logo and a missing watermark with nothing in any log to explain
  // it. Throw instead, same as `getAllRestaurants`.
  if (error) {
    throw new Error(
      `AdminLayout: restaurant lookup failed for ${restaurantUser.restaurant_id} — ` +
        `${error.code ?? "?"} ${error.message ?? error}`
    );
  }

  // Computed fresh every request — deliberately NOT the 60s-cached
  // `getRestaurantConfig()` (not called from this layout today), since a
  // countdown that says "today" should always mean today.
  const daysRemaining = subscriptionDaysRemaining(
    restaurant?.install_date ?? null,
    restaurant?.subscription_extra_days ?? 0
  );

  // A restaurant-only client has no hotel side, so the Rooms module is hidden
  // entirely (not just visually) — the link never renders and the page redirects.
  const showRooms = hasRooms(normalizeBusinessType(restaurant?.type));

  return (
    <div className="admin-surface flex min-h-screen" style={{ background: "var(--color-canvas-soft)" }}>
      <AdminSidebar
        restaurantName={restaurant?.name ?? "Restaurant"}
        restaurantLogo={restaurant?.logo_url ?? null}
        // Don't advertise links that would only bounce the user. Each lane is gated
        // on its own right: a storekeeper sees Stock; a purchaser sees Purchases; a
        // vendor manager sees Vendors; Finance needs view_finance. So a buyer with
        // only manage_purchases never sees a Stock or Vendors link that would redirect.
        showStock={STOCK_ACCESS.canViewStock(restaurantUser)}
        showPurchases={STOCK_ACCESS.canViewPurchases(restaurantUser)}
        showVendors={STOCK_ACCESS.canViewVendors(restaurantUser)}
        showExpenses={STOCK_ACCESS.canViewExpenses(restaurantUser)}
        showFinance={STOCK_ACCESS.canViewFinance(restaurantUser)}
        // Rooms only exist for a hotel / restaurant+hotel client.
        showRooms={showRooms}
        // Settings (billing) is owner-only; the page redirects non-admins anyway.
        showSettings={restaurantUser.role === "restaurant_admin"}
      />
      {/* Only this column scrolls — the sidebar is sticky and stays put.
          pt-12 offsets the fixed mobile top bar; md:pt-0 on desktop, where the
          sidebar replaces it. `min-w-0` keeps wide tables from stretching the row. */}
      <main className="flex-1 min-w-0 pt-12 md:pt-0">{children}</main>

      {/* The admin surface writes too — menu prices, stock, payroll — so it gets the
          same refusal-to-write-offline as the floor. */}
      <OfflineGate />
      <SubscriptionWatermark daysRemaining={daysRemaining} />
    </div>
  );
}
