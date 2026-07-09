"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createRestaurant } from "@/app/actions/restaurants";
import type { ActionResult } from "@/app/actions/restaurants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronLeft } from "lucide-react";

type BusinessType = "restaurant" | "hotel" | "restaurant_hotel";
type Tier = "free" | "basic" | "pro";

const TYPES: { value: BusinessType; label: string }[] = [
  { value: "restaurant", label: "Restaurant" },
  { value: "hotel", label: "Hotel" },
  { value: "restaurant_hotel", label: "Restaurant + Hotel" },
];

const TIERS: { value: Tier; label: string }[] = [
  { value: "free", label: "Free" },
  { value: "basic", label: "Basic" },
  { value: "pro", label: "Pro" },
];

const TIER_DEFAULTS: Record<Tier, { tables: number; rooms: number }> = {
  free:  { tables: 10,  rooms: 10  },
  basic: { tables: 30,  rooms: 30  },
  pro:   { tables: 100, rooms: 100 },
};

function toSlug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-xs font-medium uppercase tracking-wide"
      style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
    >
      {children}
    </label>
  );
}

export default function NewRestaurantPage() {
  const [state, action, pending] = useActionState<ActionResult, FormData>(
    createRestaurant,
    null
  );

  const nameRef = useRef<HTMLInputElement>(null);
  const slugRef = useRef<HTMLInputElement>(null);
  const slugTouched = useRef(false);

  const [businessType, setBusinessType] = useState<BusinessType>("restaurant");
  const [tier, setTier] = useState<Tier>("free");
  const [maxTables, setMaxTables] = useState(TIER_DEFAULTS.free.tables);
  const [maxRooms, setMaxRooms] = useState(TIER_DEFAULTS.free.rooms);
  const [orderingEnabled, setOrderingEnabled] = useState(true);
  const [qrMode, setQrMode] = useState<"ordering_enabled" | "ordering_no_pin" | "view_only">("ordering_enabled");

  useEffect(() => {
    if (state && "redirectTo" in state) {
      window.location.replace(state.redirectTo);
    }
  }, [state]);

  useEffect(() => {
    const name = nameRef.current;
    const slug = slugRef.current;
    if (!name || !slug) return;

    function onNameInput() {
      if (!slugTouched.current && slug) {
        slug.value = toSlug(name!.value);
      }
    }
    function onSlugInput() {
      slugTouched.current = true;
    }

    name.addEventListener("input", onNameInput);
    slug.addEventListener("input", onSlugInput);
    return () => {
      name.removeEventListener("input", onNameInput);
      slug.removeEventListener("input", onSlugInput);
    };
  }, []);

  function handleTierChange(newTier: Tier) {
    setTier(newTier);
    setMaxTables(TIER_DEFAULTS[newTier].tables);
    setMaxRooms(TIER_DEFAULTS[newTier].rooms);
  }

  const showTables = businessType === "restaurant" || businessType === "restaurant_hotel";
  const showRooms = businessType === "hotel" || businessType === "restaurant_hotel";
  const isNavigating = !!(state && "redirectTo" in state);
  const errorMsg = state && "error" in state ? state.error : null;

  return (
    <div className="p-8 max-w-lg">
      <Link
        href="/superadmin/dashboard"
        className="inline-flex items-center gap-1.5 text-sm mb-6"
        style={{ color: "var(--color-ink-mute)" }}
      >
        <ChevronLeft size={14} />
        Restaurants
      </Link>

      <h1
        className="text-xl mb-6"
        style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}
      >
        New business
      </h1>

      <form
        action={action}
        className="rounded-xl border px-6 py-6 flex flex-col gap-5"
        style={{
          background: "var(--color-canvas)",
          borderColor: "var(--color-hairline)",
        }}
      >
        {/* Business name */}
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="name">Business name</FieldLabel>
          <Input
            id="name"
            name="name"
            ref={nameRef}
            required
            placeholder="The Grand Hotel"
          />
        </div>

        {/* URL slug */}
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="slug">URL slug</FieldLabel>
          <div className="flex items-center">
            <span
              className="text-sm px-3 h-9 flex items-center rounded-l-sm border-y border-l shrink-0"
              style={{
                color: "var(--color-ink-mute)",
                borderColor: "var(--color-hairline-input)",
                background: "var(--color-canvas-soft)",
                fontSize: 12,
              }}
            >
              /c/
            </span>
            <Input
              id="slug"
              name="slug"
              ref={slugRef}
              required
              placeholder="grand-hotel"
              className="rounded-l-none"
              pattern="[a-z0-9-]+"
            />
          </div>
          <p className="text-xs" style={{ color: "var(--color-ink-mute)", fontSize: 11 }}>
            Lowercase letters, numbers and hyphens only
          </p>
        </div>

        {/* Business type */}
        <div className="flex flex-col gap-2">
          <FieldLabel>Business type</FieldLabel>
          <div className="flex flex-col gap-2 sm:flex-row">
            {TYPES.map((t) => {
              const active = businessType === t.value;
              return (
                <label
                  key={t.value}
                  className="flex items-center gap-2.5 cursor-pointer px-3 py-2.5 rounded-lg border flex-1 transition-colors"
                  style={{
                    borderColor: active ? "var(--color-primary)" : "var(--color-hairline-input)",
                    background: active ? "rgba(99,102,241,0.06)" : "var(--color-canvas-soft)",
                  }}
                >
                  <input
                    type="radio"
                    name="type"
                    value={t.value}
                    checked={active}
                    onChange={() => setBusinessType(t.value)}
                  />
                  <span className="text-sm" style={{ color: "var(--color-ink)" }}>
                    {t.label}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Subscription tier */}
        <div className="flex flex-col gap-2">
          <FieldLabel>Subscription tier</FieldLabel>
          <div className="flex gap-4">
            {TIERS.map((t) => (
              <label
                key={t.value}
                className="flex items-center gap-2 text-sm cursor-pointer"
                style={{ color: "var(--color-ink)" }}
              >
                <input
                  type="radio"
                  name="subscription_tier"
                  value={t.value}
                  checked={tier === t.value}
                  onChange={() => handleTierChange(t.value)}
                />
                {t.label}
              </label>
            ))}
          </div>
        </div>

        {/* Resource limits */}
        <div
          className="flex flex-col gap-4 rounded-lg border px-4 py-4"
          style={{
            borderColor: "var(--color-hairline)",
            background: "var(--color-canvas-soft)",
          }}
        >
          <p
            className="text-xs font-medium uppercase"
            style={{ color: "var(--color-ink-mute)", letterSpacing: "0.08em" }}
          >
            Resource limits
          </p>

          {showTables && (
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="max_tables">Maximum tables</FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  id="max_tables"
                  name="max_tables"
                  type="number"
                  min="1"
                  required
                  value={maxTables}
                  onChange={(e) => setMaxTables(Math.max(1, parseInt(e.target.value) || 1))}
                  className="max-w-[120px]"
                />
                <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                  tables maximum
                </span>
              </div>
            </div>
          )}

          {showRooms && (
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="max_rooms">Maximum rooms</FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  id="max_rooms"
                  name="max_rooms"
                  type="number"
                  min="1"
                  required
                  value={maxRooms}
                  onChange={(e) => setMaxRooms(Math.max(1, parseInt(e.target.value) || 1))}
                  className="max-w-[120px]"
                />
                <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                  rooms maximum
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Customer ordering configuration */}
        <div
          className="flex flex-col gap-4 rounded-lg border px-4 py-4"
          style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}
        >
          <p
            className="text-xs font-medium uppercase"
            style={{ color: "var(--color-ink-mute)", letterSpacing: "0.08em" }}
          >
            Customer ordering
          </p>

          {/* Enabled / Disabled toggle */}
          <div>
            <FieldLabel>Customer ordering via QR</FieldLabel>
            <div className="flex gap-3 mt-2">
              {([true, false] as const).map((v) => (
                <label
                  key={String(v)}
                  className="flex items-center gap-2 cursor-pointer text-sm px-3 py-2.5 rounded-lg border flex-1"
                  style={{
                    borderColor: orderingEnabled === v ? "var(--color-primary)" : "var(--color-hairline-input)",
                    background: orderingEnabled === v ? "rgba(99,102,241,0.06)" : "var(--color-canvas)",
                    color: "var(--color-ink)",
                  }}
                >
                  <input
                    type="radio"
                    name="customer_ordering_enabled"
                    value={String(v)}
                    checked={orderingEnabled === v}
                    onChange={() => setOrderingEnabled(v)}
                    className="accent-indigo-500"
                  />
                  <span>
                    <span className="font-medium block text-xs">{v ? "Enabled" : "Disabled"}</span>
                    <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                      {v
                        ? "Customers can place orders after PIN"
                        : "Customers can browse only — no ordering"}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Ordering mode */}
          <div style={{ opacity: orderingEnabled ? 1 : 0.4, pointerEvents: orderingEnabled ? "auto" : "none" }}>
            <FieldLabel>Ordering mode</FieldLabel>
            <div className="flex flex-col gap-2 mt-2">
              {(
                [
                  {
                    value: "ordering_enabled" as const,
                    label: "Menu + Ordering (With PIN)",
                    desc: "Browse menu, place orders after entering a table PIN",
                  },
                  {
                    value: "ordering_no_pin" as const,
                    label: "Menu + Ordering (Without PIN)",
                    desc: "Browse menu, place orders instantly — no PIN required",
                  },
                  {
                    value: "view_only" as const,
                    label: "Menu Only",
                    desc: "Browse menu — no ordering or waiter call",
                  },
                ] as const
              ).map(({ value, label, desc }) => (
                <label
                  key={value}
                  className="flex items-center gap-2 cursor-pointer text-sm px-3 py-2.5 rounded-lg border flex-1"
                  style={{
                    borderColor: qrMode === value ? "var(--color-primary)" : "var(--color-hairline-input)",
                    background: qrMode === value ? "rgba(99,102,241,0.06)" : "var(--color-canvas)",
                    color: "var(--color-ink)",
                  }}
                >
                  <input
                    type="radio"
                    name="qr_mode"
                    value={value}
                    checked={qrMode === value}
                    onChange={() => setQrMode(value)}
                    className="accent-indigo-500"
                  />
                  <span>
                    <span className="font-medium block text-xs">{label}</span>
                    <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>{desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {errorMsg && (
          <p
            className="text-sm rounded-md px-3 py-2"
            style={{ color: "var(--color-ruby)", background: "#fff0f4" }}
          >
            {errorMsg}
          </p>
        )}

        <div className="flex gap-3 pt-1">
          <Button
            type="submit"
            variant="primary"
            disabled={pending || isNavigating}
          >
            {pending || isNavigating ? "Creating…" : "Create business"}
          </Button>
          <Link href="/superadmin/dashboard">
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
