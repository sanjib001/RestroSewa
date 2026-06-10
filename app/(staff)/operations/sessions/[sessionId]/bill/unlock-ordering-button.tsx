'use client'

import { useTransition } from 'react'
import { unlockOrdering } from '@/app/actions/sessions'

export function UnlockOrderingButton({ sessionId }: { sessionId: string }) {
  const [isPending, startTransition] = useTransition()

  return (
    <section>
      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <p className="text-sm font-medium text-foreground">Customer wants to continue ordering?</p>
        <p className="text-xs text-muted-foreground">
          Unlocks ordering and cancels the bill request. The customer can place more orders.
        </p>
        <button
          onClick={() =>
            startTransition(async () => {
              await unlockOrdering(sessionId)
            })
          }
          disabled={isPending}
          className="mt-1 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
        >
          {isPending ? '…' : 'Unlock Ordering'}
        </button>
      </div>
    </section>
  )
}
