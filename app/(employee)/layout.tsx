import type { Viewport } from "next";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveNotifications } from "@/app/actions/notifications";
import { StaffNav } from "./employee/_components/staff-nav";
import { PullToRefresh } from "@/components/pwa/pull-to-refresh";
import { OfflineGate } from "@/components/pwa/offline-gate";
import { SubscriptionWatermark } from "@/components/subscription-watermark";
import { subscriptionDaysRemaining } from "@/lib/subscription";

// Overrides the root's light theme colour for the staff surface only.
//
// The staff header is brand-dark and pinned to the top, so a light status bar sits
// above it as a pale band that belongs to nothing. Matching the two means the app
// reads as one dark bar running to the top of the screen. Admin and customer screens
// keep the light default, which is right for them — they have light headers.
export const viewport: Viewport = {
  themeColor: "#1c1e54", // --color-brand-dark, the colour of StaffNav
};

export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const { restaurantUser } = await requireRestaurantStaff();

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: restaurant } = await (service as any)
    .from("restaurants")
    .select("name, logo_url, install_date, subscription_extra_days")
    .eq("id", restaurantUser.restaurant_id)
    .single();

  // Single unread badge on the (now minimal) top bar — every new alert the staff
  // member is permitted to see. Sections themselves live on the dashboard.
  const notifs = await getActiveNotifications(restaurantUser.restaurant_id, restaurantUser);
  const notificationCount = notifs.filter((n) => n.status === "new").length;

  // Computed fresh every request — deliberately NOT the 60s-cached
  // `getRestaurantConfig()` (not called from this layout today), since a
  // countdown that says "today" should always mean today.
  const daysRemaining = subscriptionDaysRemaining(
    restaurant?.install_date ?? null,
    restaurant?.subscription_extra_days ?? 0
  );

  return (
    <div className="min-h-screen" style={{ background: "var(--color-canvas-soft)" }}>
      <StaffNav
        restaurantName={restaurant?.name ?? "Restaurant"}
        restaurantLogo={restaurant?.logo_url ?? null}
        displayName={restaurantUser.display_name}
        notificationCount={notificationCount}
      />
      {/* Wraps only the staff surface. Pulling down refetches the current route's
          server components — the floor plan, the queue, the bill — through the same
          permission-checked path that rendered them, so it can never reveal
          anything a poll wouldn't. Admin screens are desktop work and don't get it. */}
      <PullToRefresh>
        <main className="scroll-pb-safe">{children}</main>
      </PullToRefresh>

      {/* Says when the connection is gone, and refuses every write while it is. A POS
          that silently ACCEPTS a payment which never reached the database is worse
          than one that plainly refuses — the first sends someone away believing the
          table is settled. */}
      <OfflineGate />
      <SubscriptionWatermark daysRemaining={daysRemaining} />
    </div>
  );
}
