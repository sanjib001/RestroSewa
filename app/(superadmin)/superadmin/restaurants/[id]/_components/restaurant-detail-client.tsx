"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink, Pencil } from "lucide-react";
import type { RestaurantDetail } from "@/app/actions/restaurants";
import { EditRestaurantForm } from "./edit-restaurant-form";
import { toggleRestaurantStatus } from "@/app/actions/restaurants";
import { Button } from "@/components/ui/button";

const TYPE_LABELS: Record<string, string> = {
  restaurant: "Restaurant",
  hotel: "Hotel",
  restaurant_hotel: "Restaurant + Hotel",
  cafe: "Café",
  lodge: "Lodge",
  guesthouse: "Guesthouse",
  resort: "Resort",
};

function Badge({
  children,
  color = "var(--color-ink-mute)",
}: {
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border"
      style={{ color, borderColor: color + "44", background: color + "11", fontSize: 11 }}
    >
      {children}
    </span>
  );
}

export function RestaurantDetailClient({ restaurant }: { restaurant: RestaurantDetail }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return <EditRestaurantForm restaurant={restaurant} onClose={() => setEditing(false)} />;
  }

  return (
    <div
      className="rounded-xl border px-6 py-5 mb-6"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1
            className="text-xl"
            style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}
          >
            {restaurant.name}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
            /c/{restaurant.slug}
          </p>
        </div>
        <div className="flex items-center gap-2 pt-0.5">
          <Badge color={restaurant.is_active ? "#1a7a4a" : "#d1d5db"}>
            {restaurant.is_active ? "Active" : "Inactive"}
          </Badge>
          <Badge>{TYPE_LABELS[restaurant.type] ?? restaurant.type}</Badge>
          <Badge
            color={
              restaurant.subscription_tier === "pro"
                ? "var(--color-primary)"
                : restaurant.subscription_tier === "basic"
                ? "#1a7a4a"
                : "var(--color-ink-mute)"
            }
          >
            {restaurant.subscription_tier.toUpperCase()}
          </Badge>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="ml-1 p-1.5 rounded-md transition-colors"
            style={{ color: "var(--color-ink-mute)", background: "var(--color-canvas-soft)" }}
            title="Edit restaurant"
          >
            <Pencil size={13} />
          </button>
        </div>
      </div>

      <div
        className="mt-4 pt-4 border-t grid grid-cols-2 gap-4 text-sm"
        style={{ borderColor: "var(--color-hairline)" }}
      >
        <div>
          <p style={{ color: "var(--color-ink-mute)", fontSize: 11 }}>CUSTOMER URL</p>
          <Link
            href={`/c/${restaurant.slug}`}
            target="_blank"
            className="flex items-center gap-1 mt-0.5"
            style={{ color: "var(--color-primary)" }}
          >
            /c/{restaurant.slug} <ExternalLink size={11} />
          </Link>
        </div>
        <div>
          <p style={{ color: "var(--color-ink-mute)", fontSize: 11 }}>STAFF LOGIN</p>
          <Link
            href={`/login?mode=staff&slug=${restaurant.slug}`}
            target="_blank"
            className="flex items-center gap-1 mt-0.5"
            style={{ color: "var(--color-primary)" }}
          >
            /login?mode=staff&amp;slug={restaurant.slug} <ExternalLink size={11} />
          </Link>
        </div>
        {restaurant.max_tables != null && (
          <div>
            <p style={{ color: "var(--color-ink-mute)", fontSize: 11 }}>MAX TABLES</p>
            <p className="mt-0.5" style={{ color: "var(--color-ink)" }}>{restaurant.max_tables}</p>
          </div>
        )}
        {restaurant.max_rooms != null && (
          <div>
            <p style={{ color: "var(--color-ink-mute)", fontSize: 11 }}>MAX ROOMS</p>
            <p className="mt-0.5" style={{ color: "var(--color-ink)" }}>{restaurant.max_rooms}</p>
          </div>
        )}
        {restaurant.contact_phone && (
          <div>
            <p style={{ color: "var(--color-ink-mute)", fontSize: 11 }}>PHONE</p>
            <p className="mt-0.5" style={{ color: "var(--color-ink)" }}>{restaurant.contact_phone}</p>
          </div>
        )}
        {restaurant.contact_email && (
          <div>
            <p style={{ color: "var(--color-ink-mute)", fontSize: 11 }}>EMAIL</p>
            <p className="mt-0.5" style={{ color: "var(--color-ink)" }}>{restaurant.contact_email}</p>
          </div>
        )}
        {restaurant.address && (
          <div className="col-span-2">
            <p style={{ color: "var(--color-ink-mute)", fontSize: 11 }}>ADDRESS</p>
            <p className="mt-0.5" style={{ color: "var(--color-ink)" }}>{restaurant.address}</p>
          </div>
        )}
        {restaurant.pan_vat_number && (
          <div>
            <p style={{ color: "var(--color-ink-mute)", fontSize: 11 }}>PAN / VAT</p>
            <p className="mt-0.5" style={{ color: "var(--color-ink)" }}>{restaurant.pan_vat_number}</p>
          </div>
        )}
        <div>
          <p style={{ color: "var(--color-ink-mute)", fontSize: 11 }}>QR ORDERING</p>
          <p className="mt-0.5" style={{ color: "var(--color-ink)" }}>
            {restaurant.customer_ordering_enabled === false
              ? "Disabled"
              : restaurant.qr_mode === "view_only"
              ? "View Menu Only"
              : restaurant.qr_mode === "ordering_no_pin"
              ? "Ordering Enabled (No PIN)"
              : "Ordering Enabled (With PIN)"}
          </p>
        </div>
      </div>
    </div>
  );
}
