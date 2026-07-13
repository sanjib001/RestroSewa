"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { logout } from "@/app/actions/auth";
import {
  LayoutDashboard,
  BookOpen,
  LayoutGrid,
  DoorOpen,
  Zap,
  Users,
  Truck,
  Package,
  ShoppingCart,
  Wallet,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { RestaurantLogo } from "@/components/branding/restaurant-logo";
import { PlatformWordmark, PoweredBy } from "@/components/branding/platform-logo";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  exact: boolean;
  /** Finance-only: needs `view_finance`, which stock permissions do NOT grant. */
  financeOnly?: boolean;
};

const NAV: NavItem[] = [
  { label: "Dashboard",    href: "/admin/dashboard",     icon: LayoutDashboard, exact: true },
  { label: "Menu",         href: "/admin/menu",           icon: BookOpen,        exact: false },
  { label: "Tables",       href: "/admin/tables",         icon: LayoutGrid,      exact: false },
  { label: "Rooms",        href: "/admin/rooms",          icon: DoorOpen,        exact: false },
  { label: "Workstations", href: "/admin/workstations",   icon: Zap,             exact: false },
  { label: "Staff",        href: "/admin/staff",          icon: Users,           exact: false },
];

// Stock & Finance. Shown only to staff permitted to see the module — and Finance
// is gated separately again, so a storekeeper never sees a link that would just
// bounce them (nav and route guard must agree).
const STOCK_NAV: NavItem[] = [
  { label: "Stock",     href: "/admin/stock",     icon: Package,      exact: false },
  { label: "Purchases", href: "/admin/purchases", icon: ShoppingCart, exact: false },
  { label: "Vendors",   href: "/admin/vendors",   icon: Truck,        exact: false },
  { label: "Finance",   href: "/admin/finance",   icon: Wallet,       exact: false, financeOnly: true },
];

const stockNavFor = (canSeeStock: boolean, canSeeFinance: boolean) =>
  STOCK_NAV.filter((i) =>
    i.financeOnly ? canSeeFinance : canSeeStock
  );

const isActive = (pathname: string, item: NavItem) =>
  item.exact ? pathname === item.href : pathname.startsWith(item.href);

// `rail` is the tablet form: icons only, no labels. It's driven by Tailwind
// breakpoints rather than state, so there is no toggle to get out of sync — the
// same markup is a rail at md and a full sidebar at lg. In the drawer, where
// there is always room, labels always show.
function NavLink({
  item,
  pathname,
  rail = false,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  rail?: boolean;
  onNavigate?: () => void;
}) {
  const active = isActive(pathname, item);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      // The label is the accessible name at lg; on the rail the icon is alone, so
      // it needs one of its own or the link reads as empty to a screen reader.
      aria-label={item.label}
      title={rail ? item.label : undefined}
      className={
        "flex items-center gap-2.5 py-2 rounded-lg text-sm transition-colors " +
        (rail ? "justify-center lg:justify-start px-0 lg:px-3" : "px-3")
      }
      style={{
        color: active ? "#fff" : "rgba(255,255,255,0.5)",
        background: active ? "rgba(255,255,255,0.1)" : "transparent",
        fontWeight: active ? 400 : 300,
      }}
    >
      <Icon size={15} strokeWidth={1.5} />
      <span className={rail ? "hidden lg:inline" : undefined}>{item.label}</span>
    </Link>
  );
}

function NavLinks({
  pathname,
  showStock,
  showFinance,
  rail = false,
  onNavigate,
}: {
  pathname: string;
  showStock: boolean;
  showFinance: boolean;
  rail?: boolean;
  onNavigate?: () => void;
}) {
  const stockItems = stockNavFor(showStock, showFinance);
  return (
    <>
      {NAV.map((item) => (
        <NavLink key={item.href} item={item} pathname={pathname} rail={rail} onNavigate={onNavigate} />
      ))}

      {stockItems.length > 0 && (
        <>
          {/* On the rail the caption has nowhere to go, so the group is marked by
              a hairline instead — the separation survives, the text doesn't. */}
          {rail && (
            <span
              className="lg:hidden mx-2 my-2 h-px block"
              style={{ background: "rgba(255,255,255,0.12)" }}
            />
          )}
          <p
            className={
              "px-3 pt-4 pb-1 text-[10px] uppercase tracking-wide " +
              (rail ? "hidden lg:block" : "")
            }
            style={{ color: "rgba(255,255,255,0.3)", letterSpacing: "0.08em" }}
          >
            Stock &amp; Finance
          </p>
          {stockItems.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} rail={rail} onNavigate={onNavigate} />
          ))}
        </>
      )}
    </>
  );
}

