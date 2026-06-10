'use client'

import { useState, useTransition } from 'react'
import { updateRestaurantSettings } from '@/app/actions/restaurant-settings'

type Settings = {
  cleaning_required: boolean
  sound_notifications_enabled: boolean
  default_service_charge_percent: number
}

export function OperationalSettingsForm({ settings }: { settings: Settings }) {
  const [isPending, startTransition] = useTransition()
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await updateRestaurantSettings(formData)
      if (!result.success) { setError(result.error); return }
      setSuccess(true)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border border-border bg-card p-6">
      {error && <p className="rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</p>}
      {success && <p className="rounded-md bg-green-500/10 px-4 py-2 text-sm text-green-400">Saved.</p>}

      <div>
        <label htmlFor="default_service_charge_percent" className="mb-1.5 block text-sm font-medium text-foreground">
          Default Service Charge (%)
        </label>
        <input
          id="default_service_charge_percent"
          name="default_service_charge_percent"
          type="number"
          min="0"
          max="100"
          step="0.01"
          defaultValue={settings.default_service_charge_percent ?? 0}
          disabled={isPending}
          className="w-40 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        <p className="mt-1 text-xs text-muted-foreground">Applied automatically to new sessions. Can be removed at billing.</p>
      </div>

      <div className="space-y-3">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            name="cleaning_required"
            value="true"
            defaultChecked={settings.cleaning_required}
            disabled={isPending}
            className="h-4 w-4 rounded border-input accent-primary disabled:opacity-50"
          />
          <span className="text-sm text-foreground">Require table cleaning before re-activation</span>
        </label>

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            name="sound_notifications_enabled"
            value="true"
            defaultChecked={settings.sound_notifications_enabled}
            disabled={isPending}
            className="h-4 w-4 rounded border-input accent-primary disabled:opacity-50"
          />
          <span className="text-sm text-foreground">Enable sound notifications for staff</span>
        </label>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? 'Saving…' : 'Save Settings'}
        </button>
      </div>
    </form>
  )
}
