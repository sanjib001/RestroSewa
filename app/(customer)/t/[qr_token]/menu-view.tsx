'use client'

import { useState } from 'react'
import type { Category, MenuItem, Session, Variant, Addon } from './page'
import type { CartEntry, CartAction } from './customer-app'

function fmt(paise: number) {
  return `₹${(paise / 100).toFixed(2)}`
}

function cartKey(menuItemId: string, variantId: string | null, addonIds: string[]): string {
  return `${menuItemId}|${variantId ?? ''}|${[...addonIds].sort().join(',')}`
}

// Bottom-sheet item customizer shown when a menu item has variants or addons
function ItemCustomizer({
  item,
  onAdd,
  onClose,
}: {
  item: MenuItem
  onAdd: (entry: CartEntry) => void
  onClose: () => void
}) {
  const hasVariants = item.variants.length > 0
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    hasVariants ? item.variants[0].id : null,
  )
  const [selectedAddonIds, setSelectedAddonIds] = useState<Set<string>>(new Set())
  const [quantity, setQuantity] = useState(1)
  const [notes, setNotes] = useState('')

  const selectedVariant = item.variants.find((v) => v.id === selectedVariantId) ?? null
  const unitPrice = item.base_price + (selectedVariant?.additional_price ?? 0)
  const addonTotal = item.addons
    .filter((a) => selectedAddonIds.has(a.id))
    .reduce((s, a) => s + a.additional_price, 0)
  const lineTotal = (unitPrice + addonTotal) * quantity

  function toggleAddon(id: string) {
    setSelectedAddonIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleAdd() {
    const addonIds = [...selectedAddonIds]
    const addonObjs = item.addons.filter((a) => selectedAddonIds.has(a.id))
    onAdd({
      key: cartKey(item.id, selectedVariantId, addonIds),
      menuItemId: item.id,
      menuItemName: item.name,
      variantId: selectedVariantId,
      variantName: selectedVariant?.name ?? null,
      addonIds,
      addonNames: addonObjs.map((a) => a.name),
      addonTotalPaise: addonTotal,
      unitPricePaise: unitPrice,
      quantity,
      notes,
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col" onClick={onClose}>
      {/* Backdrop */}
      <div className="flex-1 bg-black/30" />

      {/* Sheet */}
      <div
        className="rounded-t-2xl bg-card px-4 pb-8 pt-4 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 h-1 w-10 rounded-full bg-border mx-auto" />

        <div className="mt-3 mb-4">
          <h3 className="font-heading text-lg font-semibold text-foreground">{item.name}</h3>
          {item.description && <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>}
        </div>

        {/* Variants */}
        {item.variants.length > 0 && (
          <div className="mb-5">
            <p className="mb-2 text-sm font-medium text-foreground">Size / Variant</p>
            <div className="space-y-2">
              {item.variants.map((v) => (
                <label key={v.id} className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2.5 cursor-pointer">
                  <div className="flex items-center gap-2.5">
                    <input
                      type="radio"
                      name="variant"
                      checked={selectedVariantId === v.id}
                      onChange={() => setSelectedVariantId(v.id)}
                      className="accent-primary"
                    />
                    <span className="text-sm text-foreground">{v.name}</span>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {v.additional_price > 0 ? `+${fmt(v.additional_price)}` : fmt(item.base_price + v.additional_price)}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Add-ons */}
        {item.addons.length > 0 && (
          <div className="mb-5">
            <p className="mb-2 text-sm font-medium text-foreground">Add-ons</p>
            <div className="space-y-2">
              {item.addons.map((a) => (
                <label key={a.id} className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2.5 cursor-pointer">
                  <div className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={selectedAddonIds.has(a.id)}
                      onChange={() => toggleAddon(a.id)}
                      className="accent-primary"
                    />
                    <span className="text-sm text-foreground">{a.name}</span>
                  </div>
                  <span className="text-sm text-muted-foreground">+{fmt(a.additional_price)}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        <div className="mb-5">
          <p className="mb-2 text-sm font-medium text-foreground">Special Instructions <span className="text-muted-foreground">(optional)</span></p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="e.g. No onions, less spicy…"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* Quantity + Add */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
            <button onClick={() => setQuantity(Math.max(1, quantity - 1))} className="text-lg font-bold text-primary w-6 text-center">−</button>
            <span className="w-5 text-center text-sm font-medium text-foreground">{quantity}</span>
            <button onClick={() => setQuantity(quantity + 1)} className="text-lg font-bold text-primary w-6 text-center">+</button>
          </div>
          <button
            onClick={handleAdd}
            className="flex-1 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
          >
            Add to Cart — {fmt(lineTotal)}
          </button>
        </div>
      </div>
    </div>
  )
}

export function MenuView({
  categories,
  items,
  session,
  cart,
  dispatch,
}: {
  categories: Category[]
  items: MenuItem[]
  session: Session | null
  cart: CartEntry[]
  dispatch: React.Dispatch<CartAction>
}) {
  const [customizing, setCustomizing] = useState<MenuItem | null>(null)

  const canOrder = !!session && !session.ordering_locked

  function handleDirectAdd(item: MenuItem) {
    const entry: CartEntry = {
      key: cartKey(item.id, null, []),
      menuItemId: item.id,
      menuItemName: item.name,
      variantId: null,
      variantName: null,
      addonIds: [],
      addonNames: [],
      addonTotalPaise: 0,
      unitPricePaise: item.base_price,
      quantity: 1,
      notes: '',
    }
    dispatch({ type: 'ADD', entry })
  }

  function handleItemTap(item: MenuItem) {
    if (!canOrder) return
    if (item.variants.length > 0 || item.addons.length > 0) {
      setCustomizing(item)
    } else {
      handleDirectAdd(item)
    }
  }

  const byCategory = new Map<string | null, MenuItem[]>()
  byCategory.set(null, [])
  for (const c of categories) byCategory.set(c.id, [])
  for (const item of items) byCategory.get(item.category_id ?? null)?.push(item)

  const cartQty = (menuItemId: string) =>
    cart.filter((e) => e.menuItemId === menuItemId).reduce((s, e) => s + e.quantity, 0)

  return (
    <>
      {customizing && (
        <ItemCustomizer
          item={customizing}
          onAdd={(entry) => { dispatch({ type: 'ADD', entry }); setCustomizing(null) }}
          onClose={() => setCustomizing(null)}
        />
      )}

      <div className="px-4 py-4 space-y-8">
        {categories.map((cat) => {
          const catItems = byCategory.get(cat.id) ?? []
          if (catItems.length === 0) return null
          return (
            <section key={cat.id}>
              <h2 className="mb-3 font-heading text-base font-semibold text-foreground">{cat.name}</h2>
              <div className="space-y-2">
                {catItems.map((item) => {
                  const qty = cartQty(item.id)
                  const oos = item.status === 'out_of_stock'
                  return (
                    <div
                      key={item.id}
                      className={`flex items-start gap-3 rounded-xl border border-border bg-card p-3 ${oos ? 'opacity-60' : ''}`}
                    >
                      {/* Veg dot */}
                      <span
                        className={`mt-1 h-3 w-3 shrink-0 rounded-sm border-2 ${item.is_veg ? 'border-green-600 bg-green-500/20' : 'border-red-600 bg-red-500/20'}`}
                      />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-semibold text-foreground">{item.name}</span>
                          {item.is_special && (
                            <span className="rounded bg-amber-500/20 px-1 py-0.5 text-[10px] font-medium text-amber-700">★ Special</span>
                          )}
                          {oos && (
                            <span className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">Out of Stock</span>
                          )}
                        </div>
                        {item.description && (
                          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{item.description}</p>
                        )}
                        <p className="mt-1 font-mono text-sm font-medium text-foreground">
                          {item.variants.length > 0 ? `from ${fmt(item.base_price)}` : fmt(item.base_price)}
                        </p>
                      </div>

                      {canOrder && !oos && (
                        <button
                          onClick={() => handleItemTap(item)}
                          className="shrink-0 rounded-lg border border-primary px-3 py-1.5 text-sm font-semibold text-primary active:bg-primary active:text-primary-foreground"
                        >
                          {qty > 0 ? `Add (${qty})` : 'Add'}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}

        {/* Uncategorised */}
        {(byCategory.get(null)?.length ?? 0) > 0 && (
          <section>
            <h2 className="mb-3 font-heading text-base font-semibold text-foreground">Other</h2>
            <div className="space-y-2">
              {byCategory.get(null)!.map((item) => {
                const oos = item.status === 'out_of_stock'
                return (
                  <div key={item.id} className={`flex items-start gap-3 rounded-xl border border-border bg-card p-3 ${oos ? 'opacity-60' : ''}`}>
                    <span className={`mt-1 h-3 w-3 shrink-0 rounded-sm border-2 ${item.is_veg ? 'border-green-600 bg-green-500/20' : 'border-red-600 bg-red-500/20'}`} />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-semibold text-foreground">{item.name}</span>
                      <p className="mt-1 font-mono text-sm text-foreground">{fmt(item.base_price)}</p>
                    </div>
                    {canOrder && !oos && (
                      <button onClick={() => handleItemTap(item)} className="shrink-0 rounded-lg border border-primary px-3 py-1.5 text-sm font-semibold text-primary">
                        Add
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {items.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-sm text-muted-foreground">Menu is being prepared. Check back soon.</p>
          </div>
        )}
      </div>
    </>
  )
}
