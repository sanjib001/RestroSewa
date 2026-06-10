'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addVariant, removeVariant } from '@/app/actions/variants'

type Variant = { id: string; name: string; additional_price: number; is_active: boolean; sort_order: number }

export function VariantsEditor({
  menuItemId,
  variants,
}: {
  menuItemId: string
  variants: Variant[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [newName, setNewName] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const price = parseFloat(newPrice) || 0
    startTransition(async () => {
      const result = await addVariant(menuItemId, newName.trim(), price)
      if (!result.success) { setError(result.error); return }
      setNewName('')
      setNewPrice('')
      router.refresh()
    })
  }

  function handleRemove(variantId: string) {
    startTransition(async () => {
      const result = await removeVariant(variantId)
      if (!result.success) { alert(result.error); return }
      router.refresh()
    })
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      {variants.length > 0 ? (
        <ul className="divide-y divide-border">
          {variants.map((v) => (
            <li key={v.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <span className="text-sm text-foreground">{v.name}</span>
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  +₹{(v.additional_price / 100).toFixed(2)}
                </span>
              </div>
              <button
                onClick={() => handleRemove(v.id)}
                disabled={isPending}
                className="text-xs text-destructive/50 hover:text-destructive disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-sm text-muted-foreground">No variants. Items without variants use the base price directly.</p>
      )}

      <form onSubmit={handleAdd} className="flex gap-2 border-t border-border px-4 py-3">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Variant name (e.g. Large)"
          disabled={isPending}
          className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        <input
          type="number"
          value={newPrice}
          onChange={(e) => setNewPrice(e.target.value)}
          placeholder="+₹ price"
          min="0"
          step="0.01"
          disabled={isPending}
          className="w-28 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isPending || !newName.trim()}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? '…' : 'Add'}
        </button>
      </form>

      {error && <p className="px-4 pb-3 text-xs text-destructive">{error}</p>}
    </div>
  )
}
