'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { processPayment } from '@/app/actions/payments'

type PaymentMethod = 'cash' | 'online' | 'mixed' | 'outstanding'

function fmt(paise: number) {
  return `₹${(paise / 100).toFixed(2)}`
}

export function PaymentForm({
  sessionId,
  totalPayable,
}: {
  sessionId: string
  totalPayable: number
}) {
  const router = useRouter()
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [cashAmount, setCashAmount] = useState((totalPayable / 100).toFixed(2))
  const [onlineAmount, setOnlineAmount] = useState((totalPayable / 100).toFixed(2))
  const [reference, setReference] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleMethodChange(m: PaymentMethod) {
    setMethod(m)
    setError(null)
    const full = (totalPayable / 100).toFixed(2)
    if (m === 'cash' || m === 'online') {
      setCashAmount(full)
      setOnlineAmount(full)
    }
  }

  function handleSubmit() {
    setError(null)
    startTransition(async () => {
      let payments: Array<{ method: 'cash' | 'online' | 'outstanding'; amount: number; reference?: string }>

      if (method === 'cash') {
        const amount = Math.round(parseFloat(cashAmount) * 100)
        if (isNaN(amount) || amount <= 0) { setError('Enter a valid amount.'); return }
        payments = [{ method: 'cash', amount }]
      } else if (method === 'online') {
        const amount = Math.round(parseFloat(onlineAmount) * 100)
        if (isNaN(amount) || amount <= 0) { setError('Enter a valid amount.'); return }
        payments = [{ method: 'online', amount, reference: reference || undefined }]
      } else if (method === 'mixed') {
        const cAmount = Math.round(parseFloat(cashAmount) * 100)
        const oAmount = Math.round(parseFloat(onlineAmount) * 100)
        if (isNaN(cAmount) || cAmount < 0 || isNaN(oAmount) || oAmount < 0) {
          setError('Enter valid amounts.'); return
        }
        if (cAmount + oAmount <= 0) { setError('Total payment must be greater than zero.'); return }
        payments = [
          { method: 'cash', amount: cAmount },
          { method: 'online', amount: oAmount, reference: reference || undefined },
        ]
      } else {
        // outstanding — entire balance recorded as owed
        payments = [{ method: 'outstanding', amount: totalPayable }]
      }

      const result = await processPayment(sessionId, payments)
      if (!result.success) { setError(result.error); return }
      router.replace('/operations/sessions')
    })
  }

  const methods: { id: PaymentMethod; label: string }[] = [
    { id: 'cash', label: 'Cash' },
    { id: 'online', label: 'Online' },
    { id: 'mixed', label: 'Mixed' },
    { id: 'outstanding', label: 'Outstanding' },
  ]

  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Process Payment
      </h2>
      <div
        className={`rounded-xl border border-border bg-card p-4 space-y-4 transition-opacity ${isPending ? 'opacity-50 pointer-events-none' : ''}`}
      >
        {/* Method selector */}
        <div>
          <p className="mb-2 text-sm font-medium text-foreground">Payment Method</p>
          <div className="flex flex-wrap gap-2">
            {methods.map((m) => (
              <button
                key={m.id}
                onClick={() => handleMethodChange(m.id)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                  method === m.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Cash amount */}
        {(method === 'cash' || method === 'mixed') && (
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              {method === 'mixed' ? 'Cash Amount (₹)' : 'Amount (₹)'}
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={cashAmount}
              onChange={(e) => setCashAmount(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        )}

        {/* Online amount + reference */}
        {(method === 'online' || method === 'mixed') && (
          <>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">
                {method === 'mixed' ? 'Online Amount (₹)' : 'Amount (₹)'}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={onlineAmount}
                onChange={(e) => setOnlineAmount(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">
                Transaction Reference{' '}
                <span className="text-muted-foreground">(optional)</span>
              </label>
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="UPI ID, transaction ID…"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </>
        )}

        {/* Outstanding explanation */}
        {method === 'outstanding' && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3">
            <p className="text-sm text-amber-700">
              {fmt(totalPayable)} will be recorded as outstanding. The session closes and the table
              is released immediately. The balance remains visible in reports until settled.
            </p>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={isPending}
          className={`w-full rounded-xl py-3.5 text-sm font-semibold disabled:opacity-50 ${
            method === 'outstanding'
              ? 'bg-amber-600 text-white'
              : 'bg-primary text-primary-foreground'
          }`}
        >
          {isPending
            ? 'Processing…'
            : method === 'outstanding'
            ? `Record Outstanding · ${fmt(totalPayable)}`
            : `Process Payment · ${fmt(totalPayable)}`}
        </button>
      </div>
    </section>
  )
}
