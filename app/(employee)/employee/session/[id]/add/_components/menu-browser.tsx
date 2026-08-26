"use client";

import { useState, useActionState, useTransition, useMemo, useRef } from "react";
import { submitOrder } from "@/app/actions/pos";
import type { ActionResult, CartItem } from "@/app/actions/pos";
import type { CategoryRow, MenuItemRow, VariantRow } from "@/app/actions/menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FoodMark } from "@/components/ui/food-mark";
import { assignCategoryHues, styleOf } from "@/lib/category-colors";
import { Minus, Plus, Search, ShoppingBag, SquarePen, X } from "lucide-react";

// A staff-typed off-menu line held in the cart before submit. `price` is a string while
// being typed; it's parsed to a number only when the order is placed. `workstation_id` null
// means bill-only (no KOT/BOT).
type CustomLine = {
  key: number;
  name: string;
  price: string;
  quantity: number;
  notes: string;
  workstation_id: string | null;
};

type Workstation = { id: string; name: string };

// A cart line is an item AND the variant chosen for it: a Large Coffee and a
// Small Coffee are two lines, not one line of quantity 2. The map is therefore
// keyed by both. (It used to be keyed by item id alone, which is why a variant
// could never have been represented even once the DB supported it.)
type LineKey = string;

const keyOf = (itemId: string, variantId: string | null): LineKey =>
  variantId ? `${itemId}::${variantId}` : itemId;

const parseKey = (key: LineKey): { itemId: string; variantId: string | null } => {
  const [itemId, variantId] = key.split("::");
  return { itemId, variantId: variantId ?? null };
};

