import { requireRestaurantStaff } from "@/lib/auth/guards";
import { getStaffNav, NAV_ACCESS } from "@/lib/permissions";
import { getMyOrderQueue, getSalesReport } from "@/app/actions/pos";
import { getCredits, getCreditSummary } from "@/app/actions/credits";
import { getMenuCategories, getMenuItemsByCategory } from "@/app/actions/menu";
import type { MenuItemRow } from "@/app/actions/menu";
import { getWorkstations } from "@/app/actions/workstations";
import { SalesView } from "../sales/_components/sales-view";
import { CreditsView } from "../credits/_components/credits-view";
import { MenuClient } from "@/app/(admin)/admin/menu/_components/menu-client";
import { TablesSection } from "./_components/tables-section";
import { OrdersSection } from "./_components/orders-section";
import { StaffDashboard } from "./_components/staff-dashboard";
import type { DashboardSection } from "./_components/staff-dashboard";

// Single-page staff dashboard: every section the staff member has permission for
// is stacked vertically (Orders first). Section visibility is derived from the
// exact same permission-driven nav (`getStaffNav`) that used to gate the separate
// pages — the permission system is unchanged, only the layout is.
export default async function EmployeeDashboardPage({
  searchParams,
}: {
  // Closing a bill on credit lands back HERE with ?credit=<accountId> — the
  // dashboard scrolls to its Credits section and opens that customer's account,
  // instead of throwing the cashier out to a separate page.
  searchParams: Promise<{ credit?: string }>;
}) {
  const { restaurantUser } = await requireRestaurantStaff();
  const { credit: openCreditId } = await searchParams;

  const navKeys = new Set(getStaffNav(restaurantUser).map((n) => n.key));
  const sections: DashboardSection[] = [];

  // 1. Orders (most-used — always first). Self-managing card: compact when empty,
  // auto-expands when orders arrive.
  if (navKeys.has("orders")) {
    const orders = await getMyOrderQueue();
    sections.push({
      key: "orders",
      title: "Orders",
      bare: true,
      body: <OrdersSection initialOrders={orders} canManage={NAV_ACCESS.canManageOrders(restaurantUser)} />,
    });
  }

  // 2. Sales.
  if (navKeys.has("sales")) {
    const report = await getSalesReport({ period: "today" });
    sections.push({
      key: "sales",
      title: "Sales",
      subtitle: "Takings, breakdown & CSV export",
      body: <SalesView initial={report} embedded />,
    });
  }

  // 3. Credits — Cashier / Receptionist only (Billing + Close Bills), so it only
  // appears for the staff who actually collect the money.
  if (navKeys.has("credits")) {
    const [credits, summary] = await Promise.all([
      getCredits({ status: "all" }),
      getCreditSummary(),
    ]);
    sections.push({
      key: "credits",
      title: "Credits",
      subtitle: "Customer accounts & repayments",
      body: (
        <CreditsView
          initialCredits={credits}
          initialSummary={summary}
          initialOpenId={openCreditId ?? null}
          embedded
        />
      ),
    });
  }

  // 4. Tables & Rooms.
  if (navKeys.has("tables")) {
    sections.push({
      key: "tables",
      title: "Tables",
      subtitle: "Open, seat & manage tables and rooms",
      body: <TablesSection restaurantUser={restaurantUser} />,
    });
  }

  // 5. Menu.
  if (navKeys.has("menu")) {
    const [categories, workstations] = await Promise.all([
      getMenuCategories(restaurantUser.restaurant_id),
      getWorkstations(restaurantUser.restaurant_id),
    ]);
    const itemsByCategory = await Promise.all(
      categories.map((c) => getMenuItemsByCategory(restaurantUser.restaurant_id, c.id))
    );
    const allItems: MenuItemRow[] = itemsByCategory.flat();
    sections.push({
      key: "menu",
      title: "Menu",
      subtitle: "Manage categories and items",
      body: (
        <MenuClient
          categories={categories}
          items={allItems}
          workstations={workstations}
          restaurantId={restaurantUser.restaurant_id}
        />
      ),
    });
  }

  return (
    <StaffDashboard
      sections={sections}
      // Just billed to credit → land in the Credits section, not at the top.
      focus={openCreditId ? "credits" : null}
    />
  );
}
