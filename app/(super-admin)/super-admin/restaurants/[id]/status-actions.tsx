'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setRestaurantStatus } from '@/app/actions/restaurants'

export function RestaurantStatusActions({
  restaurantId,
  currentStatus,
}: {
  restaurantId: string
  currentStatus: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function handleStatus(status: 'active' | 'suspended' | 'archived') {
    startTransition(async () => {
      await setRestaurantStatus(restaurantId, status)
      router.refresh()
    })
  }

  return (
    <div className="flex items-center gap-2">
      {currentStatus === 'active' && (
        <button
          onClick={() => handleStatus('suspended')}
          disabled={isPending}
          className="rounded-md border border-yellow-500/40 px-3 py-1.5 text-xs font-medium text-yellow-400 hover:bg-yellow-500/10 disabled:opacity-50"
        >
          Suspend
        </button>
      )}
      {currentStatus === 'suspended' && (
        <button
          onClick={() => handleStatus('active')}
          disabled={isPending}
          className="rounded-md border border-green-500/40 px-3 py-1.5 text-xs font-medium text-green-400 hover:bg-green-500/10 disabled:opacity-50"
        >
          Reactivate
        </button>
      )}
      {currentStatus !== 'archived' && (
        <button
          onClick={() => handleStatus('archived')}
          disabled={isPending}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          Archive
        </button>
      )}
    </div>
  )
}
