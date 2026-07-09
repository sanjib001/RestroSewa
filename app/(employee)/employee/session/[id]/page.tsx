import { notFound } from "next/navigation";
import Link from "next/link";
import { getSessionDetail } from "@/app/actions/pos";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { buildVisibilityFilter } from "@/lib/assignments";
import { SessionClient } from "./_components/session-client";
import { ChevronLeft } from "lucide-react";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [session, { restaurantUser }] = await Promise.all([
    getSessionDetail(id),
    requireRestaurantStaff(),
  ]);

  if (!session) notFound();

  // Table-group isolation: a staff member may only open a session whose table
  // group (or room) they are assigned to. Admins/managers and walk-ins pass.
  const visibility = await buildVisibilityFilter(restaurantUser.restaurant_id, restaurantUser);
  const canView =
    visibility.seesAll ||
    (visibility.canSeeTable(session.table_id) && visibility.canSeeRoom(session.room_id));
  if (!canView) notFound();

  const canCreateOrders = hasPermission(restaurantUser, PERMISSIONS.CREATE_ORDERS);
  const canCloseBills   = hasPermission(restaurantUser, PERMISSIONS.CLOSE_BILLS);
  const canForceClose   =
    hasPermission(restaurantUser, PERMISSIONS.CLOSE_BILLS) ||
    hasPermission(restaurantUser, PERMISSIONS.MANAGE_TABLES);

  // Everyone who can view the session can also see its ordering PIN.
  const canSeePIN = canView;

  const label =
    session.type === "table" && session.table_number
      ? `Table ${session.table_number}`
      : session.type === "walk_in"
      ? "Walk-in"
      : session.type === "room_service"
      ? "Room service"
      : "Session";

  return (
    <div className="p-4 sm:p-5 max-w-lg mx-auto">
      <Link
        href="/employee/dashboard"
        className="inline-flex items-center gap-1 text-sm mb-4"
        style={{ color: "var(--color-ink-mute)" }}
      >
        <ChevronLeft size={14} />
        Tables
      </Link>

      <div className="flex items-center justify-between mb-5">
        <h1
          className="text-xl"
          style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}
        >
          {label}
        </h1>
        <span
          className="text-xs px-2 py-0.5 rounded-full border"
          style={{
            color: session.status === "active" ? "#1a7a4a" : "var(--color-ink-mute)",
            borderColor: session.status === "active" ? "#1a7a4a44" : "var(--color-hairline)",
            background: session.status === "active" ? "#f0fdf4" : "transparent",
          }}
        >
          {session.status}
        </span>
      </div>

      <SessionClient
        session={session}
        canCreateOrders={canCreateOrders}
        canCloseBills={canCloseBills}
        canForceClose={canForceClose}
        canSeePIN={canSeePIN}
      />
    </div>
  );
}
