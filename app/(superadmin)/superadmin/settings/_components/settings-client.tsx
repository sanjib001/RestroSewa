"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { getRestaurantWithStaff, toggleRestaurantStatus } from "@/app/actions/restaurants";
import type { RestaurantRow, StaffRow } from "@/app/actions/restaurants";
import { resetStaffPin } from "@/app/actions/staff";
import { Button } from "@/components/ui/button";
import { ExternalLink, KeyRound, Power, PowerOff, ShieldCheck, X, Check } from "lucide-react";

const PIN_LENGTH = 4;
const KEYPAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"] as const;

// ─── PIN keypad ────────────────────────────────────────────────────────────────

function PinEntry({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex gap-2 items-center">
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <div
            key={i}
            className="w-8 h-8 rounded border flex items-center justify-center text-sm font-medium"
            style={{
              borderColor: i < value.length ? "var(--color-primary)" : "var(--color-hairline-input)",
              background: "var(--color-canvas-soft)",
              color: "var(--color-ink)",
            }}
          >
            {i < value.length ? "•" : ""}
          </div>
        ))}
        {value.length > 0 && (
          <button
            type="button"
            className="ml-1 text-xs px-2"
            style={{ color: "var(--color-ink-mute)" }}
            onClick={() => onChange("")}
          >
            Clear
          </button>
        )}
      </div>
      <div className="grid grid-cols-6 gap-1.5 w-48">
        {KEYPAD.map((key, i) => {
          if (key === "") return <div key={i} />;
          if (key === "⌫") {
            return (
              <button
                key={i}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onChange(value.slice(0, -1))}
                className="col-span-2 h-8 rounded text-sm flex items-center justify-center"
                style={{ background: "var(--color-hairline)", color: "var(--color-ink-mute)" }}
              >
                ⌫
              </button>
            );
          }
          return (
            <button
              key={i}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => value.length < PIN_LENGTH && onChange(value + key)}
              className="col-span-2 h-8 rounded text-sm flex items-center justify-center"
              style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink)" }}
            >
              {key}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Staff row with inline PIN reset ─────────────────────────────────────────────

function StaffPinRow({ s }: { s: StaffRow }) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initials = s.display_name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  function apply() {
    setError(null);
    startTransition(async () => {
      const r = await resetStaffPin(s.id, s.auth_user_id, pin);
      if (r && "error" in r) {
        setError(r.error);
        return;
      }
      setDone(true);
      setPin("");
      setOpen(false);
      setTimeout(() => setDone(false), 4000);
    });
  }

  return (
    <div
      className="rounded-lg border"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)", opacity: s.is_active ? 1 : 0.6 }}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium shrink-0"
          style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}
        >
          {initials}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink)" }}>
            {s.display_name}
          </p>
          <p className="text-xs truncate" style={{ color: "var(--color-ink-mute)" }}>
            {s.title || s.role.replace("restaurant_", "").replace("_", " ")}
          </p>
        </div>

        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border shrink-0"
          style={{
            color: s.role === "restaurant_admin" ? "var(--color-primary)" : "var(--color-ink-mute)",
            borderColor: (s.role === "restaurant_admin" ? "var(--color-primary)" : "var(--color-ink-mute)") + "44",
            fontSize: 11,
          }}
        >
          {s.role === "restaurant_admin" ? <ShieldCheck size={11} /> : null}
          {s.role === "restaurant_admin" ? "Admin" : "Staff"}
        </span>

        {!s.is_active && (
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink-mute)" }}>
            Disabled
          </span>
        )}

        {done ? (
          <span className="inline-flex items-center gap-1 text-xs shrink-0" style={{ color: "#1a7a4a" }}>
            <Check size={13} /> PIN updated
          </span>
        ) : (
          <button
            type="button"
            onClick={() => { setOpen((o) => !o); setPin(""); setError(null); }}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border shrink-0"
            style={{
              color: open ? "var(--color-ink-mute)" : "var(--color-primary)",
              borderColor: open ? "var(--color-hairline)" : "var(--color-primary)",
              background: open ? "var(--color-canvas-soft)" : "rgba(99,102,241,0.06)",
            }}
          >
            {open ? <X size={12} /> : <KeyRound size={12} />}
            {open ? "Cancel" : "Reset PIN"}
          </button>
        )}
      </div>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t" style={{ borderColor: "var(--color-hairline)" }}>
          <p className="text-xs mb-2 mt-3" style={{ color: "var(--color-ink-mute)" }}>
            Enter a new 4-digit login PIN for {s.display_name}. They can sign in with it immediately.
          </p>
          <PinEntry value={pin} onChange={setPin} />
          {error && (
            <p className="text-xs mt-2" style={{ color: "var(--color-ruby)" }}>{error}</p>
          )}
          <div className="mt-3">
            <Button
              type="button"
              variant="primary"
              disabled={pin.length !== PIN_LENGTH || pending}
              onClick={apply}
            >
              {pending ? "Updating…" : "Set new PIN"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main client ─────────────────────────────────────────────────────────────

type Detail = { restaurant: { id: string; name: string; slug: string; is_active: boolean }; staff: StaffRow[] };

export function SettingsClient({ restaurants }: { restaurants: RestaurantRow[] }) {
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, startLoad] = useTransition();
  const [statusPending, startStatus] = useTransition();

  function selectRestaurant(id: string) {
    setSelectedId(id);
    setDetail(null);
    if (!id) return;
    startLoad(async () => {
      const d = await getRestaurantWithStaff(id);
      if (d) {
        setDetail({
          restaurant: {
            id: d.restaurant.id,
            name: d.restaurant.name,
            slug: d.restaurant.slug,
            is_active: d.restaurant.is_active,
          },
          staff: d.staff,
        });
      }
    });
  }

  function toggleActive() {
    if (!detail) return;
    const makeActive = !detail.restaurant.is_active;
    startStatus(async () => {
      await toggleRestaurantStatus(detail.restaurant.id, makeActive);
      setDetail((prev) =>
        prev ? { ...prev, restaurant: { ...prev.restaurant, is_active: makeActive } } : prev
      );
    });
  }

  const admins = detail?.staff.filter((s) => s.role === "restaurant_admin") ?? [];
  const employees = detail?.staff.filter((s) => s.role === "restaurant_employee") ?? [];

  return (
    <div className="flex flex-col gap-6">
      {/* Restaurant selector */}
      <div
        className="rounded-xl border px-5 py-4"
        style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
      >
        <label
          className="text-xs uppercase tracking-wide font-medium block mb-2"
          style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
        >
          Select a restaurant
        </label>
        <select
          value={selectedId}
          onChange={(e) => selectRestaurant(e.target.value)}
          className="w-full h-10 rounded-sm border px-3 text-sm"
          style={{ borderColor: "var(--color-hairline-input)", color: "var(--color-ink)", background: "var(--color-canvas)" }}
        >
          <option value="">Choose a restaurant…</option>
          {restaurants.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}{r.is_active ? "" : " (inactive)"}
            </option>
          ))}
        </select>
      </div>

      {loading && (
        <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>Loading…</p>
      )}

      {detail && (
        <>
          {/* Account management */}
          <div
            className="rounded-xl border px-5 py-4"
            style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
          >
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                Restaurant account
              </p>
              <Link
                href={`/superadmin/restaurants/${detail.restaurant.id}`}
                className="inline-flex items-center gap-1 text-xs"
                style={{ color: "var(--color-primary)" }}
              >
                Open full restaurant page <ExternalLink size={12} />
              </Link>
            </div>
            <p className="text-xs mb-3" style={{ color: "var(--color-ink-mute)" }}>
              {detail.restaurant.name} · restrosewa.com/c/{detail.restaurant.slug}
            </p>

            <div
              className="flex items-center gap-3 rounded-lg border px-4 py-3"
              style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}
            >
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: detail.restaurant.is_active ? "#1a7a4a" : "#d1d5db" }}
              />
              <div className="flex-1">
                <p className="text-sm" style={{ color: "var(--color-ink)" }}>
                  {detail.restaurant.is_active ? "Active" : "Inactive"}
                </p>
                <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                  {detail.restaurant.is_active
                    ? "Customers and staff can access this restaurant."
                    : "Access is suspended — the customer menu and logins are blocked."}
                </p>
              </div>
              <button
                type="button"
                onClick={toggleActive}
                disabled={statusPending}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border"
                style={{
                  color: detail.restaurant.is_active ? "#b45309" : "#1a7a4a",
                  borderColor: (detail.restaurant.is_active ? "#b45309" : "#1a7a4a") + "55",
                  background: (detail.restaurant.is_active ? "#b45309" : "#1a7a4a") + "0f",
                }}
              >
                {detail.restaurant.is_active ? <PowerOff size={13} /> : <Power size={13} />}
                {statusPending ? "Saving…" : detail.restaurant.is_active ? "Deactivate" : "Activate"}
              </button>
            </div>
          </div>

          {/* PIN reset */}
          <div
            className="rounded-xl border px-5 py-4"
            style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
          >
            <p className="text-sm font-medium mb-1" style={{ color: "var(--color-ink)" }}>
              Reset login PINs
            </p>
            <p className="text-xs mb-4" style={{ color: "var(--color-ink-mute)" }}>
              Assign a new 4-digit PIN to any admin or staff member. The change takes effect immediately.
            </p>

            {detail.staff.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
                No staff accounts yet.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {admins.length > 0 && (
                  <div>
                    <p className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
                      Restaurant Admin
                    </p>
                    <div className="flex flex-col gap-1.5">
                      {admins.map((s) => <StaffPinRow key={s.id} s={s} />)}
                    </div>
                  </div>
                )}
                {employees.length > 0 && (
                  <div>
                    <p className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
                      Staff
                    </p>
                    <div className="flex flex-col gap-1.5">
                      {employees.map((s) => <StaffPinRow key={s.id} s={s} />)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
