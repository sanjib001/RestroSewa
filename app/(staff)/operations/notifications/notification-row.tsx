'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { markNotificationRead, dismissNotification } from '@/app/actions/notifications'

type NotificationType =
  | 'new_arrival'
  | 'new_order'
  | 'help_request'
  | 'bill_request'
  | 'payment_completed'

type Notification = {
  id: string
  type: string
  message: string
  status: string
  session_id: string | null
  order_id: string | null
  table_id: string | null
  created_at: string
  timeAgo: string
}

const TYPE_CONFIG: Record<
  string,
  { label: string; badge: string; href: (n: Notification) => string }
> = {
  new_order: {
    label: 'New Order',
    badge: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
    href: () => '/operations/orders',
  },
  new_arrival: {
    label: 'Arrived',
    badge: 'bg-blue-500/10 text-blue-700 border-blue-500/20',
    href: () => '/operations/sessions',
  },
  help_request: {
    label: 'Help',
    badge: 'bg-red-500/10 text-red-700 border-red-500/20',
    href: () => '/operations/sessions',
  },
  bill_request: {
    label: 'Bill',
    badge: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
    href: (n) =>
      n.session_id ? `/operations/sessions/${n.session_id}/bill` : '/operations/sessions',
  },
  payment_completed: {
    label: 'Payment',
    badge: 'bg-green-500/10 text-green-700 border-green-500/20',
    href: () => '/operations/sessions',
  },
}

export function NotificationRow({ notification }: { notification: Notification }) {
  const [isPending, startTransition] = useTransition()
  const config = TYPE_CONFIG[notification.type] ?? {
    label: notification.type,
    badge: 'bg-muted text-muted-foreground border-border',
    href: () => '/operations',
  }

  const isUnread = notification.status === 'unread'
  const viewHref = config.href(notification)

  function handleMarkRead() {
    startTransition(async () => {
      await markNotificationRead(notification.id)
    })
  }

  function handleDismiss() {
    startTransition(async () => {
      await dismissNotification(notification.id)
    })
  }

  return (
    <div
      className={`flex items-start gap-4 rounded-xl border px-4 py-3.5 transition-opacity ${
        isPending ? 'opacity-40 pointer-events-none' : ''
      } ${isUnread ? 'border-border/80 bg-card' : 'border-border/40 bg-card/40'}`}
    >
      <span
        className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${config.badge}`}
      >
        {config.label}
      </span>

      <div className="min-w-0 flex-1">
        <p className={`text-sm ${isUnread ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
          {notification.message}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{notification.timeAgo}</p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Link
          href={viewHref}
          className="text-xs text-primary hover:text-primary/80"
        >
          View →
        </Link>
        {isUnread && (
          <button
            onClick={handleMarkRead}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Mark read
          </button>
        )}
        <button
          onClick={handleDismiss}
          className="text-xs text-muted-foreground hover:text-destructive"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
