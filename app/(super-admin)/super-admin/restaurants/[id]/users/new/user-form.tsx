'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createRestaurantUser } from '@/app/actions/users'

type Template = { id: string; name: string; permissions: string[] }

export function UserForm({ restaurantId, templates }: { restaurantId: string; templates: Template[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [role, setRole] = useState<'restaurant_admin' | 'restaurant_employee'>('restaurant_employee')

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)

    startTransition(async () => {
      const result = await createRestaurantUser(restaurantId, {
        employeeId: fd.get('employeeId') as string,
        name: fd.get('name') as string,
        displayTitle: fd.get('displayTitle') as string,
        role,
        permissionTemplateId: fd.get('permissionTemplateId') as string || undefined,
        pin: fd.get('pin') as string,
      })
      if (!result.success) { setError(result.error); return }
      router.push(`/super-admin/restaurants/${restaurantId}`)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
      )}

      <Field label="Employee ID" required hint="Unique within this restaurant">
        <input name="employeeId" type="text" required autoFocus disabled={isPending} className={ic} placeholder="E001" />
      </Field>

      <Field label="Full Name" required>
        <input name="name" type="text" required disabled={isPending} className={ic} placeholder="Rahul Sharma" />
      </Field>

      <Field label="Display Title" required hint="e.g. Waiter, Cashier, Counter">
        <input name="displayTitle" type="text" required disabled={isPending} className={ic} placeholder="Waiter" />
      </Field>

      <Field label="Role" required>
        <div className="flex gap-4">
          {(['restaurant_employee', 'restaurant_admin'] as const).map((r) => (
            <label key={r} className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} disabled={isPending} />
              <span className="text-foreground">{r === 'restaurant_admin' ? 'Admin' : 'Employee'}</span>
            </label>
          ))}
        </div>
      </Field>

      {role === 'restaurant_employee' && (
        <Field label="Permission Template" required>
          <select name="permissionTemplateId" required disabled={isPending} className={ic}>
            <option value="">Select a template</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name} ({t.permissions.length} permissions)</option>
            ))}
          </select>
          {templates.length === 0 && (
            <p className="mt-1 text-xs text-muted-foreground">No templates yet. <a href="/super-admin/templates/new" className="text-primary hover:underline">Create one first.</a></p>
          )}
        </Field>
      )}

      {role === 'restaurant_admin' && (
        <input type="hidden" name="permissionTemplateId" value="" />
      )}

      <Field label="PIN" required hint="4–8 digits, share with employee">
        <input
          name="pin" type="text" inputMode="numeric" required
          minLength={4} maxLength={8} pattern="\d{4,8}"
          disabled={isPending} className={ic} placeholder="1234"
        />
      </Field>

      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={isPending} className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
          {isPending ? 'Creating…' : 'Create User'}
        </button>
        <button type="button" onClick={() => router.back()} disabled={isPending} className="rounded-md px-5 py-2 text-sm text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>
    </form>
  )
}

function Field({ label, children, required, hint }: { label: string; children: React.ReactNode; required?: boolean; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground">
        {label}{required && <span className="ml-0.5 text-destructive">*</span>}
        {hint && <span className="ml-2 font-normal text-muted-foreground">({hint})</span>}
      </label>
      {children}
    </div>
  )
}

const ic = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50'
