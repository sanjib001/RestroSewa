"use client";

import { useRouter } from "next/navigation";
import { MenuBrowser } from "../add/_components/menu-browser";
import type { AddItemsMenuData } from "@/lib/menu-browser-data";
import { NAV_HEIGHT, RAIL_BOX_WIDTH } from "../../_components/layout-metrics";

/**
 * Desktop/tablet only (`lg:` and up — matching the sidebar's own mobile/
 * desktop split elsewhere in this app): two columns — the currently open
 * table's order/bill, and the add-items menu — sitting beside the tables
 * rail, which lives one level up now (`session/layout.tsx`) so switching
 * tables doesn't re-fetch or flash it — only these two columns reload per
 * table, which is expected (they ARE that table's own data). Below `lg` this
 * renders `children` exactly as the page always has — its own "Add items"
 * button (`session-client.tsx`) still navigates to the standalone `/add`
 * route there, untouched.
 */
export function SessionSplitView({
  sessionId,
  canCreateOrders,
  menuData,
  children,
}: {
  sessionId: string;
  canCreateOrders: boolean;
  /** Null when the viewer can't create orders — no Menu column to show at all. */
  menuData: AddItemsMenuData | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const showMenu = canCreateOrders && !!menuData;

  return (
    <>
      {/* ── Mobile (below lg): unchanged ── */}
      <div className="lg:hidden p-4 sm:p-5 max-w-lg mx-auto">{children}</div>

      {/* ── Desktop/tablet: order · menu, beside the persistent rail ──
          `fixed`, not a flow height computed by subtracting the nav's height
          (and the ancestor `<main>`'s own `.scroll-pb-safe` padding, and the
          gap between `100vh` and `100dvh`, and every OTHER thing that turns
          out to add a few px of its own) from `100dvh`. Each of those was
          individually accounted for and the sum still drifted a hair at some
          zoom levels — independently-rounded `calc()` terms compounding in a
          way that is exactly proportional to zoom, which is why 80% hid it
          and 100% didn't. Anchoring `top`/`bottom`/`left`/`right` to the
          viewport directly sidesteps all of it: the browser resolves the
          size itself, with nothing here to round differently.
          `left: RAIL_BOX_WIDTH`, not `inset-x-0` — the rail (a sibling fixed
          element from `session/layout.tsx`) occupies the space from 0 to
          there; starting here instead of double-padding reproduces the
          original single-row layout's spacing exactly (see
          `layout-metrics.ts`).
          Both columns share the same card background (`--color-canvas`) and a
          stronger, more visible border (`--color-hairline-input` — normally
          reserved for input fields, borrowed here because these dividers need
          to actually read as boundaries, not passive hairlines) — matching
          the rail so the whole strip reads as one consistent set of floating
          cards. Each scrolls independently, with its own slim
          `thin-scrollbar` (see `globals.css`) — enough to signal "more below"
          without bulky browser scrollbars competing. */}
      <div
        className="hidden lg:flex gap-3 lg:fixed lg:bottom-0 z-10"
        style={{ top: NAV_HEIGHT, left: RAIL_BOX_WIDTH, right: 0, paddingTop: 12, paddingBottom: 12, paddingRight: 12 }}
      >
        <div
          className="w-[460px] shrink-0 overflow-y-auto thin-scrollbar rounded-xl border p-4 sm:p-5"
          style={{
            borderColor: "var(--color-hairline-input)",
            background: "var(--color-canvas)",
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          }}
        >
          {children}
        </div>

        {showMenu && (
          <div
            className="flex-1 min-w-0 flex flex-col rounded-xl border overflow-hidden"
            style={{
              borderColor: "var(--color-hairline-input)",
              background: "var(--color-canvas)",
              boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
            }}
          >
            <MenuBrowser
              sessionId={sessionId}
              categories={menuData!.categories}
              items={menuData!.items}
              variants={menuData!.variants}
              canAddCustom={menuData!.canAddCustom}
              workstations={menuData!.workstations}
              // The order column is already visible right beside this one — no
              // tab to switch back to — so all a successful submit needs is a
              // refresh, to pull the new items into that column's (server-
              // fetched) data.
              onOrderPlaced={() => router.refresh()}
            />
          </div>
        )}
      </div>
    </>
  );
}
