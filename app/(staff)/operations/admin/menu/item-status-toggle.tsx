'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setMenuItemStatus } from '@/app/actions/menu-items'

const NEXT_STATUS: Record<string, { label: string; next: 'available' | 'out_of_stock' | 'hidden' }> = {
  available: { label: 'Mark OOS', next: 'out_of_stock' },
  out_of_stock: { label: 'Mark Avail.', next: 'available' },
  hidden: { label: 'Unhide', next: 'available' },
}

export function ItemStatusToggle({
  itemId,
  currentStatus,
}: {
  itemId: string
  currentStatus: 'available' | 'out_of_stock' | 'hidden'
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const action = NEXT_STATUS[currentStatus]

  if (!action) return null

  return (
    <button
      onClick={() =>
        startTransition(async () => {
          await setMenuItemStatus(itemId, action.next)
          router.refresh()
        })
      }
      disabled={isPending}
      className="shrink-0 rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
    >
      {isPending ? '…' : action.label}
    </button>
  )
}
