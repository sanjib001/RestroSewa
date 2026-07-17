"use client";

import {
  useState,
  useActionState,
  useTransition,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { useRouter } from "next/navigation";
import {
  createCategory,
  updateCategory,
  createMenuItem,
  updateMenuItem,
  softDeleteMenuItem,
  toggleCategoryStatus,
  toggleItemAvailability,
  deleteCategory,
  moveCategory,
  createVariant,
  updateVariant,
  deleteVariant,
  createAddon,
  deleteAddon,
  getItemVariantsAndAddons,
} from "@/app/actions/menu";
import type {
  ActionResult,
  CategoryRow,
  MenuItemRow,
  VariantRow,
  AddonRow,
} from "@/app/actions/menu";
import type { WorkstationRow } from "@/app/actions/workstations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FoodMark } from "@/components/ui/food-mark";
import { FOOD_TYPES, FOOD_TYPE_KEYS, type FoodType } from "@/lib/food-types";
import { assignCategoryHues, styleOf, type CategoryHue } from "@/lib/category-colors";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Loader2,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// The food-type picker. The selected type fills with its own colour, so the
// choice is legible at a glance while you're still typing the item — the radios
// used to be `sr-only` with no rendered selected state at all, which is why the
// selection appeared not to register until you saved.
function FoodTypePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (t: FoodType) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {FOOD_TYPE_KEYS.map((ft) => {
        const cfg = FOOD_TYPES[ft];
        const selected = value === ft;
        return (
          <button
            key={ft}
            type="button"
            onClick={() => onChange(ft)}
            aria-pressed={selected}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-colors"
            style={{
              borderColor: selected ? cfg.color : "var(--color-hairline)",
              background: selected ? cfg.soft : "transparent",
              color: selected ? cfg.color : "var(--color-ink-mute)",
              fontWeight: selected ? 500 : 400,
            }}
          >
            <FoodMark type={ft} size={13} />
            {cfg.label}
          </button>
        );
      })}
    </div>
  );
}

const STATUS_CONFIG = {
  available: { color: "var(--color-success)", bg: "var(--color-success-bg)", label: "Available" },
  out_of_stock: { color: "var(--color-warning)", bg: "var(--color-warning-bg)", label: "Out of Stock" },
  hidden: { color: "#6b7280", bg: "var(--color-canvas-soft)", label: "Hidden" },
} as const;

const BADGE_OPTIONS = ["Featured", "Chef's Recommendation", "Best Seller", "New"] as const;
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG];
  if (!cfg) return null;
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-xs"
      style={{ color: cfg.color, background: cfg.bg, fontSize: 10 }}
    >
      {cfg.label}
    </span>
  );
}

// ─── Add Category Form ────────────────────────────────────────────────────────