export function AdminSidebar({
  restaurantName,
  restaurantLogo = null,
  showStock = false,
  showFinance = false,
}: {
  restaurantName: string;
  restaurantLogo?: string | null;
  showStock?: boolean;
  showFinance?: boolean;
}) {
  const pathname = usePathname();
  const [logoutPending, startLogout] = useTransition();
  const [mobileOpen, setMobileOpen] = useState(false);

  // With the drawer open, the page behind it must not scroll away underneath.
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [mobileOpen]);

  function handleLogout() {
    startLogout(async () => { await logout(); });
  }

  return (
    <>
      {/* ── Sidebar (md+) ─────────────────────────────────────────────────────
          `sticky top-0 h-screen` pins it to the viewport while the page scrolls
          past. It stays in the flex row (unlike `fixed`), so the content column
          keeps its width automatically and no layout shifts.

          On a tablet (md–lg) a 208px sidebar eats a quarter of a 768px screen,
          so it narrows to a 64px icon rail and only becomes the full labelled
          sidebar at lg. */}
      <aside
        className="w-16 lg:w-52 shrink-0 hidden md:flex flex-col sticky top-0 h-screen"
        style={{ background: "var(--color-brand-dark)" }}
      >
        {/* The RESTAURANT leads — this is their dashboard. RestroSewa stays as the
            quiet platform mark beneath it. Both the name and the platform mark are
            dropped on the rail: the logo alone still identifies it, and the
            wordmark would only wrap. */}
        <div
          className="px-3 lg:px-5 py-5 border-b shrink-0"
          style={{ borderColor: "rgba(255,255,255,0.08)" }}
        >
          <Link
            href="/admin/dashboard"
            title={restaurantName}
            className="flex items-center justify-center lg:justify-start gap-2.5 min-w-0"
          >
            <RestaurantLogo name={restaurantName} logoUrl={restaurantLogo} size={34} priority />
            <span
              className="hidden lg:inline text-sm truncate"
              style={{ color: "#fff", fontWeight: 400, letterSpacing: "-0.2px" }}
            >
              {restaurantName}
            </span>
          </Link>
          <PlatformWordmark size={11} className="hidden lg:block mt-2 opacity-50" />
        </div>

        {/* The nav itself scrolls if it ever outgrows the viewport, so Sign out
            can never be pushed off-screen. */}
        <nav className="flex-1 min-h-0 overflow-y-auto px-2 lg:px-3 py-4 flex flex-col gap-0.5">
          <NavLinks pathname={pathname} showStock={showStock} showFinance={showFinance} rail />
        </nav>

        <div
          className="px-2 lg:px-3 py-4 border-t shrink-0"
          style={{ borderColor: "rgba(255,255,255,0.08)" }}
        >
          <button
            type="button"
            disabled={logoutPending}
            onClick={handleLogout}
            aria-label="Sign out"
            title="Sign out"
            className="flex items-center justify-center lg:justify-start gap-2.5 px-0 lg:px-3 py-2 rounded-lg text-sm w-full"
            style={{ color: "rgba(255,255,255,0.4)" }}
          >
            <LogOut size={15} strokeWidth={1.5} />
            <span className="hidden lg:inline">
              {logoutPending ? "Signing out…" : "Sign out"}
            </span>
          </button>
          <PoweredBy height={14} tone="light" className="hidden lg:block px-3 pt-3" />
        </div>
      </aside>

      {/* ── Mobile app bar (below md) ──────────────────────────────────────────
          This carries NO navigation of its own — it used to repeat every nav
          item as an icon row, which is the duplicate the drawer already covers
          and which squeezed the brand off a narrow screen. What's left is the
          drawer's trigger and the restaurant's identity: the drawer is the only
          way to navigate on mobile, so there is exactly one nav to reason about. */}
      <header
        className="md:hidden fixed top-0 left-0 right-0 z-30 flex items-center gap-3 px-4 border-b"
        style={{
          background: "var(--color-brand-dark)",
          borderColor: "rgba(255,255,255,0.08)",
          height: 48,
        }}
      >
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
          aria-expanded={mobileOpen}
          className="-ml-1 w-9 h-9 flex items-center justify-center rounded-lg shrink-0"
          style={{ color: "rgba(255,255,255,0.75)" }}
        >
          <Menu size={20} strokeWidth={1.5} />
        </button>

        <Link href="/admin/dashboard" className="flex-1 min-w-0 flex items-center gap-2">
          <RestaurantLogo name={restaurantName} logoUrl={restaurantLogo} size={26} priority />
          <span
            className="text-sm truncate"
            style={{ color: "#fff", fontWeight: 400, letterSpacing: "-0.2px" }}
          >
            {restaurantName}
          </span>
        </Link>
      </header>

      {/* ── Mobile drawer overlay ──────────────────────────────────── */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Drawer panel — h-full (not min-h-screen) so it never grows past the
              viewport; the nav inside scrolls instead. */}
          <div
            className="w-64 flex flex-col h-full"
            style={{ background: "var(--color-brand-dark)" }}
          >
            <div
              className="flex items-center justify-between px-5 py-4 border-b shrink-0"
              style={{ borderColor: "rgba(255,255,255,0.08)" }}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <RestaurantLogo name={restaurantName} logoUrl={restaurantLogo} size={30} />
                <span className="text-sm truncate" style={{ color: "#fff", fontWeight: 400 }}>
                  {restaurantName}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                style={{ color: "rgba(255,255,255,0.5)" }}
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>

            <PlatformWordmark size={11} className="block px-5 pt-2 pb-1 opacity-50" />

            <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-0.5">
              <NavLinks
                pathname={pathname}
                showStock={showStock}
                showFinance={showFinance}
                onNavigate={() => setMobileOpen(false)}
              />
            </nav>

            <div className="px-3 py-4 border-t shrink-0" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
              <button
                type="button"
                disabled={logoutPending}
                onClick={handleLogout}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm w-full"
                style={{ color: "rgba(255,255,255,0.4)" }}
              >
                <LogOut size={15} strokeWidth={1.5} />
                {logoutPending ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </div>

          {/* Backdrop */}
          <div
            className="flex-1"
            style={{ background: "rgba(0,0,0,0.5)" }}
            onClick={() => setMobileOpen(false)}
          />
        </div>
      )}
    </>
  );
}
