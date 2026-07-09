import { redirect } from "next/navigation";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { NAV_ACCESS } from "@/lib/permissions";
import { getMyOrderQueue } from "@/app/actions/pos";
import { OrdersQueue } from "./_components/orders-queue";

export default async function OrdersPage() {
  const { restaurantUser } = await requireRestaurantStaff();

  // Route protection mirrors the nav: only staff who can see orders reach here.
  if (!NAV_ACCESS.canSeeOrders(restaurantUser)) {
    redirect("/employee/dashboard");
  }

  const canManage = NAV_ACCESS.canManageOrders(restaurantUser);
  const orders = await getMyOrderQueue();

  const pending = orders.filter((o) => o.status === "pending").length;
  const ready = orders.filter((o) => o.status === "ready").length;

  return (
    <div className="p-4 sm:p-5 max-w-2xl mx-auto">
      <h1
        className="text-xl mb-1"
        style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}
      >
        Orders
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--color-ink-mute)" }}>
        {orders.length === 0
          ? "All clear."
          : `${pending} pending · ${ready} ready · updates live`}
      </p>

      <OrdersQueue initialOrders={orders} canManage={canManage} />
    </div>
  );
}
