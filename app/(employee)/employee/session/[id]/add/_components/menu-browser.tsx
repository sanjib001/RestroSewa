"use client";

import { useState, useActionState, useTransition, useMemo } from "react";
import { submitOrder } from "@/app/actions/pos";
import type { ActionResult, CartItem } from "@/app/actions/pos";
import type { CategoryRow, MenuItemRow, VariantRow } from "@/app/actions/menu";
import { Button } from "@/components/ui/button";
import { FoodMark } from "@/components/ui/food-mark";
import { Minus, Plus, ShoppingBag, X } from "lucide-react";

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
}: {
  sessionId: string;
  categories: CategoryRow[];
  items: MenuItemRow[];
  variants: VariantRow[];
}) {
  const [activeCategoryId, setActiveCategoryId] = useState<string>(categories[0]?.id ?? "");
  const [cart, setCart] = useState<Map<LineKey, number>>(new Map());
  const [picking, setPicking] = useState<MenuItemRow | null>(null);
  const [state, dispatch, pending] = useActionState<ActionResult, FormData>(submitOrder, null);
  const [, startTransition] = useTransition();

  const variantsOf = useMemo(() => {
    const m = new Map<string, VariantRow[]>();
    for (const v of variants) {
      const list = m.get(v.menu_item_id);
      if (list) list.push(v);
      else m.set(v.menu_item_id, [v]);
    }
    return m;
  }, [variants]);

  const visibleItems = items.filter(
    (i) => i.category_id === activeCategoryId && i.availability_status === "available"
  );

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

  function handlePlaceOrder() {
    // Only ids and quantities travel to the server; it prices the order itself.
    const cartItems: CartItem[] = cartEntries.map(([key, quantity]) => {
      const { itemId, variantId } = parseKey(key);
      return { menu_item_id: itemId, variant_id: variantId, quantity, notes: null };
    });

    const fd = new FormData();
    fd.set("session_id", sessionId);
    fd.set("items", JSON.stringify(cartItems));
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
    <div className="flex flex-col h-full">
      {/* Category tabs */}
      <div
        className="flex gap-1 overflow-x-auto px-4 py-2 border-b shrink-0"
        style={{ borderColor: "var(--color-hairline)" }}
      >
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setActiveCategoryId(c.id)}
            className="px-3 py-1.5 rounded-lg text-sm whitespace-nowrap shrink-0"
            style={{
              background: activeCategoryId === c.id ? "var(--color-primary)" : "transparent",
              color: activeCategoryId === c.id ? "#fff" : "var(--color-ink-mute)",
              fontWeight: activeCategoryId === c.id ? 400 : 300,
            }}
          >
            {c.name}
          </button>
        ))}
      </div>

      {/* Items grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {visibleItems.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
            No items in this category.
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

              return (
                <div
                  key={item.id}
                  className="rounded-xl border p-3 flex flex-col gap-2"
                  style={{
                    background: qty > 0 ? "var(--color-canvas-soft)" : "var(--color-canvas)",
                    borderColor: qty > 0 ? "var(--color-primary)" : "var(--color-hairline)",
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
                        className="flex-1 h-8 rounded-lg text-sm flex items-center justify-center gap-1"
                        style={{ background: "var(--color-primary)", color: "#fff" }}
                      >
                        <Plus size={14} /> {hasVariants ? (qty > 0 ? `Add · ${qty}` : "Choose") : "Add"}
                      </button>
                    ) : (
                      <div className="flex items-center gap-1 flex-1">
                        <button
                          type="button"
                          onClick={() => adjust(keyOf(item.id, null), -1)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center"
                          style={{ background: "var(--color-canvas-soft)" }}
                        >
                          <Minus size={14} style={{ color: "var(--color-ink)" }} />
                        </button>
                        <span
                          className="flex-1 text-center text-sm font-medium tabular"
                          style={{ color: "var(--color-ink)" }}
                        >
                          {qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => adjust(keyOf(item.id, null), 1)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center"
                          style={{ background: "var(--color-primary)" }}
                        >
                          <Plus size={14} style={{ color: "#fff" }} />
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

      {/* Cart bar */}
      {cartCount > 0 && (
        <div
          className="shrink-0 border-t px-4 py-3 flex flex-col gap-2"
          style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
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
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <ShoppingBag size={16} style={{ color: "var(--color-primary)" }} />
              <span className="text-sm" style={{ color: "var(--color-ink)" }}>
                {cartCount} item{cartCount !== 1 ? "s" : ""}
              </span>
              <span className="text-sm tabular" style={{ color: "var(--color-ink-mute)" }}>
                · ₹{cartTotal.toFixed(0)}
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
