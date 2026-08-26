import Link from "next/link";
import { getAllRestaurants } from "@/app/actions/restaurants";
import type { RestaurantRow } from "@/app/actions/restaurants";
import { Button } from "@/components/ui/button";
import { RestaurantLogo } from "@/components/branding/restaurant-logo";
import { Plus } from "lucide-react";

const TIER_COLORS: Record<string, string> = {
  free: "#64748d",
  basic: "#1a7a4a",
  pro: "#533afd",
};

const TYPE_LABELS: Record<string, string> = {
  restaurant: "Restaurant",
  hotel: "Hotel",
  restaurant_hotel: "Restaurant + Hotel",
  cafe: "Café",
  lodge: "Lodge",
  guesthouse: "Guesthouse",
  resort: "Resort",
};

function RestaurantCard({ r }: { r: RestaurantRow }) {
  return (
    <Link
      href={`/superadmin/restaurants/${r.id}`}
      className="flex items-center gap-4 px-5 py-4 rounded-xl border transition-colors"
      style={{
        background: "var(--color-canvas)",
        borderColor: "var(--color-hairline)",
      }}
    >
      <div
        className="w-2 h-2 rounded-full shrink-0"
        style={{ background: r.is_active ? "#1a7a4a" : "#d1d5db" }}
      />

      <RestaurantLogo name={r.name} logoUrl={r.logo_url} size={34} />

      <div className="flex-1 min-w-0">
        <p
          className="text-sm font-medium truncate"
          style={{ color: "var(--color-ink)" }}
        >
          {r.name}
        </p>
        <p className="text-xs truncate" style={{ color: "var(--color-ink-mute)" }}>
          hrestrosewa.com/c/{r.slug}
        </p>
      </div>

      {/* Dropped below sm: dot + logo + type pill + tier already crowd a phone
          width down to almost nothing for the name — the one thing on this row
          that actually varies and needs the space. */}
      <span
        className="hidden sm:inline-block text-xs px-2 py-0.5 rounded-full border shrink-0"
        style={{
          color: "var(--color-ink-mute)",
          borderColor: "var(--color-hairline)",
          fontSize: 11,
        }}
      >
        {TYPE_LABELS[r.type] ?? r.type}
      </span>

      <span
        className="text-xs font-medium shrink-0"
        style={{ color: TIER_COLORS[r.subscription_tier] ?? "#64748d" }}
      >
        {r.subscription_tier.toUpperCase()}
      </span>
    </Link>
  );
}

export default async function SuperAdminDashboardPage() {
  const restaurants = await getAllRestaurants();

  return (
    <div className="p-4 sm:p-8 max-w-3xl">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
        <div>
          <h1
            className="text-xl"
            style={{
              color: "var(--color-ink)",
              fontWeight: 300,
              letterSpacing: "-0.4px",
            }}
          >
            Restaurants
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
            {restaurants.length} total
          </p>
        </div>
        <Link href="/superadmin/restaurants/new">
          <Button variant="primary" className="flex items-center gap-2">
            <Plus size={15} strokeWidth={2} />
            New restaurant
          </Button>
        </Link>
      </div>

      {restaurants.length === 0 ? (
        <div
          className="rounded-xl border px-8 py-16 text-center"
          style={{
            background: "var(--color-canvas)",
            borderColor: "var(--color-hairline)",
            borderStyle: "dashed",
          }}
        >
          <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
            No restaurants yet.
          </p>
          <Link href="/superadmin/restaurants/new" className="mt-3 inline-block">
            <Button variant="secondary">Create first restaurant</Button>
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {restaurants.map((r) => (
            <RestaurantCard key={r.id} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}
