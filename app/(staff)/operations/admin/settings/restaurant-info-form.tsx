'use client'

import { useState, useTransition } from 'react'
import { updateRestaurantInfo } from '@/app/actions/restaurant-settings'

type Restaurant = {
  name: string
  phone: string | null
  email: string | null
  address: string | null
  logo_url: string | null
}

export function RestaurantInfoForm({ restaurant }: { restaurant: Restaurant }) {
  const [isPending, startTransition] = useTransition()
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await updateRestaurantInfo(formData)
      if (!result.success) { setError(result.error); return }
      setSuccess(true)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-border bg-card p-6">
      {error && <p className="rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</p>}
      {success && <p className="rounded-md bg-green-500/10 px-4 py-2 text-sm text-green-400">Saved.</p>}

      <div>
        <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-foreground">Restaurant Name</label>
        <input id="name" name="name" type="text" defaultValue={restaurant.name} required disabled={isPending}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="phone" className="mb-1.5 block text-sm font-medium text-foreground">Phone</label>
          <input id="phone" name="phone" type="tel" defaultValue={restaurant.phone ?? ''} disabled={isPending}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" />
        </div>
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-foreground">Email</label>
          <input id="email" name="email" type="email" defaultValue={restaurant.email ?? ''} disabled={isPending}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" />
        </div>
      </div>

      <div>
        <label htmlFor="address" className="mb-1.5 block text-sm font-medium text-foreground">Address</label>
        <textarea id="address" name="address" rows={2} defaultValue={restaurant.address ?? ''} disabled={isPending}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" />
      </div>

      <div>
        <label htmlFor="logo_url" className="mb-1.5 block text-sm font-medium text-foreground">
          Logo URL <span className="text-muted-foreground">(optional)</span>
        </label>
        <input id="logo_url" name="logo_url" type="url" defaultValue={restaurant.logo_url ?? ''} disabled={isPending}
          placeholder="https://…"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" />
      </div>

      <div className="flex justify-end">
        <button type="submit" disabled={isPending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
          {isPending ? 'Saving…' : 'Save Info'}
        </button>
      </div>
    </form>
  )
}
