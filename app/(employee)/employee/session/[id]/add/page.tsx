import { redirect } from "next/navigation";
import Link from "next/link";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { getAddItemsMenuData } from "@/lib/menu-browser-data";
import { createServiceClient } from "@/lib/supabase/service";
import { MenuBrowser } from "./_components/menu-browser";
import { ChevronLeft } from "lucide-react";

/**
 * The screen is exactly the space left under the staff nav, so the cart bar (and its
 * Place order button) sits on the bottom edge without the page scrolling.
 *
 * Mirrors `StaffNav`'s own height — `calc(56px + env(safe-area-inset-top))` — rather
 * than the bare 56px this used to subtract: the viewport is `viewport-fit: cover`, so on
 * a notched phone the nav is TALLER than 56px and the difference pushed the bottom of
 * this page off the screen. `dvh`, not `vh`, for the same reason on mobile browsers,
 * where `vh` is the tallest the viewport ever gets rather than its current height.
 */
const SCREEN_UNDER_NAV = "calc(100dvh - 56px - env(safe-area-inset-top, 0px))";

/**
 * Why this screen cannot show the menu — in words, not a 404.
 *
 * Two things can be true, and they need different actions from the person holding the
 * till, so they are worded differently rather than collapsed into one apology. The status
 * is shown because "closed" vs "pending_activation" is the difference between reopening
 * the table and approving a customer's request.
 */
function AddItemsUnavailable({
  sessionId,
  reason,
  status,
}: {
  sessionId: string;
  reason: "not-found" | "not-open";
  status: string | null;
}) {
  const title =
    reason === "not-found"
      ? "This order isn't open any more"
      : "This table's order is no longer open";
  const detail =
    reason === "not-found"
      ? "It may have been closed, or moved to another table, on a different till."
      : `Reopen the table to add more items${status ? ` (status: ${status})` : ""}.`;

  return (
    <div className="flex flex-col" style={{ height: SCREEN_UNDER_NAV }}>
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
        <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
          Add items
        </span>
      </div>

      <div className="flex-1 flex items-center justify-center px-6">
        <div className="text-center max-w-xs">
          <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{title}</p>
          <p className="text-sm mt-1.5" style={{ color: "var(--color-ink-mute)" }}>{detail}</p>
          <Link
            href={`/employee/session/${sessionId}`}
            className="inline-block mt-4 text-sm px-4 py-2 rounded-pill border"
            style={{ borderColor: "var(--color-hairline)", color: "var(--color-ink)" }}
          >
            Back to the table
          </Link>
        </div>
      </div>
    </div>
  );
}

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

  // A 404 is the wrong answer here, and it is why this was impossible to diagnose from
  // the floor: "page not found" tells a cashier nothing about a table sitting in front of
  // them, and it looks identical to a broken route. Say which of the two things is
  // actually true and give them the way back. Neither message leaks anything — whoever
  // asked already holds the session id.
  if (!session || session.status !== "active") {
    return (
      <AddItemsUnavailable
        sessionId={sessionId}
        reason={!session ? "not-found" : "not-open"}
        status={session?.status ?? null}
      />
    );
  }

  const { categories: activeCategories, items: allItems, variants, canAddCustom, workstations } =
    await getAddItemsMenuData(restaurantUser);

  return (
    <div className="flex flex-col" style={{ height: SCREEN_UNDER_NAV }}>
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
        canAddCustom={canAddCustom}
        workstations={workstations}
      />
    </div>
  );
}
