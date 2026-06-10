'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateCategory } from '@/app/actions/menu-categories'

type Category = { id: string; name: string; description: string | null; sort_order: number; is_active: boolean }

export function EditCategoryForm({ category }: { category: Category }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await updateCategory(category.id, formData)
      if (!result.success) { setError(result.error); return }
      router.push('/operations/admin/menu')
      router.refresh()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border border-border bg-card p-6">
      {error && <p className="rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</p>}

      <div>
        <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-foreground">Name</label>
        <input id="name" name="name" type="text" required defaultValue={category.name} disabled={isPending}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" />
      </div>

      <div>
        <label htmlFor="description" className="mb-1.5 block text-sm font-medium text-foreground">
          Description <span className="text-muted-foreground">(optional)</span>
        </label>
        <textarea id="description" name="description" rows={2} defaultValue={category.description ?? ''} disabled={isPending}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" />
      </div>

      <div>
        <label htmlFor="sort_order" className="mb-1.5 block text-sm font-medium text-foreground">Sort Order</label>
        <input id="sort_order" name="sort_order" type="number" min="0" defaultValue={category.sort_order} disabled={isPending}
          className="w-32 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" />
      </div>

      <label className="flex items-center gap-3">
        <input type="checkbox" name="is_active" value="true" defaultChecked={category.is_active} disabled={isPending}
          className="h-4 w-4 rounded border-input accent-primary disabled:opacity-50" />
        <span className="text-sm text-foreground">Active (visible to customers)</span>
      </label>

      <div className="flex items-center justify-end gap-3 pt-2">
        <button type="button" onClick={() => router.back()} disabled={isPending}
          className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">
          Cancel
        </button>
        <button type="submit" disabled={isPending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
          {isPending ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </form>
  )
}
