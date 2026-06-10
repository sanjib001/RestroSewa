'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function RestaurantPortalForm() {
  const router = useRouter()
  const [slug, setSlug] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = slug.trim().toLowerCase()
    if (trimmed) {
      router.push(`/r/${trimmed}/login`)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="slug" className="text-sm font-medium text-foreground">
          Restaurant URL
        </label>
        <div className="flex items-center rounded-md border border-input bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
          <span className="shrink-0 select-none text-sm text-muted-foreground">r/</span>
          <input
            id="slug"
            type="text"
            autoFocus
            required
            value={slug}
            onChange={(e) => setSlug(e.target.value.replace(/[^a-z0-9-]/gi, '').toLowerCase())}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            placeholder="your-restaurant"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={!slug.trim()}
        className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Continue
      </button>

      <p className="text-center text-xs text-muted-foreground">
        Your restaurant URL was provided by your manager.
      </p>
    </form>
  )
}
