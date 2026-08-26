import { Suspense } from "react";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import type { RestaurantUserContext } from "@/lib/auth/guards";
import { getStaffNav, hasPermission, PERMISSIONS, NAV_ACCESS, PAYROLL_ACCESS, ROOM_ACCESS, STOCK_ACCESS, WALKIN_ACCESS } from "@/lib/permissions";
import { getRestaurantConfig } from "@/lib/restaurant-info";
import { hasRooms } from "@/lib/business-type";
import { getMyOrderQueue, getSalesReport } from "@/app/actions/pos";
import { getCredits, getCreditSummary } from "@/app/actions/credits";
import { getAllMenuItems, getMenuCategories } from "@/app/actions/menu";
import { getWorkstations } from "@/app/actions/workstations";
import { SalesView } from "../sales/_components/sales-view";
import { CreditsView } from "../credits/_components/credits-view";
import { MenuClient } from "@/app/(admin)/admin/menu/_components/menu-client";
import { TablesSection } from "./_components/tables-section";
import { WalkInsSection } from "./_components/walkins-section";
import { RoomsSection } from "./_components/rooms-section";
import { StockSection } from "./_components/stock-section";
import { PurchasesSection } from "./_components/purchases-section";
import { VendorsSection } from "./_components/vendors-section";
import { ExpensesSection } from "./_components/expenses-section";
import { PayrollSection } from "./_components/payroll-section";
import { OrdersSection } from "./_components/orders-section";
import { StaffDashboard, SectionSkeleton } from "./_components/staff-dashboard";
import type { DashboardSection, SectionKey } from "./_components/staff-dashboard";

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

async function SalesBody({
  canEditTender,
  highlightSessionId,
}: {
  canEditTender: boolean;
  /** Just-closed session to scroll to and highlight — see the page's own doc
   *  comment on `?session=`. */
  highlightSessionId: string | null;
}) {
  const report = await getSalesReport({ period: "today" });
  return (
    <SalesView
      initial={report}
      embedded
      canEditTender={canEditTender}
      highlightSessionId={highlightSessionId}
    />
  );
}

