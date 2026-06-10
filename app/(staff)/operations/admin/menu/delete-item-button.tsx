'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteMenuItem } from '@/app/actions/menu-items'

export function DeleteItemButton({ itemId, itemName }: { itemId: string; itemName: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  return (
    <button
      onClick={() => {
        if (!confirm(`Delete "${itemName}"? This cannot be undone.`)) return
        startTransition(async () => {
          const result = await deleteMenuItem(itemId)
          if (!result.success) { alert(result.error); return }
          router.refresh()
        })
      }}
      disabled={isPending}
      className="shrink-0 text-xs text-destructive/50 hover:text-destructive disabled:opacity-50"
    >
      {isPending ? '…' : 'Delete'}
    </button>
  )
}
