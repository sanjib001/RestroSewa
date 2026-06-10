'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createPermissionTemplate, updatePermissionTemplate } from '@/app/actions/permission-templates'
import type { Permission } from '@/types/app'

const ALL_PERMISSIONS: { value: Permission; label: string; description: string }[] = [
  { value: 'ACTIVATE_SESSION', label: 'Activate Session', description: 'Start a new customer session at a table' },
  { value: 'CLOSE_SESSION', label: 'Close Session', description: 'End and complete a session' },
  { value: 'ACCEPT_ORDER', label: 'Accept Order', description: 'Accept incoming customer orders' },
  { value: 'REJECT_ORDER', label: 'Reject Order', description: 'Reject incoming customer orders' },
  { value: 'PROCESS_PAYMENT', label: 'Process Payment', description: 'Record payments and close bills' },
  { value: 'APPLY_DISCOUNT', label: 'Apply Discount', description: 'Apply discounts to a session bill' },
  { value: 'MANAGE_MENU', label: 'Manage Menu', description: 'Edit categories, items, variants and add-ons' },
  { value: 'MANAGE_TABLES', label: 'Manage Tables', description: 'Create and manage tables and table groups' },
  { value: 'VIEW_REPORTS', label: 'View Reports', description: 'Access sales and operational reports' },
  { value: 'VIEW_KDS', label: 'View KDS', description: 'View the kitchen display screen' },
]

type TemplateFormProps = {
  templateId?: string
  initialName?: string
  initialPermissions?: Permission[]
}

export function TemplateForm({ templateId, initialName = '', initialPermissions = [] }: TemplateFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState(initialName)
  const [selected, setSelected] = useState<Set<Permission>>(new Set(initialPermissions))

  function toggle(p: Permission) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(p) ? next.delete(p) : next.add(p)
      return next
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const permissions = [...selected]

    startTransition(async () => {
      const result = templateId
        ? await updatePermissionTemplate(templateId, name, permissions)
        : await createPermissionTemplate(name, permissions)
      if (!result.success) { setError(result.error); return }
      router.push('/super-admin/templates')
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
      )}

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">
          Template Name <span className="text-destructive">*</span>
        </label>
        <input
          type="text" required autoFocus value={name} onChange={(e) => setName(e.target.value)}
          disabled={isPending}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          placeholder="e.g. Waiter, Cashier, Floor Manager"
        />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">
          Permissions <span className="text-destructive">*</span>
          <span className="ml-2 font-normal text-muted-foreground">({selected.size} selected)</span>
        </p>
        <div className="space-y-2 rounded-lg border border-border bg-card p-4">
          {ALL_PERMISSIONS.map(({ value, label, description }) => (
            <label key={value} className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox" checked={selected.has(value)} onChange={() => toggle(value)}
                disabled={isPending} className="mt-0.5 accent-primary"
              />
              <div>
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="flex gap-3 pt-1">
        <button type="submit" disabled={isPending} className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
          {isPending ? 'Saving…' : templateId ? 'Save Changes' : 'Create Template'}
        </button>
        <button type="button" onClick={() => router.back()} disabled={isPending} className="rounded-md px-5 py-2 text-sm text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>
    </form>
  )
}
