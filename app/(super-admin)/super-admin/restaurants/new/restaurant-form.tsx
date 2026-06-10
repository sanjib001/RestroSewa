'use client'

import { useTransition, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createRestaurant } from '@/app/actions/restaurants'

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function RestaurantForm() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugManual, setSlugManual] = useState(false)

  function handleNameChange(v: string) {
    setName(v)
    if (!slugManual) setSlug(slugify(v))
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await createRestaurant(fd)
      if (!result.success) { setError(result.error); return }
      router.push(`/super-admin/restaurants/${result.data.id}`)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
      )}

      <Field label="Restaurant Name" required>
        <input
          name="name" type="text" required autoFocus value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          disabled={isPending}
          className={inputClass}
          placeholder="e.g. The Grand Cafe"
        />
      </Field>

      <Field label="Slug" required hint="Used in login URL: /r/[slug]/login">
        <input
          name="slug" type="text" required value={slug}
          onChange={(e) => { setSlug(e.target.value); setSlugManual(true) }}
          disabled={isPending}
          className={inputClass}
          placeholder="the-grand-cafe"
          pattern="[a-z0-9-]+"
        />
      </Field>

      <Field label="Phone" hint="Optional">
        <input name="phone" type="tel" disabled={isPending} className={inputClass} placeholder="+91 98765 43210" />
      </Field>

      <Field label="Email" hint="Optional">
        <input name="email" type="email" disabled={isPending} className={inputClass} placeholder="contact@restaurant.com" />
      </Field>

      <Field label="Address" hint="Optional">
        <textarea name="address" rows={2} disabled={isPending} className={inputClass} placeholder="123 Main St, City" />
      </Field>

      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={isPending} className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
          {isPending ? 'Creating…' : 'Create Restaurant'}
        </button>
        <button type="button" onClick={() => router.back()} disabled={isPending} className="rounded-md px-5 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">
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

const inputClass = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50'
