import { Suspense } from "react";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import type { RestaurantUserContext } from "@/lib/auth/guards";
import { getStaffNav, hasAnyPermission, NAV_ACCESS, PERMISSIONS } from "@/lib/permissions";
import { getMyOrderQueue, getSalesReport } from "@/app/actions/pos";
import { getCredits, getCreditSummary } from "@/app/actions/credits";
import { getAllMenuItems, getMenuCategories } from "@/app/actions/menu";
import { getWorkstations } from "@/app/actions/workstations";
import { SalesView } from "../sales/_components/sales-view";
import { CreditsView } from "../credits/_components/credits-view";
import { MenuClient } from "@/app/(admin)/admin/menu/_components/menu-client";
import { TablesSection } from "./_components/tables-section";
import { RoomsSection } from "./_components/rooms-section";
import { OrdersSection } from "./_components/orders-section";
import { StaffDashboard, SectionSkeleton } from "./_components/staff-dashboard";
import type { DashboardSection } from "./_components/staff-dashboard";

// Single-page staff dashboard: every section the staff member has permission for
// is stacked vertically (Orders first). Section visibility is derived from the
// exact same permission-driven nav (`getStaffNav`) that used to gate the separate
// pages — the permission system is unchanged.
//
// ─── Why every section is its own async component behind <Suspense> ───────────
//
// This page used to `await` each section's data IN SERIES before returning a
// single pixel: the order queue, then the sales report, then the credit ledger,
// then the menu. A Cashier sees all of them, so a Cashier waited for the sum of
// all of them — while a Waiter, who sees two, wondered what everyone was
// complaining about. That is the whole shape of the reported bug.
//
// Each section now fetches inside its own boundary, so they run CONCURRENTLY and
// stream in as they land. The page shell paints straight away and the slowest
// query no longer holds the fastest one hostage. Nothing is dropped or deferred:
// every section still renders, with the same data, under the same permission.

async function OrdersBody({ ru }: { ru: RestaurantUserContext }) {
  const orders = await getMyOrderQueue();
  return <OrdersSection initialOrders={orders} canManage={NAV_ACCESS.canManageOrders(ru)} />;
}

async function SalesBody() {
  const report = await getSalesReport({ period: "today" });
  return <SalesView initial={report} embedded />;
}

async function CreditsBody({ openId }: { openId: string | null }) {
  const [credits, summary] = await Promise.all([getCredits({ status: "all" }), getCreditSummary()]);
  return (
    <CreditsView
      initialCredits={credits}
      initialSummary={summary}
      initialOpenId={openId}
      embedded
    />
  );
}

async function MenuBody({ ru }: { ru: RestaurantUserContext }) {
  // Was: fetch the categories, then one query PER CATEGORY for its items — 25
  // categories meant 25 round-trips to build a list that was flattened back into
  // one array anyway. Now it is one query, and it runs alongside the others.
  const [categories, workstations, items] = await Promise.all([
    getMenuCategories(ru.restaurant_id),
    getWorkstations(ru.restaurant_id),
    getAllMenuItems(ru.restaurant_id),
  ]);
  return (
    <MenuClient
      categories={categories}
      items={items}
      workstations={workstations}
      restaurantId={ru.restaurant_id}
    />
  );
}

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
    sections.push({
      key: "orders",
      title: "Orders",
      bare: true,
      body: (
        <Suspense fallback={<SectionSkeleton bare />}>
          <OrdersBody ru={restaurantUser} />
        </Suspense>
      ),
    });
  }

  // 2. Tables.
  if (navKeys.has("tables")) {
    sections.push({
      key: "tables",
      title: "Tables",
      subtitle: "Open, seat & bill tables",
      body: (
        <Suspense fallback={<SectionSkeleton />}>
          <TablesSection restaurantUser={restaurantUser} />
        </Suspense>
      ),
    });
  }

  // 3. Rooms — its own section, not a row of squares under Tables. Shown only to
  // staff who can see rooms at all; the section then shows only the rooms
  // assigned to them, via the same filter that governs tables.
  if (hasAnyPermission(restaurantUser, [PERMISSIONS.VIEW_ROOMS, PERMISSIONS.MANAGE_ROOMS])) {
    sections.push({
      key: "rooms",
      title: "Rooms",
      subtitle: "Check in, folios & check out",
      body: (
        <Suspense fallback={<SectionSkeleton />}>
          <RoomsSection canCheckIn />
        </Suspense>
      ),
    });
  }

  // 4. Sales.
  if (navKeys.has("sales")) {
    sections.push({
      key: "sales",
      title: "Sales",
      subtitle: "Takings, breakdown & CSV export",
      body: (
        <Suspense fallback={<SectionSkeleton />}>
          <SalesBody />
        </Suspense>
      ),
    });
  }

  // 5. Credits — Cashier / Receptionist only (Billing + Close Bills), so it only
  // appears for the staff who actually collect the money.
  if (navKeys.has("credits")) {
    sections.push({
      key: "credits",
      title: "Credits",
      subtitle: "Customer accounts & repayments",
      body: (
        <Suspense fallback={<SectionSkeleton />}>
          <CreditsBody openId={openCreditId ?? null} />
        </Suspense>
      ),
    });
  }

  // 6. Menu.
  if (navKeys.has("menu")) {
    sections.push({
      key: "menu",
      title: "Menu",
      subtitle: "Manage categories and items",
      body: (
        <Suspense fallback={<SectionSkeleton />}>
          <MenuBody ru={restaurantUser} />
        </Suspense>
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