function AddCategoryForm({
  restaurantId,
  workstations,
  onClose,
}: {
  restaurantId: string;
  workstations: WorkstationRow[];
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(createCategory, null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => { if (pending) setSubmitted(true); }, [pending]);
  useEffect(() => {
    if (submitted && !pending && state === null) onClose();
  }, [submitted, pending, state, onClose]);

  return (
    <form
      action={action}
      className="rounded-xl border px-5 py-5 flex flex-col gap-4"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-primary)", borderWidth: 1.5 }}
    >
      <input type="hidden" name="restaurant_id" value={restaurantId} />
      <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
        New category
      </p>
      <Input name="name" placeholder="e.g. Starters, Main Course, Beverages…" required />
      <div className="flex flex-col gap-1.5">
        <label className="text-xs uppercase tracking-wide" style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
          Workstation
        </label>
        <select
          name="workstation_id"
          required
          className="h-9 rounded-sm border px-3 text-sm"
          style={{ borderColor: "var(--color-hairline-input)", color: "var(--color-ink)", background: "var(--color-canvas)" }}
        >
          <option value="">Select workstation…</option>
          {workstations.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
      </div>
      {state?.error && (
        <p className="text-sm" style={{ color: "var(--color-ruby)" }}>{state.error}</p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Creating…" : "Create"}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}

// ─── Add Item Form ────────────────────────────────────────────────────────────

function AddItemForm({
  restaurantId,
  categoryId,
  onClose,
}: {
  restaurantId: string;
  categoryId: string;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(createMenuItem, null);
  const [submitted, setSubmitted] = useState(false);
  const [foodType, setFoodType] = useState<FoodType>("veg");

  useEffect(() => { if (pending) setSubmitted(true); }, [pending]);
  useEffect(() => {
    if (submitted && !pending && state === null) onClose();
  }, [submitted, pending, state, onClose]);

  return (
    <form
      action={action}
      className="mt-2 rounded-lg border px-4 py-4 flex flex-col gap-3"
      style={{ background: "var(--color-canvas-soft)", borderColor: "var(--color-hairline)" }}
    >
      <input type="hidden" name="restaurant_id" value={restaurantId} />
      <input type="hidden" name="category_id" value={categoryId} />
      <input type="hidden" name="food_type" value={foodType} />
      <div className="flex flex-col sm:flex-row gap-2">
        <Input name="name" placeholder="Item name" required className="flex-1" />
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: "var(--color-ink-mute)" }}>
            ₹
          </span>
          <Input name="price" type="number" min="0" step="0.01" placeholder="0" required className="pl-7 w-full sm:w-28" />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Food type</label>
        <FoodTypePicker value={foodType} onChange={setFoodType} />
      </div>
      <Input name="description" placeholder="Description (optional)" />
      {state?.error && (
        <p className="text-xs" style={{ color: "var(--color-ruby)" }}>{state.error}</p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending} className="text-xs py-1.5 px-3 h-7">
          {pending ? "Adding…" : "Add item"}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose} className="text-xs py-1.5 px-3 h-7">
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ─── Variant line ─────────────────────────────────────────────────────────────

// One variant, readable by default and editable in place. Editing a variant used
// to be impossible — you could only add or delete one, so fixing a typo or a
// price meant deleting the row and retyping it (and taking it off any menu that
// referenced it in the meantime).
function VariantLine({
  variant,
  onChanged,
  onDelete,
}: {
  variant: VariantRow;
  onChanged: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [state, dispatch, pending] = useActionState<ActionResult, FormData>(updateVariant, null);
  const [submitted, setSubmitted] = useState(false);
  const [, startToggle] = useTransition();

  useEffect(() => { if (pending) setSubmitted(true); }, [pending]);
  useEffect(() => {
    if (submitted && !pending && state === null) {
      setSubmitted(false);
      setEditing(false);
      onChanged();
    }
  }, [submitted, pending, state, onChanged]);

  const rowStyle = {
    borderColor: "var(--color-hairline)",
    background: "var(--color-canvas)",
  };

  if (editing) {
    return (
      <form
        action={dispatch}
        className="flex flex-col sm:flex-row sm:items-center gap-2 px-3 py-2 rounded-lg border"
        style={{ ...rowStyle, borderColor: "var(--color-primary)" }}
      >
        <input type="hidden" name="id" value={variant.id} />
        <input type="hidden" name="is_available" value={String(variant.is_available)} />
        <Input name="name" defaultValue={variant.name} required className="flex-1 h-8 text-sm" />
        <div className="relative w-full sm:w-24">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs" style={{ color: "var(--color-ink-mute)" }}>₹</span>
          <Input
            name="price"
            type="number"
            min="0"
            step="0.01"
            defaultValue={String(variant.price)}
            required
            className="pl-6 w-full h-8 text-sm"
          />
        </div>
        <div className="flex items-center gap-1">
          <button
            type="submit"
            disabled={pending}
            title="Save variant"
            className="w-8 h-8 flex items-center justify-center rounded-md"
            style={{ background: "var(--color-primary)", color: "#fff" }}
          >
            {pending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          </button>
          <button
            type="button"
            title="Cancel"
            onClick={() => setEditing(false)}
            className="w-8 h-8 flex items-center justify-center rounded-md"
            style={{ color: "var(--color-ink-mute)" }}
          >
            <X size={13} />
          </button>
        </div>
        {state?.error && (
          <p className="text-xs w-full" style={{ color: "var(--color-ruby)" }}>{state.error}</p>
        )}
      </form>
    );
  }

  return (
    <div
      className="flex items-center gap-2 sm:gap-3 px-3 py-2 rounded-lg border"
      style={{ ...rowStyle, opacity: variant.is_available ? 1 : 0.55 }}
    >
      <span className="flex-1 min-w-0 truncate text-sm" style={{ color: "var(--color-ink)" }}>
        {variant.name}
      </span>
      <span className="text-sm tabular-nums shrink-0" style={{ color: "var(--color-ink-mute)" }}>
        ₹{Number(variant.price).toFixed(0)}
      </span>

      {/* Out-of-stock is a variant-level fact: the Large can run out while the
          Small is still pouring. An unavailable variant vanishes from the guest's
          picker rather than being orderable and then refused. */}
      <button
        type="button"
        className="text-xs px-2 py-0.5 rounded-full border shrink-0"
        style={variant.is_available
          ? { color: "var(--color-success)", borderColor: "color-mix(in srgb, var(--color-success) 27%, transparent)", background: "var(--color-success-bg)" }
          : { color: "var(--color-ink-mute)", borderColor: "var(--color-hairline)", background: "transparent" }
        }
        onClick={() => startToggle(async () => {
          const fd = new FormData();
          fd.set("id", variant.id);
          fd.set("name", variant.name);
          fd.set("price", String(variant.price));
          fd.set("is_available", String(!variant.is_available));
          const r = await updateVariant(null, fd);
          if (r?.error) alert(r.error);
          else onChanged();
        })}
      >
        {variant.is_available ? "Available" : "Hidden"}
      </button>

      <button
        type="button"
        title="Edit variant"
        onClick={() => setEditing(true)}
        style={{ color: "var(--color-ink-mute)" }}
      >
        <Pencil size={13} />
      </button>
      <button
        type="button"
        title="Delete variant"
        style={{ color: "var(--color-ink-mute)" }}
        onClick={onDelete}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

// ─── Item Edit Panel ──────────────────────────────────────────────────────────

type EditTab = "basic" | "availability" | "schedule" | "variants" | "addons";

type FieldState = {
  name: string;
  description: string;
  price: string;
  food_type: string;
  availability_status: string;
  preparation_time: string;
  tax_percent: string;
  sku: string;
  is_featured: boolean;
  badges: string[];
  time_from: string;
  time_until: string;
  date_from: string;
  date_until: string;
  available_days: number[];
  room_service_available: boolean;
};

function itemToFields(item: MenuItemRow): FieldState {
  return {
    name: item.name,
    description: item.description ?? "",
    price: String(item.price),
    food_type: item.food_type ?? "veg",
    availability_status: item.availability_status ?? "available",
    preparation_time: item.preparation_time != null ? String(item.preparation_time) : "",
    tax_percent: item.tax_percent != null ? String(item.tax_percent) : "0",
    sku: item.sku ?? "",
    is_featured: item.is_featured ?? false,
    badges: Array.isArray(item.badges) ? item.badges : [],
    time_from: item.time_from ?? "",
    time_until: item.time_until ?? "",
    date_from: item.date_from ?? "",
    date_until: item.date_until ?? "",
    available_days: Array.isArray(item.available_days) ? item.available_days : [0, 1, 2, 3, 4, 5, 6],
    room_service_available: item.room_service_available ?? false,
  };
}

// No `restaurantId` prop: variants and add-ons are scoped by the menu item they
// hang off, and the server derives the restaurant from the session. The panel
// used to pass one down into a hidden form field, which is exactly the input the
// server should never have been trusting.
function ItemEditPanel({
  item,
  onClose,
}: {
  item: MenuItemRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<EditTab>("basic");
  const [fields, setFields] = useState<FieldState>(() => itemToFields(item));

  // Sync fields when item prop updates (after router.refresh())
  useEffect(() => { setFields(itemToFields(item)); }, [item]);

  // ── Update main item ──────────────────────────────────────────────────────
  const [updateState, updateDispatch, updatePending] = useActionState<ActionResult, FormData>(updateMenuItem, null);
  const [updateSubmitted, setUpdateSubmitted] = useState(false);
  useEffect(() => { if (updatePending) setUpdateSubmitted(true); }, [updatePending]);
  useEffect(() => {
    if (updateSubmitted && !updatePending && updateState === null) {
      setUpdateSubmitted(false);
      router.refresh();
    }
  }, [updateSubmitted, updatePending, updateState, router]);

  // ── Variants ──────────────────────────────────────────────────────────────
  const [variants, setVariants] = useState<VariantRow[] | null>(null);
  const [createVarState, createVarDispatch, createVarPending] = useActionState<ActionResult, FormData>(createVariant, null);
  const [createVarSubmitted, setCreateVarSubmitted] = useState(false);
  const [, startDeleteVar] = useTransition();

  useEffect(() => { if (createVarPending) setCreateVarSubmitted(true); }, [createVarPending]);
  useEffect(() => {
    if (createVarSubmitted && !createVarPending && createVarState === null) {
      setCreateVarSubmitted(false);
      getItemVariantsAndAddons(item.id).then(d => setVariants(d.variants));
    }
  }, [createVarSubmitted, createVarPending, createVarState, item.id]);

  // ── Add-ons ───────────────────────────────────────────────────────────────
  const [addons, setAddons] = useState<AddonRow[] | null>(null);
  const [createAddonState, createAddonDispatch, createAddonPending] = useActionState<ActionResult, FormData>(createAddon, null);
  const [createAddonSubmitted, setCreateAddonSubmitted] = useState(false);
  const [, startDeleteAddon] = useTransition();

  useEffect(() => { if (createAddonPending) setCreateAddonSubmitted(true); }, [createAddonPending]);
  useEffect(() => {
    if (createAddonSubmitted && !createAddonPending && createAddonState === null) {
      setCreateAddonSubmitted(false);
      getItemVariantsAndAddons(item.id).then(d => setAddons(d.addons));
    }
  }, [createAddonSubmitted, createAddonPending, createAddonState, item.id]);

  // Load variants + addons once on mount
  useEffect(() => {
    getItemVariantsAndAddons(item.id).then(d => {
      setVariants(d.variants);
      setAddons(d.addons);
    });
  }, [item.id]);

  // ── Field helpers ─────────────────────────────────────────────────────────
  const setField = useCallback(
    <K extends keyof FieldState>(key: K, value: FieldState[K]) => {
      setFields(prev => ({ ...prev, [key]: value }));
    },
    []
  );

  const toggleDay = useCallback((day: number) => {
    setFields(prev => ({
      ...prev,
      available_days: prev.available_days.includes(day)
        ? prev.available_days.filter(d => d !== day)
        : [...prev.available_days, day].sort(),
    }));
  }, []);

  const toggleBadge = useCallback((badge: string) => {
    setFields(prev => ({
      ...prev,
      badges: prev.badges.includes(badge)
        ? prev.badges.filter(b => b !== badge)
        : [...prev.badges, badge],
    }));
  }, []);

  const inputCls = "h-8 w-full rounded border px-2.5 text-sm";
  const inputStyle = {
    borderColor: "var(--color-hairline-input)",
    color: "var(--color-ink)",
    background: "var(--color-canvas)",
  };
  const labelCls = "text-xs block mb-1";
  const labelStyle = { color: "var(--color-ink-mute)" };

  const TABS: { id: EditTab; label: string }[] = [
    { id: "basic", label: "Basic" },
    { id: "availability", label: "Availability" },
    { id: "schedule", label: "Schedule" },
    { id: "variants", label: `Variants${variants ? ` (${variants.length})` : ""}` },
    { id: "addons", label: `Add-ons${addons ? ` (${addons.length})` : ""}` },
  ];

  return (
    <div
      className="mt-1 mb-1 rounded-xl border px-5 py-4 flex flex-col gap-4"
      style={{ background: "var(--color-canvas-soft)", borderColor: "var(--color-primary)", borderWidth: 1.5 }}
    >
      {/* Tab bar */}
      <div className="flex items-center gap-0.5 border-b pb-2" style={{ borderColor: "var(--color-hairline)" }}>
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className="px-3 py-1 rounded-md text-xs transition-colors"
            style={{
              color: tab === t.id ? "var(--color-primary)" : "var(--color-ink-mute)",
              background: tab === t.id ? "rgba(99,102,241,0.08)" : "transparent",
              fontWeight: tab === t.id ? 500 : 400,
            }}
          >
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        <button type="button" onClick={onClose} style={{ color: "var(--color-ink-mute)" }}>
          <X size={14} />
        </button>
      </div>

      {/* Unified form — hidden inputs capture all state for submit */}
      <form action={updateDispatch} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={item.id} />
        {/* All fields as hidden inputs so they submit from any tab */}
        <input type="hidden" name="name" value={fields.name} />
        <input type="hidden" name="description" value={fields.description} />
        <input type="hidden" name="price" value={fields.price} />
        <input type="hidden" name="food_type" value={fields.food_type} />
        <input type="hidden" name="availability_status" value={fields.availability_status} />
        <input type="hidden" name="preparation_time" value={fields.preparation_time} />
        <input type="hidden" name="tax_percent" value={fields.tax_percent} />
        <input type="hidden" name="sku" value={fields.sku} />
        <input type="hidden" name="is_featured" value={String(fields.is_featured)} />
        <input type="hidden" name="badges" value={JSON.stringify(fields.badges)} />
        <input type="hidden" name="time_from" value={fields.time_from} />
        <input type="hidden" name="time_until" value={fields.time_until} />
        <input type="hidden" name="date_from" value={fields.date_from} />
        <input type="hidden" name="date_until" value={fields.date_until} />
        <input type="hidden" name="available_days" value={JSON.stringify(fields.available_days)} />
        <input type="hidden" name="room_service_available" value={String(fields.room_service_available)} />

        {/* ── Basic Tab ── */}
        {tab === "basic" && (
          <div className="flex flex-col gap-3">
            <div>
              <label className={labelCls} style={labelStyle}>Name *</label>
              <input
                className={inputCls}
                style={inputStyle}
                value={fields.name}
                onChange={e => setField("name", e.target.value)}
                required
              />
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>Description</label>
              <textarea
                rows={2}
                className="w-full rounded border px-2.5 py-1.5 text-sm resize-none"
                style={{ ...inputStyle, lineHeight: 1.5 }}
                value={fields.description}
                onChange={e => setField("description", e.target.value)}
              />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className={labelCls} style={labelStyle}>Price (₹) *</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className={inputCls}
                  style={inputStyle}
                  value={fields.price}
                  onChange={e => setField("price", e.target.value)}
                />
              </div>
              <div className="flex-1">
                <label className={labelCls} style={labelStyle}>Tax %</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className={inputCls}
                  style={inputStyle}
                  value={fields.tax_percent}
                  onChange={e => setField("tax_percent", e.target.value)}
                />
              </div>
              <div className="flex-1">
                <label className={labelCls} style={labelStyle}>Prep time (min)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  className={inputCls}
                  style={inputStyle}
                  value={fields.preparation_time}
                  onChange={e => setField("preparation_time", e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>SKU / Internal Code</label>
              <input
                className={inputCls}
                style={inputStyle}
                value={fields.sku}
                onChange={e => setField("sku", e.target.value)}
                placeholder="e.g. PANEER-01"
              />
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>Food type</label>
              <div className="mt-1">
                <FoodTypePicker
                  value={fields.food_type}
                  onChange={(ft) => setField("food_type", ft)}
                />
              </div>
            </div>
          </div>
        )}

        {/* ── Availability Tab ── */}
        {tab === "availability" && (
          <div className="flex flex-col gap-4">
            <div>
              <label className={labelCls} style={labelStyle}>Availability status</label>
              <div className="flex gap-2 mt-1">
                {(["available", "out_of_stock", "hidden"] as const).map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setField("availability_status", s)}
                    className="px-3 py-1.5 rounded-lg border text-xs"
                    style={{
                      borderColor: fields.availability_status === s ? STATUS_CONFIG[s].color : "var(--color-hairline)",
                      background: fields.availability_status === s ? STATUS_CONFIG[s].bg : "transparent",
                      color: fields.availability_status === s ? STATUS_CONFIG[s].color : "var(--color-ink-mute)",
                    }}
                  >
                    {STATUS_CONFIG[s].label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>Badges</label>
              <div className="flex flex-wrap gap-2 mt-1">
                {BADGE_OPTIONS.map(badge => (
                  <button
                    key={badge}
                    type="button"
                    onClick={() => toggleBadge(badge)}
                    className="px-2.5 py-1 rounded-full border text-xs"
                    style={{
                      borderColor: fields.badges.includes(badge) ? "var(--color-primary)" : "var(--color-hairline)",
                      background: fields.badges.includes(badge) ? "rgba(99,102,241,0.08)" : "transparent",
                      color: fields.badges.includes(badge) ? "var(--color-primary)" : "var(--color-ink-mute)",
                    }}
                  >
                    {badge}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: "var(--color-ink)" }}>
              <input
                type="checkbox"
                checked={fields.is_featured}
                onChange={e => setField("is_featured", e.target.checked)}
              />
              Mark as featured item
            </label>
          </div>
        )}

        {/* ── Schedule Tab ── */}
        {tab === "schedule" && (
          <div className="flex flex-col gap-4">
            <div>
              <label className={labelCls} style={labelStyle}>Time window (show only between these times)</label>
              <div className="flex gap-3 mt-1">
                <div className="flex-1">
                  <label className={labelCls} style={labelStyle}>From</label>
                  <input
                    type="time"
                    className={inputCls}
                    style={inputStyle}
                    value={fields.time_from}
                    onChange={e => setField("time_from", e.target.value)}
                  />
                </div>
                <div className="flex-1">
                  <label className={labelCls} style={labelStyle}>Until</label>
                  <input
                    type="time"
                    className={inputCls}
                    style={inputStyle}
                    value={fields.time_until}
                    onChange={e => setField("time_until", e.target.value)}
                  />
                </div>
              </div>
              {(fields.time_from || fields.time_until) && (
                <button
                  type="button"
                  className="text-xs mt-1"
                  style={{ color: "var(--color-ink-mute)" }}
                  onClick={() => { setField("time_from", ""); setField("time_until", ""); }}
                >
                  Clear time window
                </button>
              )}
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>Date range (special / seasonal item)</label>
              <div className="flex gap-3 mt-1">
                <div className="flex-1">
                  <label className={labelCls} style={labelStyle}>From</label>
                  <input
                    type="date"
                    className={inputCls}
                    style={inputStyle}
                    value={fields.date_from}
                    onChange={e => setField("date_from", e.target.value)}
                  />
                </div>
                <div className="flex-1">
                  <label className={labelCls} style={labelStyle}>Until</label>
                  <input
                    type="date"
                    className={inputCls}
                    style={inputStyle}
                    value={fields.date_until}
                    onChange={e => setField("date_until", e.target.value)}
                  />
                </div>
              </div>
              {(fields.date_from || fields.date_until) && (
                <button
                  type="button"
                  className="text-xs mt-1"
                  style={{ color: "var(--color-ink-mute)" }}
                  onClick={() => { setField("date_from", ""); setField("date_until", ""); }}
                >
                  Clear date range
                </button>
              )}
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>Available days</label>
              <div className="flex gap-1.5 mt-1 flex-wrap">
                {DAY_LABELS.map((label, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleDay(i)}
                    className="w-10 h-8 rounded border text-xs"
                    style={{
                      borderColor: fields.available_days.includes(i) ? "var(--color-primary)" : "var(--color-hairline)",
                      background: fields.available_days.includes(i) ? "rgba(99,102,241,0.1)" : "transparent",
                      color: fields.available_days.includes(i) ? "var(--color-primary)" : "var(--color-ink-mute)",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: "var(--color-ink)" }}>
              <input
                type="checkbox"
                checked={fields.room_service_available}
                onChange={e => setField("room_service_available", e.target.checked)}
              />
              Available for room service
            </label>
          </div>
        )}

        {/* Save button (only on basic/availability/schedule tabs) */}
        {(tab === "basic" || tab === "availability" || tab === "schedule") && (
          <div className="flex items-center gap-3 pt-1 border-t" style={{ borderColor: "var(--color-hairline)" }}>
            <Button type="submit" variant="primary" disabled={updatePending}>
              {updatePending ? "Saving…" : "Save changes"}
            </Button>
            {updateState?.error && (
              <p className="text-xs" style={{ color: "var(--color-ruby)" }}>{updateState.error}</p>
            )}
            {updateSubmitted && !updatePending && updateState === null && (
              <p className="text-xs" style={{ color: "var(--color-success)" }}>Saved</p>
            )}
          </div>
        )}
      </form>

      {/* ── Variants Tab (separate form) ── */}
      {tab === "variants" && (
        <div className="flex flex-col gap-3">
          {variants === null ? (
            <div className="flex items-center gap-2 text-sm" style={{ color: "var(--color-ink-mute)" }}>
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : (
            <>
              {variants.length === 0 && (
                <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                  No variants yet. Add sizes or versions of this item (e.g. Small, Medium, Large).
                </p>
              )}
              {variants.length > 0 && (
                <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                  A guest picks one of these before adding {item.name} to their cart, and
                  the variant&apos;s price is what they pay.
                </p>
              )}
              {variants.map(v => (
                <VariantLine
                  key={v.id}
                  variant={v}
                  onChanged={() => getItemVariantsAndAddons(item.id).then(d => setVariants(d.variants))}
                  onDelete={() => startDeleteVar(async () => {
                    const r = await deleteVariant(v.id);
                    if (r?.error) alert(r.error);
                    else getItemVariantsAndAddons(item.id).then(d => setVariants(d.variants));
                  })}
                />
              ))}

              <form
                action={createVarDispatch}
                className="flex flex-col sm:flex-row gap-2 mt-1 pt-2 border-t"
                style={{ borderColor: "var(--color-hairline)" }}
              >
                <input type="hidden" name="menu_item_id" value={item.id} />
                <Input name="name" placeholder="e.g. Large" required className="flex-1" />
                <div className="relative w-full sm:w-24">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs" style={{ color: "var(--color-ink-mute)" }}>₹</span>
                  <Input name="price" type="number" min="0" step="0.01" placeholder="0" required className="pl-6 w-full" />
                </div>
                <Button type="submit" variant="primary" disabled={createVarPending} className="text-xs px-3 h-9">
                  {createVarPending ? "…" : "Add"}
                </Button>
              </form>
              {createVarState?.error && (
                <p className="text-xs" style={{ color: "var(--color-ruby)" }}>{createVarState.error}</p>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Add-ons Tab (separate form) ── */}
      {tab === "addons" && (
        <div className="flex flex-col gap-3">
          {addons === null ? (
            <div className="flex items-center gap-2 text-sm" style={{ color: "var(--color-ink-mute)" }}>
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : (
            <>
              {addons.length === 0 && (
                <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
                  No add-ons yet. Add optional extras customers can choose (e.g. Extra Cheese +₹30).
                </p>
              )}
              {addons.map(a => (
                <div
                  key={a.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg border"
                  style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
                >
                  <span className="flex-1 text-sm" style={{ color: "var(--color-ink)" }}>
                    {a.name}
                    {a.is_required && (
                      <span className="ml-1 text-xs" style={{ color: "var(--color-ruby)" }}>required</span>
                    )}
                  </span>
                  <span className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
                    {Number(a.price) > 0 ? `+₹${Number(a.price).toFixed(0)}` : "Free"}
                  </span>
                  <button
                    type="button"
                    title="Delete add-on"
                    style={{ color: "var(--color-ink-mute)" }}
                    onClick={() => startDeleteAddon(async () => {
                      const r = await deleteAddon(a.id);
                      if (r?.error) alert(r.error);
                      else getItemVariantsAndAddons(item.id).then(d => setAddons(d.addons));
                    })}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}

              <form
                action={createAddonDispatch}
                className="flex gap-2 mt-1 pt-2 border-t"
                style={{ borderColor: "var(--color-hairline)" }}
              >
                <input type="hidden" name="menu_item_id" value={item.id} />
                <Input name="name" placeholder="e.g. Extra Cheese" required className="flex-1" />
                <div className="relative w-24">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs" style={{ color: "var(--color-ink-mute)" }}>+₹</span>
                  <Input name="price" type="number" min="0" step="0.01" placeholder="0" className="pl-8 w-full" />
                </div>
                <Button type="submit" variant="primary" disabled={createAddonPending} className="text-xs px-3 h-9">
                  {createAddonPending ? "…" : "Add"}
                </Button>
              </form>
              {createAddonState?.error && (
                <p className="text-xs" style={{ color: "var(--color-ruby)" }}>{createAddonState.error}</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Item Card ────────────────────────────────────────────────────────────────

function ItemCard({ item }: { item: MenuItemRow }) {
  const [editing, setEditing] = useState(false);
  const [, startToggle] = useTransition();
  const [, startDelete] = useTransition();

  const isAvailable = item.availability_status === "available";

  return (
    <div>
      <div
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
        style={{ opacity: isAvailable ? 1 : 0.6 }}
      >
        <FoodMark type={item.food_type} size={13} />

        <p className="flex-1 text-sm truncate" style={{ color: "var(--color-ink)" }}>
          {item.name}
          {item.is_featured && (
            <span className="ml-1.5 text-xs" style={{ color: "var(--color-warning)" }}>★</span>
          )}
          {item.has_variants && (
            <span className="ml-1.5 text-xs" style={{ color: "var(--color-ink-mute)" }}>+variants</span>
          )}
        </p>

        <StatusBadge status={item.availability_status} />

        <p className="text-sm tabular-nums" style={{ color: "var(--color-ink-mute)" }}>
          ₹{Number(item.price).toFixed(0)}
        </p>

        <button
          type="button"
          onClick={() => startToggle(async () => { await toggleItemAvailability(item.id, !isAvailable); })}
          className="text-xs px-2.5 py-1 rounded-full border font-medium shrink-0"
          style={isAvailable
            ? { color: "var(--color-warning)", borderColor: "color-mix(in srgb, var(--color-warning) 40%, transparent)", background: "var(--color-warning-bg)" }
            : { color: "var(--color-success)", borderColor: "color-mix(in srgb, var(--color-success) 40%, transparent)", background: "var(--color-success-bg)" }
          }
        >
          {isAvailable ? "Mark out of stock" : "Mark available"}
        </button>

        <button
          type="button"
          title="Edit item"
          onClick={() => setEditing(e => !e)}
          style={{ color: editing ? "var(--color-primary)" : "var(--color-ink-mute)" }}
        >
          <Pencil size={14} />
        </button>

        <button
          type="button"
          title="Delete item"
          style={{ color: "var(--color-ink-mute)" }}
          onClick={() => startDelete(async () => {
            if (confirm(`Delete "${item.name}"? This cannot be undone.`)) {
              const r = await softDeleteMenuItem(item.id);
              if (r?.error) alert(r.error);
            }
          })}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {editing && (
        <ItemEditPanel
          item={item}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

// ─── Category Accordion ───────────────────────────────────────────────────────

function CategoryAccordion({
  category,
  hue,
  items,
  restaurantId,
  workstations,
  isFirst = false,
  isLast = false,
}: {
  category: CategoryRow;
  /** Allocated across the whole list by the parent, so no two categories collide. */
  hue: CategoryHue;
  items: MenuItemRow[];
  restaurantId: string;
  workstations: WorkstationRow[];
  /** Ends of the list can't move further — the arrows disable rather than no-op. */
  isFirst?: boolean;
  isLast?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  const [, startToggle] = useTransition();
  const [, startDelete] = useTransition();
  const [moving, startMove] = useTransition();
  const [editState, editAction, editPending] = useActionState<ActionResult, FormData>(updateCategory, null);
  const [editSubmitted, setEditSubmitted] = useState(false);

  useEffect(() => { if (editPending) setEditSubmitted(true); }, [editPending]);
  useEffect(() => {
    if (editSubmitted && !editPending && editState === null) {
      setEditSubmitted(false);
      setEditing(false);
    }
  }, [editSubmitted, editPending, editState]);

  const catItems = items.filter((i) => i.category_id === category.id);
  const cat = styleOf(hue);

  return (
    <div
      className="rounded-xl border overflow-hidden transition-colors"
      // Tapping a category makes it wear its own colour, exactly the way a dashboard section
      // does: accent on the top (2px) and left (3px) edges, hairline elsewhere. At rest only
      // the small bar in the header carries the hue, so a long list stays calm and the ONE
      // category you opened is unmistakable.
      style={{
        background: "var(--color-canvas)",
        borderColor: "var(--color-hairline)",
        ...(open && {
          borderTopColor: cat.color,
          borderTopWidth: 2,
          borderLeftColor: cat.color,
          borderLeftWidth: 3,
        }),
      }}
    >
      {/* Header */}
      {editing ? (
        <form
          action={editAction}
          className="flex items-end gap-2 flex-wrap px-4 py-3 border-b"
          style={{ borderColor: "var(--color-primary)", borderBottomWidth: 1.5 }}
        >
          <input type="hidden" name="id" value={category.id} />
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Name</label>
            <Input name="name" defaultValue={category.name} required className="w-36 h-8 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Description</label>
            <Input name="description" defaultValue={category.description ?? ""} className="w-44 h-8 text-sm" placeholder="Optional" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Workstation</label>
            <select
              name="workstation_id"
              defaultValue={category.workstation_id}
              className="h-8 rounded-sm border px-2 text-sm"
              style={{ borderColor: "var(--color-hairline-input)", color: "var(--color-ink)", background: "var(--color-canvas)" }}
            >
              {workstations.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={editPending}
            className="text-xs px-3 py-1.5 rounded font-medium h-8"
            style={{ background: "var(--color-primary)", color: "#fff" }}
          >
            {editPending ? "…" : "Save"}
          </button>
          <button type="button" onClick={() => setEditing(false)} style={{ color: "var(--color-ink-mute)" }}>
            <X size={14} />
          </button>
          {editState?.error && (
            <p className="text-xs w-full" style={{ color: "var(--color-ruby)" }}>{editState.error}</p>
          )}
        </form>
      ) : (
        // Eight controls used to sit in one non-wrapping row (title, count, description, two
        // reorder arrows, Active, edit, add, delete), which overflowed the moment the viewport
        // got narrow. Now the row WRAPS: the title claims a full line of its own below `sm`
        // (`basis-full`), and the actions fall onto a second line instead of being squeezed.
        // The category's colour rides on the left edge as a bar + the title, so a category is
        // identifiable before its name is read.
        <div
          className="flex items-center gap-x-3 gap-y-2 px-4 py-3 flex-wrap transition-colors"
          // The open category's header takes its own soft tint — the same soft/colour pairing
          // the section icon tiles and status pills use, so it flips in dark mode for free.
          style={{ background: open ? cat.soft : undefined }}
        >
          <span
            aria-hidden
            className="w-1 self-stretch rounded-full shrink-0"
            style={{ background: cat.color, minHeight: 20 }}
          />
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="flex items-center gap-2 min-w-0 basis-full sm:basis-auto sm:flex-1 text-left"
          >
            {open
              ? <ChevronDown size={15} className="shrink-0" style={{ color: "var(--color-ink-mute)" }} />
              : <ChevronRight size={15} className="shrink-0" style={{ color: "var(--color-ink-mute)" }} />
            }
            <span className="text-base font-medium truncate" style={{ color: cat.color }}>
              {category.name}
            </span>
            <span className="text-sm shrink-0" style={{ color: "var(--color-ink-mute)" }}>
              {catItems.length} items · {category.workstation_name ?? "—"}
            </span>
            {/* The description is the first thing to go when space is tight — it's the least
                actionable part of the row. */}
            {category.description && (
              <span className="text-xs truncate hidden md:inline" style={{ color: "var(--color-ink-mute)" }}>
                · {category.description}
              </span>
            )}
          </button>

          {/* Reorder. This order is what the CUSTOMER menu shows, so the arrows
              are the only way to arrange it — the list is no longer alphabetical. */}
          <div className="flex items-center ml-auto sm:ml-0">
            <button
              type="button"
              title="Move up"
              aria-label={`Move ${category.name} up`}
              disabled={isFirst || moving}
              onClick={() => startMove(async () => { await moveCategory(category.id, "up"); })}
              className="p-1 rounded-md disabled:opacity-25"
              style={{ color: "var(--color-ink-mute)" }}
            >
              <ChevronUp size={14} />
            </button>
            <button
              type="button"
              title="Move down"
              aria-label={`Move ${category.name} down`}
              disabled={isLast || moving}
              onClick={() => startMove(async () => { await moveCategory(category.id, "down"); })}
              className="p-1 rounded-md disabled:opacity-25"
              style={{ color: "var(--color-ink-mute)" }}
            >
              <ChevronDown size={14} />
            </button>
          </div>

          <button
            type="button"
            className="text-sm px-2 py-0.5 rounded-md border shrink-0"
            // Was a hard-coded green / light-green slab that stayed light on a dark page.
            style={{
              color: category.is_active ? "var(--st-available)" : "var(--color-ink-mute)",
              borderColor: category.is_active ? "var(--st-available)" : "var(--color-hairline)",
              background: category.is_active ? "var(--st-available-soft)" : "transparent",
            }}
            onClick={() => startToggle(async () => { await toggleCategoryStatus(category.id, !category.is_active); })}
          >
            {category.is_active ? "Active" : "Hidden"}
          </button>

          <button
            type="button"
            title="Edit category"
            onClick={() => setEditing(true)}
            style={{ color: "var(--color-ink-mute)" }}
          >
            <Pencil size={13} />
          </button>

          <button
            type="button"
            title="Add item"
            onClick={() => { setOpen(true); setAddingItem(true); }}
            style={{ color: "var(--color-ink-mute)" }}
          >
            <Plus size={15} />
          </button>

          <button
            type="button"
            title="Delete category"
            style={{ color: "var(--color-ink-mute)" }}
            onClick={() => startDelete(async () => {
              if (confirm(`Delete category "${category.name}"?`)) {
                const r = await deleteCategory(category.id);
                if (r?.error) alert(r.error);
              }
            })}
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}

      {open && (
        <div
          className="px-4 pb-3 border-t"
          // The rule under the tinted header picks up the category's colour too, so the open
          // panel reads as one block rather than a tinted strip with an unrelated list below it.
          style={{ borderColor: cat.color }}
        >
          {catItems.length === 0 && !addingItem && (
            <p className="text-xs py-2" style={{ color: "var(--color-ink-mute)" }}>
              No items yet.{" "}
              <button
                type="button"
                className="underline"
                onClick={() => setAddingItem(true)}
                style={{ color: "var(--color-primary)" }}
              >
                Add one
              </button>
            </p>
          )}
          {catItems.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
          {addingItem && (
            <AddItemForm
              restaurantId={restaurantId}
              categoryId={category.id}
              onClose={() => setAddingItem(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Root Export ──────────────────────────────────────────────────────────────

export function MenuClient({
  categories,
  items,
  workstations,
  restaurantId,
}: {
  categories: CategoryRow[];
  items: MenuItemRow[];
  workstations: WorkstationRow[];
  restaurantId: string;
}) {
  const [addingCategory, setAddingCategory] = useState(false);

  // Allocated over the whole list at once — per-category hashing collided far too often to be
  // useful (see assignCategoryHues). Memoised so it's stable across re-renders.
  const hues = useMemo(() => assignCategoryHues(categories), [categories]);

  return (
    // `max-w-2xl` capped this at 672px, so on a desktop the Menu section sat in the left half
    // of its card while every other section (Tables, Rooms, Sales) filled the width. Full width
    // now; the rows below manage their own layout at every size.
    <div className="flex flex-col gap-4 w-full">
      <div className="flex items-center justify-between">
        <p className="text-base" style={{ color: "var(--color-ink-mute)" }}>
          {categories.length} categories · {items.length} items
        </p>
        {!addingCategory && (
          <Button variant="primary" onClick={() => setAddingCategory(true)}>
            <Plus size={14} className="mr-1.5" />
            New category
          </Button>
        )}
      </div>

      {addingCategory && (
        <AddCategoryForm
          restaurantId={restaurantId}
          workstations={workstations}
          onClose={() => setAddingCategory(false)}
        />
      )}

      {categories.length === 0 && !addingCategory ? (
        <div
          className="rounded-xl border px-8 py-12 text-center"
          style={{ borderStyle: "dashed", borderColor: "var(--color-hairline)", background: "var(--color-canvas)" }}
        >
          <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
            No categories yet. Create a workstation first, then add categories.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {categories.map((c, i) => (
            <CategoryAccordion
              key={c.id}
              category={c}
              hue={hues.get(c.id)!}
              items={items}
              restaurantId={restaurantId}
              workstations={workstations}
              isFirst={i === 0}
              isLast={i === categories.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
