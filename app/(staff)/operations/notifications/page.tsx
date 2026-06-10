import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { notFound } from 'next/navigation'
import { MarkAllReadButton } from './mark-all-read-button'
import { NotificationRow } from './notification-row'

function timeAgo(timestamp: string): string {
  const diffMs = Date.now() - new Date(timestamp).getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const hours = Math.floor(diffMins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default async function NotificationsPage() {
  const user = await requireAuth()
  if (!user.restaurantId) notFound()

  const service = createServiceClient()

  // Fetch unread + recent read (last 7 days), exclude dismissed
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await service
    .from('notifications')
    .select('id, type, message, status, session_id, order_id, table_id, created_at')
    .eq('restaurant_id', user.restaurantId)
    .neq('status', 'dismissed')
    .gte('created_at', sevenDaysAgo)
    .order('created_at', { ascending: false })
    .limit(100)

  const notifications = ((data ?? []) as any[]).map((n) => ({
    ...n,
    timeAgo: timeAgo(n.created_at),
  }))

  const unread = notifications.filter((n) => n.status === 'unread')
  const read = notifications.filter((n) => n.status === 'read')

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">Notifications</h1>
          {unread.length > 0 && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {unread.length} unread
            </p>
          )}
        </div>
        {unread.length > 0 && <MarkAllReadButton />}
      </div>

      {notifications.length === 0 && (
        <div className="rounded-xl border border-border bg-card px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">No notifications in the last 7 days.</p>
        </div>
      )}

      {unread.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Unread
          </h2>
          {unread.map((n) => (
            <NotificationRow key={n.id} notification={n} />
          ))}
        </section>
      )}

      {read.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Earlier
          </h2>
          {read.map((n) => (
            <NotificationRow key={n.id} notification={n} />
          ))}
        </section>
      )}
    </div>
  )
}
