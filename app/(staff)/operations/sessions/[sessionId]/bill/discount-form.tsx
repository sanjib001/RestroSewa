'use client'

import { useState, useTransition } from 'react'
import { applyDiscount, removeDiscount } from '@/app/actions/payments'

function fmt(paise: number) {
  return `₹${(paise / 100).toFixed(2)}`
}

type DiscountInfo = {
  id: string
  type: 'fixed' | 'percentage'
  value: number
  displayAmount: number
}

export function DiscountForm({
  sessionId,
  currentDiscount,
}: {
  sessionId: string
  currentDiscount: DiscountInfo | null
}) {
  const [type, setType] = useState<'percentage' | 'fixed'>('percentage')
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleApply() {
    const parsed = parseFloat(value)
    if (isNaN(parsed) || parsed <= 0) { setError('Enter a valid discount value.'); return }
    if (type === 'percentage' && parsed > 100) { setError('Percentage cannot exceed 100.'); return }

    const storedValue =
      type === 'fixed'
        ? Math.round(parsed * 100) // rupees → paise
        : Math.round(parsed) // integer percent (e.g. 10 for 10%)

    setError(null)
    startTransition(async () => {
      const result = await applyDiscount(sessionId, type, storedValue)
      if (!result.success) setError(result.error)
      else setValue('')
    })
  }

  function handleRemove() {
    setError(null)
    startTransition(async () => {
      const result = await removeDiscount(sessionId)
      if (!result.success) setError(result.error)
    })
  }

  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Discount
      </h2>
      <div
        className={`rounded-xl border border-border bg-card p-4 space-y-3 transition-opacity ${isPending ? 'opacity-50 pointer-events-none' : ''}`}
      >
        {currentDiscount ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">
                {currentDiscount.type === 'percentage'
                  ? `${currentDiscount.value}% discount`
                  : `${fmt(currentDiscount.value)} discount`}
              </p>
              <p className="text-xs text-green-600">-{fmt(currentDiscount.displayAmount)} off the bill</p>
            </div>
            <button
              onClick={handleRemove}
              disabled={isPending}
              className="text-xs text-destructive hover:text-destructive/80 disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setType('percentage')}
                className={`rounded-lg border py-2 text-sm font-medium transition-colors ${
                  type === 'percentage'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/50'
                }`}
              >
                Percentage (%)
              </button>
              <button
                onClick={() => setType('fixed')}
                className={`rounded-lg border py-2 text-sm font-medium transition-colors ${
                  type === 'fixed'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/50'
                }`}
              >
                Fixed Amount (₹)
              </button>
            </div>

            <div className="flex gap-2">
              <input
                type="number"
                step={type === 'fixed' ? '0.01' : '1'}
                min="0"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={type === 'percentage' ? 'e.g. 10' : 'e.g. 50.00'}
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                onClick={handleApply}
                disabled={isPending || !value}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                Apply
              </button>
            </div>
          </>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </section>
  )
}
