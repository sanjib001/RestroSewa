'use client'

import { useState, useTransition } from 'react'
import { signInEmployee } from '@/app/actions/auth'

export default function EmployeeLoginForm({
  slug,
  disabled,
}: {
  slug: string
  disabled: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const [employeeId, setEmployeeId] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    startTransition(async () => {
      const result = await signInEmployee(employeeId, slug, pin)
      if (!result.success) {
        setError(result.error)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="employeeId" className="text-sm font-medium text-foreground">
          Employee ID
        </label>
        <input
          id="employeeId"
          type="text"
          autoComplete="username"
          autoFocus
          required
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          disabled={disabled || isPending}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          placeholder="Enter your employee ID"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="pin" className="text-sm font-medium text-foreground">
          PIN
        </label>
        <input
          id="pin"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          required
          minLength={4}
          maxLength={8}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          disabled={disabled || isPending}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground tracking-widest focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          placeholder="••••"
        />
      </div>

      <button
        type="submit"
        disabled={disabled || isPending || !employeeId.trim() || pin.length < 4}
        className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? 'Signing in…' : 'Sign In'}
      </button>
    </form>
  )
}
