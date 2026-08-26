"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { logoutSuperAdmin } from "@/app/actions/auth";
import { Store, LogOut, Settings, Menu, X } from "lucide-react";
import { PlatformLogo, PlatformWordmark, PoweredBy } from "@/components/branding/platform-logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";

const NAV = [
  { label: "Restaurants", href: "/superadmin/dashboard", icon: Store, exact: true },
  { label: "Settings", href: "/superadmin/settings", icon: Settings, exact: false },
];

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <>
      {NAV.map(({ label, href, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors"
            style={{
              color: active ? "#ffffff" : "rgba(255,255,255,0.5)",
              background: active ? "rgba(255,255,255,0.1)" : "transparent",
              fontWeight: active ? 400 : 300,
            }}
          >
            <Icon size={15} strokeWidth={1.5} />
            {label}
          </Link>
        );
      })}
    </>
  );
}

export function SuperAdminSidebar() {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [mobileOpen, setMobileOpen] = useState(false);

  // With the drawer open, the page behind it must not scroll away underneath.
  useBodyScrollLock(mobileOpen);

  function handleLogout() {
    startTransition(async () => {
      await logoutSuperAdmin();
    });
  }

  return (
    <>
      {/* ── Sidebar (md+) ─────────────────────────────────────────────────────
          sticky top-0 h-screen pins it to the viewport while the main column
          scrolls past — it stays in the flex row (unlike `fixed`), so the
          content keeps its width. Hidden below md, where the mobile app bar +
          drawer below take over — a fixed 208px sidebar left always-on ate a
          third of a phone screen. */}
      <aside
        className="w-52 shrink-0 hidden md:flex flex-col sticky top-0 h-screen"
        style={{ background: "var(--color-brand-dark)" }}
      >
        {/* Logo */}
        <div className="px-5 py-6 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          {/* Super Admin is PLATFORM territory — HRestroSewa is the only brand here. */}
          <Link href="/superadmin/dashboard" className="block">
            <span className="flex items-center gap-2.5">
              {/* White plate: this sidebar is brand-dark indigo (#1c1e54), almost the emblem tile's
                  own navy (#19204f), so the badge would blend right in. A small white plate lifts it
                  off the background as a crisp app-icon badge. (Login/marketing sit on near-black, so
                  the emblem pops there without a plate.) */}
              <span className="inline-flex shrink-0" style={{ background: "#fff", borderRadius: 8, padding: 3 }}>
                <PlatformLogo size={26} priority />
              </span>
              <PlatformWordmark size={16} />
            </span>
            <p
              className="text-xs mt-1.5"
              style={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}
            >
              Super Admin
            </p>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-4 flex flex-col gap-0.5">
          <NavLinks pathname={pathname} />
        </nav>

        {/* Footer */}
        <div
          className="px-3 py-4 border-t shrink-0 flex flex-col gap-2.5"
          style={{ borderColor: "rgba(255,255,255,0.08)" }}
        >
          <div className="flex items-center justify-between px-3 w-full">
            <span className="text-xs text-white/40 uppercase tracking-wider font-light">Theme</span>
            <ThemeToggle />
          </div>
          <button
            type="button"
            onClick={handleLogout}
            disabled={pending}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm w-full transition-colors"
            style={{ color: "rgba(255,255,255,0.4)" }}
          >
            <LogOut size={15} strokeWidth={1.5} />
            {pending ? "Signing out…" : "Sign out"}
          </button>
          <PoweredBy height={12} tone="light" className="px-3 pt-3" />
        </div>
      </aside>

      {/* ── Mobile app bar (below md) ────────────────────────────────────────── */}
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

        <Link href="/superadmin/dashboard" className="flex-1 min-w-0 flex items-center gap-2">
          <span className="inline-flex shrink-0" style={{ background: "#fff", borderRadius: 6, padding: 2 }}>
            <PlatformLogo size={20} priority />
          </span>
          <span className="text-sm truncate" style={{ color: "#fff", fontWeight: 400, letterSpacing: "-0.2px" }}>
            Super Admin
          </span>
        </Link>
        <div className="flex items-center pr-1 shrink-0">
          <ThemeToggle />
        </div>
      </header>

      {/* ── Mobile drawer overlay ─────────────────────────────────────────────── */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Drawer panel — h-full (not min-h-screen) so it never grows past the
              viewport; the nav inside scrolls instead. */}
          <div className="w-64 flex flex-col h-full" style={{ background: "var(--color-brand-dark)" }}>
            <div
              className="flex items-center justify-between px-5 py-4 border-b shrink-0"
              style={{ borderColor: "rgba(255,255,255,0.08)" }}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <span className="inline-flex shrink-0" style={{ background: "#fff", borderRadius: 6, padding: 2 }}>
                  <PlatformLogo size={22} />
                </span>
                <span className="text-sm truncate" style={{ color: "#fff", fontWeight: 400 }}>
                  Super Admin
                </span>
              </span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
                style={{ color: "rgba(255,255,255,0.5)" }}
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>

            <PlatformWordmark size={11} className="block px-5 pt-2 pb-1 opacity-50" />

            <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-0.5">
              <NavLinks pathname={pathname} onNavigate={() => setMobileOpen(false)} />
            </nav>

            <div className="px-3 py-4 border-t shrink-0 flex flex-col gap-2.5" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
              <div className="flex items-center justify-between px-3 w-full">
                <span className="text-xs text-white/40 uppercase tracking-wider font-light">Theme</span>
                <ThemeToggle />
              </div>
              <button
                type="button"
                onClick={handleLogout}
                disabled={pending}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm w-full transition-colors hover:bg-white/5"
                style={{ color: "rgba(255,255,255,0.4)" }}
              >
                <LogOut size={15} strokeWidth={1.5} />
                {pending ? "Signing out…" : "Sign out"}
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