export function MenuBrowser({
  sessionId,
  categories,
  items,
  variants,
  canAddCustom = false,
  workstations = [],
}: {
  sessionId: string;
  categories: CategoryRow[];
  items: MenuItemRow[];
  variants: VariantRow[];
  /** Whether this user holds `manage_custom_items` — gates the whole custom-item affordance. */
  canAddCustom?: boolean;
  /** Stations a custom item can be routed to (empty ⇒ bill-only is the only choice). */
  workstations?: Workstation[];
}) {
  const [activeCategoryId, setActiveCategoryId] = useState<string>(categories[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<Map<LineKey, number>>(new Map());
  const [picking, setPicking] = useState<MenuItemRow | null>(null);
  const [state, dispatch, pending] = useActionState<ActionResult, FormData>(submitOrder, null);
  const [, startTransition] = useTransition();

  // Custom (off-menu) lines and the "Add custom item" form.
  const customKey = useRef(1);
  const [customLines, setCustomLines] = useState<CustomLine[]>([]);
  const [customOpen, setCustomOpen] = useState(false);
  const [cName, setCName] = useState("");
  const [cPrice, setCPrice] = useState("");
  const [cQty, setCQty] = useState(1);
  const [cNote, setCNote] = useState("");
  const [cStation, setCStation] = useState<string>("");

  const variantsOf = useMemo(() => {
    const m = new Map<string, VariantRow[]>();
    for (const v of variants) {
      const list = m.get(v.menu_item_id);
      if (list) list.push(v);
      else m.set(v.menu_item_id, [v]);
    }
    return m;
  }, [variants]);

  // One hue per category, resolved over the whole list at once (distinct up to 12) — see
  // lib/category-colors.ts. Drives the tab colours and each item card's category accent.
  const hueMap = useMemo(() => assignCategoryHues(categories), [categories]);
  const catStyleOf = (categoryId: string) => styleOf(hueMap.get(categoryId) ?? "orange");

  // While searching, the active category is set aside and every available item whose name matches
  // is shown as a flat list — the fastest way to find a dish is to type it, not to hunt for its
  // tab. The input is a plain controlled field, so it never remounts and never loses focus.
  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const visibleItems = searching
    ? items.filter((i) => i.availability_status === "available" && i.name.toLowerCase().includes(q))
    : items.filter((i) => i.category_id === activeCategoryId && i.availability_status === "available");

  function adjust(key: LineKey, delta: number) {
    setCart((prev) => {
      const next = new Map(prev);
      const updated = (next.get(key) ?? 0) + delta;
      if (updated <= 0) next.delete(key);
      else next.set(key, Math.min(updated, 99));
      return next;
    });
  }

  // Tapping an item with variants can't just add it — the price depends on which
  // one, so it opens the picker instead.
  function handleAdd(item: MenuItemRow) {
    const opts = variantsOf.get(item.id);
    if (opts?.length) setPicking(item);
    else adjust(keyOf(item.id, null), 1);
  }

  // How many of this dish are in the cart across all its variants — so the card
  // shows "3" for a coffee that's 1 small and 2 large.
  function qtyOfItem(itemId: string): number {
    let total = 0;
    for (const [key, qty] of cart) {
      if (parseKey(key).itemId === itemId) total += qty;
    }
    return total;
  }

  const priceOf = (itemId: string, variantId: string | null): number => {
    if (variantId) {
      const v = variantsOf.get(itemId)?.find((x) => x.id === variantId);
      if (v) return Number(v.price);
    }
    return Number(items.find((i) => i.id === itemId)?.price ?? 0);
  };

  const labelOf = (itemId: string, variantId: string | null): string => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return "";
    if (!variantId) return item.name;
    const v = variantsOf.get(itemId)?.find((x) => x.id === variantId);
    return v ? `${item.name} (${v.name})` : item.name;
  };

  const cartEntries = Array.from(cart.entries());
  const cartTotal = cartEntries.reduce((sum, [key, qty]) => {
    const { itemId, variantId } = parseKey(key);
    return sum + priceOf(itemId, variantId) * qty;
  }, 0);
  const cartCount = cartEntries.reduce((a, [, qty]) => a + qty, 0);

  // Custom lines add to the same order and the same running total.
  const customCount = customLines.reduce((a, l) => a + l.quantity, 0);
  const customTotal = customLines.reduce((a, l) => a + (parseFloat(l.price) || 0) * l.quantity, 0);
  const totalCount = cartCount + customCount;
  const grandTotal = cartTotal + customTotal;
  const stationName = (id: string | null) => workstations.find((w) => w.id === id)?.name ?? null;

  const cPriceNum = parseFloat(cPrice);
  const customValid = cName.trim().length > 0 && Number.isFinite(cPriceNum) && cPriceNum >= 0 && cQty >= 1;

  function addCustomLine() {
    if (!customValid) return;
    setCustomLines((l) => [
      ...l,
      { key: customKey.current++, name: cName.trim(), price: cPrice, quantity: cQty, notes: cNote.trim(), workstation_id: cStation || null },
    ]);
    setCName(""); setCPrice(""); setCQty(1); setCNote(""); setCStation("");
    setCustomOpen(false);
  }
  const removeCustom = (key: number) => setCustomLines((l) => l.filter((x) => x.key !== key));

  function handlePlaceOrder() {
    // Only ids and quantities travel to the server; it prices the order itself.
    const cartItems: CartItem[] = cartEntries.map(([key, quantity]) => {
      const { itemId, variantId } = parseKey(key);
      return { menu_item_id: itemId, variant_id: variantId, quantity, notes: null };
    });

    // Custom lines carry a staff-typed name/price — the server re-validates and re-checks the
    // permission, so this is a request, not a fact.
    const custom = customLines.map((l) => ({
      name: l.name,
      price: parseFloat(l.price) || 0,
      quantity: l.quantity,
      notes: l.notes || null,
      workstation_id: l.workstation_id,
    }));

    const fd = new FormData();
    fd.set("session_id", sessionId);
    fd.set("items", JSON.stringify(cartItems));
    fd.set("custom_items", JSON.stringify(custom));
    // dispatch must be called inside startTransition (React 19 rule)
    startTransition(() => dispatch(fd));
  }

  if (categories.length === 0) {
    return (
      <p className="text-sm p-5" style={{ color: "var(--color-ink-mute)" }}>
        No menu categories set up yet.
      </p>
    );
  }

  return (
    // `flex-1 min-h-0`, NOT `h-full`. This is a flex child sitting BELOW the page's
    // "Add items" header bar, so `h-full` (100% of the whole column) overflowed the
    // column by exactly the header's height and pushed the cart bar — and the Place
    // order button on it — off the bottom of the screen. `min-h-0` is the other half:
    // a flex item defaults to `min-height:auto`, so without it a long menu refuses to
    // shrink and shoves the footer off again.
    <div className="flex flex-col flex-1 min-h-0">
      {/* Search — the fastest path to a dish. Non-empty query hides the tabs and searches every
          category at once. */}
      <div className={`px-4 pt-3 pb-2.5 shrink-0 ${searching ? "border-b" : ""}`} style={{ borderColor: "var(--color-hairline)" }}>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--color-ink-mute)" }} />
          <input
            type="text"
            inputMode="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search menu…"
            aria-label="Search menu"
            className="w-full h-11 rounded-xl border pl-9 pr-9 text-base"
            style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full"
              style={{ color: "var(--color-ink-mute)" }}
            >
              <X size={15} />
            </button>
          )}
        </div>

        {/* Off-menu line — only for staff with `manage_custom_items`. */}
        {canAddCustom && (
          <button
            type="button"
            onClick={() => setCustomOpen(true)}
            className="mt-2 inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border"
            style={{ borderColor: "var(--color-hairline-input)", color: "var(--color-primary)", background: "var(--color-canvas)" }}
          >
            <SquarePen size={14} /> Add custom item
          </button>
        )}
      </div>

      {/* Category tabs — EVERY tab wears its category colour by default (tinted chip + coloured
          text), so the whole row is colourful at rest and a category is recognisable before it's
          read. Tapping one makes it *harder*, not merely colourful: a solid colour border, a ring
          and bold weight. Tints/text, never a white-on-fill pill (--cat-* are foreground tokens
          that invert behind white text in dark). Hidden while searching. */}
      {!searching && (
        <div
          className="flex gap-1.5 overflow-x-auto px-4 py-2.5 border-b shrink-0"
          style={{ borderColor: "var(--color-hairline)" }}
        >
          {categories.map((c) => {
            const active = activeCategoryId === c.id;
            const cat = catStyleOf(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveCategoryId(c.id)}
                className="px-3.5 py-2 rounded-lg text-sm whitespace-nowrap shrink-0 border transition-all"
                style={{
                  // Every tab is a coloured OUTLINE chip at rest — the border+text carry the colour
                  // and read cleanly on the near-white light canvas (a bare soft tint had no edge
                  // and vanished into the background). Tapping FILLS it with a stronger mid-tint of
                  // the same hue + bold weight + a doubled border, so selected is clearly harder in
                  // both themes. Mid-tint via color-mix, never a white-on-fill pill (--cat-* invert
                  // behind white text in dark).
                  background: active ? `color-mix(in srgb, ${cat.color} 18%, var(--color-canvas))` : "transparent",
                  color: cat.color,
                  borderColor: cat.color,
                  boxShadow: active ? `inset 0 0 0 1px ${cat.color}` : "none",
                  fontWeight: active ? 600 : 400,
                }}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Items grid */}
      {/* The ONLY scrolling region. `min-h-0` again, for the same reason as the root:
          this is what makes the menu scroll instead of growing the column. */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {visibleItems.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
            {searching ? `No items match “${query.trim()}”.` : "No items in this category."}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {visibleItems.map((item) => {
              const qty = qtyOfItem(item.id);
              const opts = variantsOf.get(item.id) ?? [];
              const hasVariants = opts.length > 0;
              // With variants the card can't show one price — it shows the
              // cheapest as a "from", which is what the guest will pay at minimum.
              const from = hasVariants
                ? Math.min(...opts.map((v) => Number(v.price)))
                : Number(item.price);

              // Each card wears its category's hue on a 3px left edge, so a dish is tied to its
              // category at a glance — the cue that matters most in search results, where items
              // from different categories sit side by side. A card in the cart deepens to the full
              // category border + tint; the Add/±/quantity controls stay brand purple (the "this is
              // the action" colour, consistent app-wide).
              const cat = catStyleOf(item.category_id);
              return (
                <div
                  key={item.id}
                  className="rounded-xl border p-3.5 flex flex-col gap-2"
                  // All four sides as LONGHANDS. Mixing the `borderColor` shorthand with a
                  // `borderLeftColor` longhand made React warn on every re-render — i.e. on
                  // every tap of + or − while taking an order — which buried anything real
                  // in the console. Same appearance, no warning.
                  style={{
                    background: qty > 0 ? cat.soft : "var(--color-canvas)",
                    borderTopColor: qty > 0 ? cat.color : "var(--color-hairline)",
                    borderRightColor: qty > 0 ? cat.color : "var(--color-hairline)",
                    borderBottomColor: qty > 0 ? cat.color : "var(--color-hairline)",
                    borderLeftColor: cat.color,
                    borderLeftWidth: 3,
                  }}
                >
                  <div className="flex items-start gap-1.5">
                    <span className="mt-0.5">
                      <FoodMark type={item.food_type} size={12} />
                    </span>
                    <p className="text-sm leading-tight flex-1" style={{ color: "var(--color-ink)" }}>
                      {item.name}
                    </p>
                  </div>
                  <p className="text-sm tabular" style={{ color: "var(--color-ink-mute)" }}>
                    {hasVariants && <span className="text-xs">from </span>}₹{from.toFixed(0)}
                  </p>

                  <div className="flex items-center gap-2 mt-auto">
                    {/* An item with variants always routes through the picker, so
                        it keeps a single "Add" even when some are already in the
                        cart — a bare +/- would have no variant to apply to. */}
                    {qty === 0 || hasVariants ? (
                      <button
                        type="button"
                        onClick={() => handleAdd(item)}
                        className="flex-1 h-9 rounded-lg text-sm flex items-center justify-center gap-1"
                        style={{ background: "var(--color-primary)", color: "#fff" }}
                      >
                        <Plus size={15} /> {hasVariants ? (qty > 0 ? `Add · ${qty}` : "Choose") : "Add"}
                      </button>
                    ) : (
                      <div className="flex items-center gap-1.5 flex-1">
                        <button
                          type="button"
                          aria-label={`One less ${item.name}`}
                          onClick={() => adjust(keyOf(item.id, null), -1)}
                          className="w-9 h-9 rounded-lg flex items-center justify-center border"
                          style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline-input)" }}
                        >
                          <Minus size={15} style={{ color: "var(--color-ink)" }} />
                        </button>
                        <span
                          className="flex-1 text-center text-base font-medium tabular"
                          style={{ color: "var(--color-ink)" }}
                        >
                          {qty}
                        </span>
                        <button
                          type="button"
                          aria-label={`One more ${item.name}`}
                          onClick={() => adjust(keyOf(item.id, null), 1)}
                          className="w-9 h-9 rounded-lg flex items-center justify-center"
                          style={{ background: "var(--color-primary)" }}
                        >
                          <Plus size={15} style={{ color: "#fff" }} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Variant picker */}
      {picking && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setPicking(null)}
        >
          <div
            className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-4 flex flex-col gap-3"
            style={{ background: "var(--color-canvas)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <p className="flex-1 text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                {picking.name}
              </p>
              <button type="button" onClick={() => setPicking(null)} style={{ color: "var(--color-ink-mute)" }}>
                <X size={16} />
              </button>
            </div>
            <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
              Choose an option
            </p>

            <div className="flex flex-col gap-1.5">
              {(variantsOf.get(picking.id) ?? []).map((v) => {
                const inCart = cart.get(keyOf(picking.id, v.id)) ?? 0;
                return (
                  <div
                    key={v.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl border"
                    style={{
                      borderColor: inCart > 0 ? "var(--color-primary)" : "var(--color-hairline)",
                      background: inCart > 0 ? "var(--color-canvas-soft)" : "transparent",
                    }}
                  >
                    <span className="flex-1 text-sm" style={{ color: "var(--color-ink)" }}>
                      {v.name}
                    </span>
                    <span className="text-sm tabular" style={{ color: "var(--color-ink-mute)" }}>
                      ₹{Number(v.price).toFixed(0)}
                    </span>
                    {inCart === 0 ? (
                      <button
                        type="button"
                        onClick={() => adjust(keyOf(picking.id, v.id), 1)}
                        className="h-8 px-3 rounded-lg text-sm flex items-center gap-1"
                        style={{ background: "var(--color-primary)", color: "#fff" }}
                      >
                        <Plus size={14} /> Add
                      </button>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label={`One less ${v.name}`}
                          onClick={() => adjust(keyOf(picking.id, v.id), -1)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center"
                          style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink)" }}
                        >
                          <Minus size={14} />
                        </button>
                        <span
                          className="w-6 text-center text-sm font-medium tabular"
                          style={{ color: "var(--color-primary)" }}
                        >
                          {inCart}
                        </span>
                        <button
                          type="button"
                          aria-label={`One more ${v.name}`}
                          onClick={() => adjust(keyOf(picking.id, v.id), 1)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-white"
                          style={{ background: "var(--color-primary)" }}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <Button type="button" variant="primary" onClick={() => setPicking(null)} className="w-full">
              Done
            </Button>
          </div>
        </div>
      )}

      {/* Add custom item */}
      {customOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setCustomOpen(false)}
        >
          <div
            className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-4 flex flex-col gap-3"
            style={{ background: "var(--color-canvas)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <p className="flex-1 text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                Custom item
              </p>
              <button type="button" onClick={() => setCustomOpen(false)} style={{ color: "var(--color-ink-mute)" }}>
                <X size={16} />
              </button>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Item name</span>
              <Input value={cName} maxLength={80} placeholder="e.g. Special platter" autoFocus onChange={(e) => setCName(e.target.value)} />
            </label>

            <div className="flex gap-2">
              <label className="flex flex-col gap-1 flex-1">
                <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Price (₹)</span>
                <Input type="number" min="0" step="0.01" inputMode="decimal" placeholder="0" value={cPrice} onChange={(e) => setCPrice(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1 w-28">
                <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Quantity</span>
                <div className="flex items-center gap-1">
                  <button type="button" aria-label="One less" onClick={() => setCQty((q) => Math.max(1, q - 1))}
                    className="w-9 h-9 rounded-lg flex items-center justify-center border shrink-0"
                    style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline-input)" }}>
                    <Minus size={14} style={{ color: "var(--color-ink)" }} />
                  </button>
                  <span className="flex-1 text-center text-base font-medium tabular" style={{ color: "var(--color-ink)" }}>{cQty}</span>
                  <button type="button" aria-label="One more" onClick={() => setCQty((q) => Math.min(99, q + 1))}
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--color-primary)" }}>
                    <Plus size={14} style={{ color: "#fff" }} />
                  </button>
                </div>
              </label>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Note (optional)</span>
              <Input value={cNote} maxLength={120} placeholder="e.g. no onions" onChange={(e) => setCNote(e.target.value)} />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Send to station (optional)</span>
              <select
                value={cStation}
                onChange={(e) => setCStation(e.target.value)}
                className="w-full text-sm rounded-lg border px-3 py-2"
                style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline-input)", color: "var(--color-ink)" }}
              >
                <option value="">Bill only (no kitchen ticket)</option>
                {workstations.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </label>

            <Button type="button" variant="primary" className="w-full" disabled={!customValid} onClick={addCustomLine}>
              Add to order
            </Button>
          </div>
        </div>
      )}

      {/* Cart bar */}
      {totalCount > 0 && (
        <div
          className="shrink-0 border-t px-4 py-3 flex flex-col gap-2"
          style={{
            background: "var(--color-canvas)",
            borderColor: "var(--color-hairline)",
            // ADDS to the py-3 rather than replacing it (which `.pb-safe` would, leaving
            // 0 bottom padding on any device without a notch). Installed on an iPhone
            // this bar is the last thing on screen and the home indicator sits over the
            // bottom ~34px — exactly where the Place order button is. The base 2.25rem
            // (not 0.75rem) also clears the fixed subscription watermark
            // (`components/subscription-watermark.tsx`), which sits `bottom-2` and,
            // on mobile, centered under this same bar — without the extra room it
            // sat right on top of the Place order button.
            paddingBottom: "calc(2.25rem + env(safe-area-inset-bottom, 0px))",
          }}
        >
          {/* Each variant is its own line, so a staff member can see that the
              order is 1 Small and 2 Large before they send it. */}
          <div className="flex flex-col gap-0.5 max-h-24 overflow-y-auto">
            {cartEntries.map(([key, qty]) => {
              const { itemId, variantId } = parseKey(key);
              return (
                <div key={key} className="flex items-center gap-2 text-xs">
                  <span className="flex-1 truncate" style={{ color: "var(--color-ink-mute)" }}>
                    {qty} × {labelOf(itemId, variantId)}
                  </span>
                  <span className="tabular" style={{ color: "var(--color-ink-mute)" }}>
                    ₹{(priceOf(itemId, variantId) * qty).toFixed(0)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${labelOf(itemId, variantId)}`}
                    onClick={() => adjust(key, -qty)}
                    style={{ color: "var(--color-ink-mute)" }}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}

            {/* Custom lines — marked, with their station if routed to one. */}
            {customLines.map((l) => (
              <div key={`c-${l.key}`} className="flex items-center gap-2 text-xs">
                <span className="flex-1 truncate" style={{ color: "var(--color-ink-mute)" }}>
                  {l.quantity} × {l.name}
                  <span
                    className="ml-1 px-1 rounded align-middle"
                    style={{ fontSize: "9px", lineHeight: "14px", background: "var(--color-canvas-soft)", color: "var(--color-primary)" }}
                  >
                    CUSTOM
                  </span>
                  {l.workstation_id && (
                    <span className="ml-1" style={{ color: "var(--color-ink-mute)" }}>· {stationName(l.workstation_id)}</span>
                  )}
                </span>
                <span className="tabular" style={{ color: "var(--color-ink-mute)" }}>
                  ₹{((parseFloat(l.price) || 0) * l.quantity).toFixed(0)}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${l.name}`}
                  onClick={() => removeCustom(l.key)}
                  style={{ color: "var(--color-ink-mute)" }}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <ShoppingBag size={16} style={{ color: "var(--color-primary)" }} />
              <span className="text-sm" style={{ color: "var(--color-ink)" }}>
                {totalCount} item{totalCount !== 1 ? "s" : ""}
              </span>
              <span className="text-sm tabular" style={{ color: "var(--color-ink-mute)" }}>
                · ₹{grandTotal.toFixed(0)}
              </span>
            </div>
            {state?.error && (
              <p className="text-xs" style={{ color: "var(--color-ruby)" }}>{state.error}</p>
            )}
            <Button type="button" variant="primary" disabled={pending} onClick={handlePlaceOrder}>
              {pending ? "Placing…" : "Place order"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
