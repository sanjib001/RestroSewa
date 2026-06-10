'use client'

import { useTransition } from 'react'
import { markAllNotificationsRead } from '@/app/actions/notifications'

export function MarkAllReadButton() {
  const [isPending, startTransition] = useTransition()

  return (
    <button
      onClick={() => startTransition(async () => { await markAllNotificationsRead() })}
      disabled={isPending}
      className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
    >
      {isPending ? '…' : 'Mark all read'}
    </button>
  )
}