async function CreditsBody({ openId, canDiscount }: { openId: string | null; canDiscount: boolean }) {
  const [credits, summary] = await Promise.all([getCredits({ status: "all" }), getCreditSummary()]);
  return (
    <CreditsView
      initialCredits={credits}
      initialSummary={summary}
      initialOpenId={openId}
      canDiscount={canDiscount}
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
  // Three ways to arrive pointed at a particular part of the workspace:
  //   ?credit=<accountId>  — a bill was just closed on credit; open that account.
  //   ?session=<sessionId> — a bill was just closed in full; scroll Sales to
  //                          THAT bill specifically, so printing it is one tap
  //                          away instead of a scan through today's list.
  //   ?focus=<section>     — a tapped push (or a redirected legacy /employee/* page)
  //                          asking the dashboard to scroll to a section. `focus`'s
  //                          `notifications` value is handled by the bell, not here.
  // All three keep staff on the one page instead of bouncing them to a standalone route.
  searchParams: Promise<{ credit?: string; session?: string; focus?: string }>;
}) {
  const { restaurantUser } = await requireRestaurantStaff();
  const { credit: openCreditId, session: highlightSessionId, focus: focusParam } = await searchParams;
  // Rooms only exist for a hotel / restaurant+hotel client.
  const config = await getRestaurantConfig(restaurantUser.restaurant_id);
  const roomsEnabled = hasRooms(config.businessType);
  // Billing staff (process_payments) may correct a bill's tender once a Security PIN is set —
  // the PIN is the real gate (verified + audited server-side); admin passes the permission too.
  const canEditTender = config.securityEnabled && hasPermission(restaurantUser, PERMISSIONS.PROCESS_PAYMENTS);
  // The "M" shortcut to mock billing. Same shape as canEditTender: the Security PIN is the
  // real gate (re-verified in `unlockMockBill`), and `print_mock_bills` — this feature's own
  // permission, off every job preset — decides who is even offered it. No PIN set ⇒ the
  // button doesn't exist, and neither does the route.
  const canMockBill = config.securityEnabled && hasPermission(restaurantUser, PERMISSIONS.PRINT_MOCK_BILLS);
  // Forgiving part of a customer's debt at clearance is a discount, gated the same way
  // one at the till is: the permission decides who is OFFERED it, the Discount PIN
  // decides whether it goes through, and `addCreditPayment` re-checks both. Hiding the
  // field is UX, not the boundary — a staffer without the right should not be typing a
  // discount and a PIN only to be refused on submit.
  const canDiscount = hasPermission(restaurantUser, PERMISSIONS.APPLY_DISCOUNTS);

  const SCROLLABLE: SectionKey[] = ["orders", "tables", "walkins", "rooms", "sales", "credits", "menu", "stock", "purchases", "vendors"];
  const focusSection: SectionKey | null = openCreditId
    ? "credits"
    : highlightSessionId
    ? "sales"
    : SCROLLABLE.includes(focusParam as SectionKey)
      ? (focusParam as SectionKey)
      : null;

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

  // 2b. Walk-ins — fixed W1/W2/W3 workspaces (takeaway/phone/delivery). Own permission
  // now: view_walkins shows the section (read-only), manage_walkins enables operations.
  if (WALKIN_ACCESS.canViewWalkins(restaurantUser)) {
    sections.push({
      key: "walkins",
      title: "Walk-ins",
      subtitle: "Takeaway, phone & delivery orders",
      body: (
        <Suspense fallback={<SectionSkeleton />}>
          <WalkInsSection restaurantUser={restaurantUser} />
        </Suspense>
      ),
    });
  }

  // 3. Rooms — its own section, not a row of squares under Tables. Shown only to
  // staff who can see rooms at all; the section then shows only the rooms
  // assigned to them, via the same filter that governs tables.
  if (roomsEnabled && ROOM_ACCESS.canViewRooms(restaurantUser)) {
    sections.push({
      key: "rooms",
      title: "Rooms",
      subtitle: "Check in, folios & check out",
      body: (
        <Suspense fallback={<SectionSkeleton />}>
          {/* RoomsSection computes canCheckIn itself now — view_rooms is read-only. */}
          <RoomsSection restaurantUser={restaurantUser} />
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
          <SalesBody canEditTender={canEditTender} highlightSessionId={highlightSessionId ?? null} />
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
          <CreditsBody openId={openCreditId ?? null} canDiscount={canDiscount} />
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

  // 7. Stock — after Menu. Shown to anyone who can view stock (view_stock or
  // manage_stock); the summary is read-only, the full page enforces write access.
  if (STOCK_ACCESS.canViewStock(restaurantUser)) {
    sections.push({
      key: "stock",
      title: "Stock",
      subtitle: "Inventory levels & low-stock alerts",
      body: (
        <Suspense fallback={<SectionSkeleton />}>
          <StockSection />
        </Suspense>
      ),
    });
  }

  // 8. Purchases — after Stock. These are ACTION surfaces, so they appear only for
  // staff who can actually do the work: gate on manage_purchases, not merely view.
  // A view-only storekeeper (view_stock/manage_stock without manage_purchases) does
  // not get a "record a purchase" card on their dashboard.
  if (STOCK_ACCESS.canManagePurchases(restaurantUser)) {
    sections.push({
      key: "purchases",
      title: "Purchases",
      subtitle: "Record supplier bills",
      body: (
        <Suspense fallback={<SectionSkeleton />}>
          <PurchasesSection />
        </Suspense>
      ),
    });
  }

  // 9. Vendors — after Purchases. Same rule: only staff with manage_vendors see it.
  // Without that permission the Vendors section is hidden from the dashboard, even
  // for someone who can view stock.
  if (STOCK_ACCESS.canManageVendors(restaurantUser)) {
    sections.push({
      key: "vendors",
      title: "Vendors",
      subtitle: "Suppliers & what we owe them",
      body: (
        <Suspense fallback={<SectionSkeleton />}>
          <VendorsSection />
        </Suspense>
      ),
    });
  }

  // 10. Extra Expenses — after Vendors. Rent, electricity and the rest, plus the
  // saving pots. Opens on `manage_expenses`, `view_finance` OR the narrow
  // `add_expenses`; that last one sees only TODAY's entries and never a pot
  // balance, enforced server-side in the actions rather than by this gate.
  if (STOCK_ACCESS.canViewExpenses(restaurantUser)) {
    sections.push({
      key: "expenses",
      title: "Extra Expenses",
      subtitle: "Rent, bills & savings",
      body: (
        <Suspense fallback={<SectionSkeleton />}>
          <ExpensesSection />
        </Suspense>
      ),
    });
  }

  // 11. Payroll — last. Gated on `manage_payroll` ALONE, deliberately tighter
  // than the /employee/payroll page (which opens on either payroll right): this
  // card puts colleagues' salaries on a dashboard that stays open at the
  // counter, so a reporting-only right should not summon it there.
  if (PAYROLL_ACCESS.canManagePayroll(restaurantUser)) {
    sections.push({
      key: "payroll",
      title: "Payroll",
      subtitle: "Salaries & payments",
      body: (
        <Suspense fallback={<SectionSkeleton />}>
          <PayrollSection />
        </Suspense>
      ),
    });
  }

  return (
    <StaffDashboard
      sections={sections}
      canMockBill={canMockBill}
      // Just billed to credit, or arrived from a tapped push → land in that
      // section rather than at the top of the dashboard.
      focus={focusSection}
    />
  );
}
