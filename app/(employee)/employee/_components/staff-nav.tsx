"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { logout } from "@/app/actions/auth";
import { Home, LogOut } from "lucide-react";
import { NotificationBell } from "./notification-bell";

// The staff top bar. STICKY: it stays pinned while the dashboard scrolls, so
// Notifications and Logout are always one tap away — which matters when a waiter
// call arrives while someone is halfway down the Orders queue.
//
// Actionable requests (waiter call, bill request, table activation) are now
// handled entirely in the bell's dropdown — no navigation to a separate page.
export function StaffNav({
  restaurantName,
  displayName,
  notificationCount = 0,
}: {
  restaurantName: string;
  displayName: string;
  notificationCount?: number;
}) {
  const [pending, startTransition] = useTransition();
  const pathname = usePathname();
  const atHome = pathname === "/employee/dashboard";

  return (
    <header
      // z-40 keeps it above the dashboard's own sticky section-nav (z-30), which
      // parks itself directly beneath this bar.
      className="sticky top-0 z-40 flex items-center gap-2 px-3 sm:px-5 border-b"
      style={{
        background: "var(--color-brand-dark)",
        borderColor: "rgba(255,255,255,0.08)",
        height: 56,
      }}
    >
      {/* Brand / user — tapping the name returns to the dashboard. */}
      <Link href="/employee/dashboard" className="flex-1 min-w-0">
        <span className="text-sm font-medium truncate block" style={{ color: "#fff", letterSpacing: "-0.2px" }}>
          <span className="hidden sm:inline">{restaurantName}</span>
          <span className="sm:hidden" style={{ color: "rgba(255,255,255,0.6)", fontWeight: 300 }}>
            {displayName}
          </span>
        </span>
        <span className="text-xs hidden sm:block" style={{ color: "rgba(255,255,255,0.4)" }}>
          {displayName}
        </span>
      </Link>

      {/* Home — one tap back to the dashboard from a session, queue or menu
          screen. The label collapses on narrow phones; the icon never does. */}
      <Link
        href="/employee/dashboard"
        aria-label="Home"
        aria-current={atHome ? "page" : undefined}
        className="flex items-center gap-1 px-2 sm:px-3 py-1.5 rounded-lg text-sm transition-colors"
        style={{
          color: atHome ? "#fff" : "rgba(255,255,255,0.85)",
          background: atHome ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.08)",
        }}
      >
        <Home size={15} strokeWidth={1.5} />
        <span className="hidden sm:inline">Home</span>
      </Link>

      {/* Notifications — the bell owns the dropdown, the badge and the stream. */}
      <NotificationBell initialCount={notificationCount} />

      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => { await logout(); })}
        className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-sm"
        style={{ color: "rgba(255,255,255,0.4)" }}
      >
        <LogOut size={14} strokeWidth={1.5} />
        <span className="hidden sm:inline">{pending ? "…" : "Out"}</span>
      </button>
    </header>
  );
}
