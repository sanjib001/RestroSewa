'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createTable } from '@/app/actions/tables'

type Group = { id: string; name: string }

export function TableForm({ groups }: { groups: Group[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const [globalError, setGlobalError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setErrors({})
    setGlobalError(null)
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await createTable(formData)
      if (!result.success) {
        if (result.fieldErrors) setErrors(result.fieldErrors)
        else setGlobalError(result.error)
        return
      }
      router.push('/operations/admin/tables')
      router.refresh()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border border-border bg-card p-6">
      {globalError && (
        <p className="rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive">{globalError}</p>
      )}

      <div>
        <label htmlFor="display_name" className="mb-1.5 block text-sm font-medium text-foreground">
          Table Name
        </label>
        <input
          id="display_name"
          name="display_name"
          type="text"
          placeholder="e.g. Table 1, Window Seat A"
          required
          disabled={isPending}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        {errors.display_name && <p className="mt-1 text-xs text-destructive">{errors.display_name[0]}</p>}
      </div>

      <div>
        <label htmlFor="position" className="mb-1.5 block text-sm font-medium text-foreground">
          Position / Sort Order
        </label>
        <input
          id="position"
          name="position"
          type="number"
          min="0"
          defaultValue="0"
          disabled={isPending}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
      </div>

      <div>
        <label htmlFor="table_group_id" className="mb-1.5 block text-sm font-medium text-foreground">
          Group <span className="text-muted-foreground">(optional)</span>
        </label>
        <select
          id="table_group_id"
          name="table_group_id"
          disabled={isPending}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        >
          <option value="">No group</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.back()}
          disabled={isPending}
          className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? 'Creating…' : 'Create Table'}
        </button>
      </div>
    </form>
  )
}
