import { requireRestaurantAdmin } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/service";
import { getDashboardAnalytics } from "@/app/actions/analytics";
import { StockFinanceOverview } from "./_components/stock-finance-overview";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import Link from "next/link";
import { BookOpen, LayoutGrid, Zap, Users } from "lucide-react";

type StatCard = {
  label: string;
  value: number;
  href: string;
  icon: React.ElementType;
};

function StatCard({ label, value, href, icon: Icon }: StatCard) {
  return (
    <Link
      href={href}
      className="rounded-xl border px-5 py-5 flex items-center gap-4 transition-colors"
      style={{
        background: "var(--color-canvas)",
        borderColor: "var(--color-hairline)",
      }}
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: "var(--color-canvas-soft)" }}
      >
        <Icon size={18} strokeWidth={1.5} style={{ color: "var(--color-primary)" }} />
      </div>
      <div>
        <p
          className="text-2xl"
          style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.5px" }}
        >
          {value}
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
          {label}
        </p>
      </div>
    </Link>
  );
}

export default async function AdminDashboardPage() {
  const { restaurantUser } = await requireRestaurantAdmin();
  const { restaurant_id } = restaurantUser;

  const service = createServiceClient();

  const analytics = await getDashboardAnalytics();

  const [menuItemsRes, categoriesRes, tablesRes, workstationsRes, staffRes] =
    await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any)
        .from("menu_items")
        .select("id", { count: "exact", head: true })
        .eq("restaurant_id", restaurant_id)
        .eq("is_available", true),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any)
        .from("menu_categories")
        .select("id", { count: "exact", head: true })
        .eq("restaurant_id", restaurant_id)
        .eq("is_active", true),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any)
        .from("restaurant_tables")
        .select("id", { count: "exact", head: true })
        .eq("restaurant_id", restaurant_id)
        .eq("is_active", true),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any)
        .from("workstations")
        .select("id", { count: "exact", head: true })
        .eq("restaurant_id", restaurant_id)
        .eq("is_active", true),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any)
        .from("restaurant_users")
        .select("id", { count: "exact", head: true })
        .eq("restaurant_id", restaurant_id)
        .eq("is_active", true),
    ]);

  const stats: StatCard[] = [
    {
      label: "Menu items",
      value: menuItemsRes.count ?? 0,
      href: "/admin/menu",
      icon: BookOpen,
    },
    {
      label: "Categories",
      value: categoriesRes.count ?? 0,
      href: "/admin/menu",
      icon: BookOpen,
    },
    {
      label: "Active tables",
      value: tablesRes.count ?? 0,
      href: "/admin/tables",
      icon: LayoutGrid,
    },
    {
      label: "Workstations",
      value: workstationsRes.count ?? 0,
      href: "/admin/workstations",
      icon: Zap,
    },
    {
      label: "Staff members",
      value: staffRes.count ?? 0,
      href: "/admin/staff",
      icon: Users,
    },
  ];

  return (
    <div className="p-4 md:p-8">
      {/* Live stats: any sale, purchase, stock move or credit change re-runs this
          page in place, so the admin never refreshes to see today's numbers. */}
      <RealtimeRefresh
        topics={["billing", "credits", "stock", "purchases", "vendors", "finance", "orders", "tables"]}
      />

      <h1
        className="text-xl mb-1"
        style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}
      >
        Overview
      </h1>
      <p className="text-sm mb-8" style={{ color: "var(--color-ink-mute)" }}>
        {restaurantUser.display_name} · Restaurant Admin
      </p>

      <div className="grid grid-cols-2 gap-3 max-w-xl">
        {stats.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>

      {/* Stock & Finance analytics — every figure derived from the POS, purchases
          and credit ledgers; nothing is stored twice. */}
      <StockFinanceOverview data={analytics} />

      {/* Quick links */}
      <div className="mt-10 max-w-xl">
        <p
          className="text-xs uppercase tracking-wide mb-3"
          style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
        >
          Quick setup
        </p>
        <div className="flex flex-col gap-2">
          {[
            { href: "/admin/workstations", label: "1. Set up workstations (Kitchen, Bar, etc.)" },
            { href: "/admin/menu", label: "2. Build your menu categories & items" },
            { href: "/admin/tables", label: "3. Add your tables" },
          ].map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="text-sm px-4 py-3 rounded-lg border flex items-center gap-2"
              style={{
                color: "var(--color-ink)",
                borderColor: "var(--color-hairline)",
                background: "var(--color-canvas)",
              }}
            >
              <span style={{ color: "var(--color-primary)" }}>→</span>
              {label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
