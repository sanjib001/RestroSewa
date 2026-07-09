"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { logout } from "@/app/actions/auth";
import { getMyNotifications } from "@/app/actions/notifications";
import type { NotificationRow } from "@/app/actions/notifications";
import {
  Banknote,
  Bell,
  BookOpen,
  ClipboardList,
  LayoutGrid,
  ListOrdered,
  LogOut,
  UtensilsCrossed,
  X,
} from "lucide-react";
import type { StaffNavKey } from "@/lib/permissions";

const ICONS: Record<StaffNavKey, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  tables: LayoutGrid,
  orders: ListOrdered,
  menu: BookOpen,
  sales: Banknote,
  notifications: Bell,
};

type NavItem = { key: StaffNavKey; label: string; href: string; exact: boolean };

const ALERT_CONFIG = {
  new_order: { label: "New order", Icon: ClipboardList, color: "#1a7a4a" },
  call_waiter: { label: "Waiter call", Icon: Bell, color: "#6366f1" },
  request_bill: { label: "Bill requested", Icon: UtensilsCrossed, color: "#f97316" },
} as const;

const POLL_MS = 8000;

function alertText(n: NotificationRow): { label: string; color: string; Icon: React.ComponentType<{ size?: number }> } {
  const cfg = ALERT_CONFIG[n.type as keyof typeof ALERT_CONFIG] ?? ALERT_CONFIG.call_waiter;
  const where = n.table_number
    ? ` · Table ${n.table_number}`
    : n.room_number
    ? ` · Room ${n.room_number}`
    : "";
  return { label: cfg.label + where, color: cfg.color, Icon: cfg.Icon };
}

export function StaffNav({
  restaurantName,
  displayName,
  notificationCount = 0,
  orderCount = 0,
  navItems,
}: {
  restaurantName: string;
  displayName: string;
  notificationCount?: number;
  orderCount?: number;
  navItems: NavItem[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Two independent unread counts, both from the same poll: service calls
  // (waiter/bill) drive the Notifications badge, new orders drive the Orders badge.
  const [serviceCount, setServiceCount] = useState(notificationCount);
  const [orderBadge, setOrderBadge] = useState(orderCount);
  const [toasts, setToasts] = useState<{ id: string; label: string; color: string; Icon: React.ComponentType<{ size?: number }> }[]>([]);
  // Track which notification ids we've already seen so we only alert on new ones.
  const seenIds = useRef<Set<string> | null>(null);

  // While viewing the queue, the staff member is actively seeing new orders, so
  // the Orders badge reads 0 (the server marks them seen on the queue page).
  const onOrdersPage = pathname.startsWith("/employee/queue");

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const { items } = await getMyNotifications();
        if (!active) return;

        const newRows = items.filter((n) => n.status === "new");
        setServiceCount(newRows.filter((n) => n.type !== "new_order").length);
        setOrderBadge(newRows.filter((n) => n.type === "new_order").length);

        if (seenIds.current === null) {
          // First poll: seed the baseline without alerting for pre-existing items.
          seenIds.current = new Set(newRows.map((n) => n.id));
        } else {
          const fresh = newRows.filter((n) => !seenIds.current!.has(n.id));
          if (fresh.length > 0) {
            setToasts((prev) => [
              ...fresh.map((n) => ({ id: n.id, ...alertText(n) })),
              ...prev,
            ].slice(0, 4));
            // Refresh the current page so a new order shows up in the queue, etc.
            router.refresh();
          }
          seenIds.current = new Set(newRows.map((n) => n.id));
        }
      } catch {
        // transient network / auth hiccup — keep the last known state
      }
    }

    poll();
    const iv = setInterval(poll, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-dismiss toasts after a while.
  useEffect(() => {
    if (toasts.length === 0) return;
    const t = setTimeout(() => setToasts((prev) => prev.slice(0, -1)), 6000);
    return () => clearTimeout(t);
  }, [toasts]);

  return (
    <>
      <header
        className="flex items-center gap-2 px-3 sm:px-5 py-3 border-b"
        style={{
          background: "var(--color-brand-dark)",
          borderColor: "rgba(255,255,255,0.08)",
        }}
      >
        {/* Brand / user info */}
        <div className="flex-1 min-w-0">
          <span
            className="text-sm font-medium truncate block"
            style={{ color: "#fff", letterSpacing: "-0.2px" }}
          >
            <span className="hidden sm:inline">{restaurantName}</span>
            <span className="sm:hidden" style={{ color: "rgba(255,255,255,0.6)", fontWeight: 300 }}>
              {displayName}
            </span>
          </span>
          <span className="text-xs hidden sm:block" style={{ color: "rgba(255,255,255,0.4)" }}>
            {displayName}
          </span>
        </div>

        {/* Nav */}
        <nav className="flex items-center gap-0.5">
          {navItems.map(({ key, label, href, exact }) => {
            const Icon = ICONS[key];
            const active = exact ? pathname === href : pathname.startsWith(href);
            const badge =
              key === "notifications"
                ? serviceCount
                : key === "orders"
                ? (onOrdersPage ? 0 : orderBadge)
                : 0;
            return (
              <Link
                key={href}
                href={href}
                className="relative flex items-center gap-1 px-2 sm:px-3 py-1.5 rounded-lg text-sm transition-colors"
                style={{
                  color: active ? "#fff" : "rgba(255,255,255,0.5)",
                  background: active ? "rgba(255,255,255,0.1)" : "transparent",
                }}
              >
                <Icon size={15} strokeWidth={1.5} />
                <span className="hidden xs:inline sm:inline">{label}</span>
                {badge > 0 && (
                  <span
                    className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-medium flex items-center justify-center"
                    style={{ background: "#ef4444", color: "#fff" }}
                  >
                    {badge > 9 ? "9+" : badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Logout */}
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

      {/* Live alert toasts */}
      {toasts.length > 0 && (
        <div className="fixed top-16 right-3 z-50 flex flex-col gap-2 w-[min(320px,calc(100vw-24px))]">
          {toasts.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                dismiss(t.id);
                router.push("/employee/queue");
              }}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border text-left shadow-lg"
              style={{
                background: "var(--color-canvas)",
                borderColor: t.color + "55",
                boxShadow: "0 8px 24px rgba(13,37,61,0.12)",
              }}
            >
              <span
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: t.color + "18", color: t.color }}
              >
                <t.Icon size={16} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                  {t.label}
                </span>
                <span className="block text-xs" style={{ color: "var(--color-ink-mute)" }}>
                  Tap to open the queue
                </span>
              </span>
              <span
                onClick={(e) => { e.stopPropagation(); dismiss(t.id); }}
                style={{ color: "var(--color-ink-mute)" }}
              >
                <X size={14} />
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
