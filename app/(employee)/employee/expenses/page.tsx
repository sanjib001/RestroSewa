import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { STOCK_ACCESS } from "@/lib/permissions";
import { listExtraExpenses, listSavingTitles } from "@/app/actions/expenses";
import { getRestaurantConfig } from "@/lib/restaurant-info";
import { ExpensesClient } from "@/app/(admin)/admin/expenses/_components/expenses-client";

// The staff-surface Extra Expenses page. Renders the SAME ExpensesClient the admin
// surface uses — no second UI to keep in step — on the employee chrome, exactly as
// the Vendors and Purchases staff pages already do.
//
// Three shapes of viewer reach this page:
//   manage_expenses  full: add, withdraw, manage pots, any period
//   add_expenses     add only: TODAY's entries, no pot balances, no withdrawals
//   view_finance     read-only (the report already prints every figure here)
// The narrowing is enforced server-side in the actions; the flags below only stop
// the UI offering controls that would be refused anyway.
export default async function EmployeeExpensesPage() {
  const { restaurantUser } = await requireRestaurantStaff();

  if (!STOCK_ACCESS.canViewExpenses(restaurantUser)) {
    redirect("/employee/dashboard");
  }

  const todayOnly = STOCK_ACCESS.expensesTodayOnly(restaurantUser);

  const [expenses, titles, config] = await Promise.all([
    listExtraExpenses({ period: todayOnly ? "today" : "month" }),
    listSavingTitles(),
    getRestaurantConfig(restaurantUser.restaurant_id),
  ]);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="px-4 sm:px-5 pt-4">
        <Link
          href="/employee/dashboard"
          className="inline-flex items-center gap-1 text-sm"
          style={{ color: "var(--color-ink-mute)" }}
        >
          <ChevronLeft size={14} />
          Dashboard
        </Link>
      </div>

      <ExpensesClient
        initialExpenses={expenses}
        initialTitles={titles}
        canManage={STOCK_ACCESS.canManageExpenses(restaurantUser)}
        canAdd={STOCK_ACCESS.canAddExpenses(restaurantUser)}
        todayOnly={todayOnly}
        // Correcting a filed entry stays owner-only + Security PIN, on every
        // surface. A staff page does not loosen that.
        canEdit={restaurantUser.role === "restaurant_admin"}
        securityEnabled={config.securityEnabled}
      />
    </div>
  );
}
