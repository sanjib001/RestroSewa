import { redirect } from "next/navigation";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { NAV_ACCESS } from "@/lib/permissions";
import { getSalesReport } from "@/app/actions/pos";
import { SalesView } from "./_components/sales-view";

export default async function SalesPage() {
  const { restaurantUser } = await requireRestaurantStaff();

  // Only staff with billing / sales permission (e.g. cashier) may view sales.
  if (!NAV_ACCESS.canSeeSales(restaurantUser)) {
    redirect("/employee/dashboard");
  }

  // Initial view defaults to Today; the client re-queries on filter change.
  const initial = await getSalesReport({ period: "today" });

  return <SalesView initial={initial} />;
}
