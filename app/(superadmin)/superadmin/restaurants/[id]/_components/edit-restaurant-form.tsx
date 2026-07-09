"use client";

import { useActionState, useEffect } from "react";
import { updateRestaurant } from "@/app/actions/restaurants";
import type { ActionResult, RestaurantDetail } from "@/app/actions/restaurants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";

const labelCls = "text-xs uppercase tracking-wide font-medium";
const labelStyle = { color: "var(--color-ink-mute)", letterSpacing: "0.06em" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className={labelCls} style={labelStyle}>{label}</p>
      {children}
    </div>
  );
}

export function EditRestaurantForm({
  restaurant,
  onClose,
}: {
  restaurant: RestaurantDetail;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(updateRestaurant, null);
  const saved = state === null && !pending;

  useEffect(() => {
    if (state === null && !pending) {
      // null state after a submit means success — close
    }
  }, [state, pending]);

  return (
    <form
      action={action}
      className="rounded-xl border px-6 py-5 flex flex-col gap-5"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-primary)", borderWidth: 1.5 }}
    >
      <input type="hidden" name="id" value={restaurant.id} />

      <div className="flex items-center justify-between">
        <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
          Edit restaurant
        </p>
        <button type="button" onClick={onClose} style={{ color: "var(--color-ink-mute)" }}>
          <X size={16} />
        </button>
      </div>

      {/* ── Business Info ── */}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Business Name">
          <Input name="name" defaultValue={restaurant.name} required />
        </Field>
        <Field label="PAN / VAT Number">
          <Input name="pan_vat_number" defaultValue={restaurant.pan_vat_number ?? ""} placeholder="Optional" />
        </Field>
        <Field label="Contact Phone">
          <Input name="contact_phone" defaultValue={restaurant.contact_phone ?? ""} placeholder="Optional" />
        </Field>
        <Field label="Contact Email">
          <Input name="contact_email" type="email" defaultValue={restaurant.contact_email ?? ""} placeholder="Optional" />
        </Field>
        <div className="col-span-2">
          <Field label="Address">
            <Input name="address" defaultValue={restaurant.address ?? ""} placeholder="Optional" />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Logo URL">
            <Input name="logo_url" defaultValue={restaurant.logo_url ?? ""} placeholder="https://…" />
          </Field>
        </div>
      </div>

      {/* ── Subscription ── */}
      <div className="grid grid-cols-3 gap-4 pt-3 border-t" style={{ borderColor: "var(--color-hairline)" }}>
        <Field label="Subscription Plan">
          <select
            name="subscription_tier"
            defaultValue={restaurant.subscription_tier}
            className="h-9 rounded-sm border px-3 text-sm"
            style={{ borderColor: "var(--color-hairline-input)", color: "var(--color-ink)", background: "var(--color-canvas)" }}
          >
            <option value="free">Free</option>
            <option value="basic">Basic</option>
            <option value="pro">Pro</option>
          </select>
        </Field>
        <Field label="Max Tables">
          <Input name="max_tables" type="number" min="0" defaultValue={restaurant.max_tables ?? ""} placeholder="Unlimited" />
        </Field>
        <Field label="Max Rooms">
          <Input name="max_rooms" type="number" min="0" defaultValue={restaurant.max_rooms ?? ""} placeholder="Unlimited" />
        </Field>
      </div>

      {/* ── Ordering Config ── */}
      <div className="flex flex-col gap-3 pt-3 border-t" style={{ borderColor: "var(--color-hairline)" }}>
        <p className={labelCls} style={labelStyle}>Ordering Configuration</p>

        <label className="flex items-center gap-3 cursor-pointer text-sm" style={{ color: "var(--color-ink)" }}>
          <div className="relative">
            <input
              type="checkbox"
              name="customer_ordering_enabled"
              value="true"
              defaultChecked={restaurant.customer_ordering_enabled !== false}
              className="sr-only peer"
              onChange={() => {}}
            />
            <div
              className="w-9 h-5 rounded-full peer-checked:bg-indigo-500 transition-colors"
              style={{ background: "var(--color-hairline)" }}
            />
            <div className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
          </div>
          Customer ordering enabled (via QR)
        </label>

        <div className="flex flex-col gap-2">
          {([
            {
              value: "ordering_enabled" as const,
              label: "Menu + Ordering (With PIN)",
              desc: "Customers place orders after entering a table PIN",
            },
            {
              value: "ordering_no_pin" as const,
              label: "Menu + Ordering (Without PIN)",
              desc: "Customers place orders instantly — no PIN required",
            },
            {
              value: "view_only" as const,
              label: "View Menu Only",
              desc: "Customers can only browse the menu",
            },
          ]).map(({ value, label, desc }) => (
            <label
              key={value}
              className="flex items-center gap-2 cursor-pointer text-sm px-3 py-2 rounded-lg border flex-1"
              style={{
                borderColor: "var(--color-hairline)",
                color: "var(--color-ink)",
                background: "var(--color-canvas-soft)",
              }}
            >
              <input
                type="radio"
                name="qr_mode"
                value={value}
                defaultChecked={restaurant.qr_mode === value || (!restaurant.qr_mode && value === "ordering_enabled")}
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

      {/* ── Status ── */}
      <div className="flex items-center gap-3 pt-3 border-t" style={{ borderColor: "var(--color-hairline)" }}>
        <p className={labelCls} style={labelStyle}>Business Status</p>
        <div className="flex gap-2 ml-auto">
          {([true, false] as const).map((v) => (
            <label
              key={String(v)}
              className="flex items-center gap-1.5 cursor-pointer text-xs px-3 py-1.5 rounded-lg border"
              style={{
                borderColor: "var(--color-hairline)",
                color: "var(--color-ink)",
                background: "var(--color-canvas-soft)",
              }}
            >
              <input
                type="radio"
                name="is_active"
                value={String(v)}
                defaultChecked={restaurant.is_active === v}
                className="accent-indigo-500"
              />
              {v ? "Active" : "Inactive"}
            </label>
          ))}
        </div>
      </div>

      {state && "error" in state && (
        <p className="text-sm" style={{ color: "var(--color-ruby)" }}>{state.error}</p>
      )}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        {saved && <p className="text-sm self-center" style={{ color: "#1a7a4a" }}>Saved</p>}
      </div>
    </form>
  );
}
