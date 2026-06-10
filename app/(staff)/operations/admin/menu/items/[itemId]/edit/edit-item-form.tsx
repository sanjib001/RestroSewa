'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateMenuItem } from '@/app/actions/menu-items'

type Item = {
  id: string; name: string; description: string | null; base_price: number
  category_id: string | null; is_veg: boolean; is_special: boolean; sort_order: number; status: string
}
type Category = { id: string; name: string }

export function EditItemForm({ item, categories }: { item: Item; categories: Category[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await updateMenuItem(item.id, formData)
      if (!result.success) { setError(result.error); return }
      setSuccess(true)
      router.refresh()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border border-border bg-card p-6">
      {error && <p className="rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</p>}
      {success && <p className="rounded-md bg-green-500/10 px-4 py-2 text-sm text-green-400">Saved.</p>}

      <div>
        <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-foreground">Item Name</label>
        <input id="name" name="name" type="text" required defaultValue={item.name} disabled={isPending}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" />
      </div>

      <div>
        <label htmlFor="description" className="mb-1.5 block text-sm font-medium text-foreground">
          Description <span className="text-muted-foreground">(optional)</span>
        </label>
        <textarea id="description" name="description" rows={2} defaultValue={item.description ?? ''} disabled={isPending}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" />
      </div>

      <div>
        <label htmlFor="base_price" className="mb-1.5 block text-sm font-medium text-foreground">Base Price (₹)</label>
        <input id="base_price" name="base_price" type="number" min="0" step="0.01"
          defaultValue={(item.base_price / 100).toFixed(2)} required disabled={isPending}
          className="w-40 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" />
      </div>

      <div>
        <label htmlFor="category_id" className="mb-1.5 block text-sm font-medium text-foreground">Category</label>
        <select id="category_id" name="category_id" defaultValue={item.category_id ?? ''} disabled={isPending}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50">
          <option value="">No category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex items-center gap-2.5">
          <input type="hidden" name="is_veg" value="false" />
          <input type="checkbox" name="is_veg" value="true" defaultChecked={item.is_veg} disabled={isPending}
            className="h-4 w-4 rounded border-input accent-green-500 disabled:opacity-50" />
          <span className="text-sm text-foreground">Vegetarian</span>
        </label>

        <label className="flex items-center gap-2.5">
          <input type="hidden" name="is_special" value="false" />
          <input type="checkbox" name="is_special" value="true" defaultChecked={item.is_special} disabled={isPending}
            className="h-4 w-4 rounded border-input accent-amber-500 disabled:opacity-50" />
          <span className="text-sm text-foreground">Chef's Special</span>
        </label>
      </div>

      <div>
        <label htmlFor="sort_order" className="mb-1.5 block text-sm font-medium text-foreground">Sort Order</label>
        <input id="sort_order" name="sort_order" type="number" min="0" defaultValue={item.sort_order} disabled={isPending}
          className="w-32 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" />
      </div>

      <div className="flex items-center justify-between pt-2">
        <button type="button" onClick={() => router.push('/operations/admin/menu')} disabled={isPending}
          className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">
          ← Back to Menu
        </button>
        <button type="submit" disabled={isPending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
          {isPending ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </form>
  )
}
