import Link from 'next/link'
import { getAuthUser, hasPermission } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'

export default async function OperationsPage() {
  const user = await getAuthUser()
  if (!user) return null

  const service = createServiceClient()

  const [tableCountRes, sessionCountRes, pendingOrderCountRes, unreadNotifRes] = await Promise.all([
    service
      .from('restaurant_tables')
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', user.restaurantId!),
    service
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', user.restaurantId!)
      .eq('status', 'active'),
    service
      .from('session_orders')
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', user.restaurantId!)
      .eq('status', 'pending'),
    service
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', user.restaurantId!)
      .eq('status', 'unread'),
  ])

  const tableCount = tableCountRes.count ?? 0
  const sessionCount = sessionCountRes.count ?? 0
  const pendingOrderCount = pendingOrderCountRes.count ?? 0
  const unreadNotifCount = unreadNotifRes.count ?? 0

  const isAdmin = user.role === 'restaurant_admin'
  const canManageTables = hasPermission(user, 'MANAGE_TABLES')
  const canManageMenu = hasPermission(user, 'MANAGE_MENU')

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Operations Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isAdmin ? 'Restaurant Admin' : 'Staff'} · {tableCount} table{tableCount !== 1 ? 's' : ''} configured
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/operations/sessions"
          className="rounded-lg border border-border bg-card p-6 hover:border-primary/50 transition-colors"
        >
          <p className="text-sm font-medium text-muted-foreground">Active Sessions</p>
          <p className="mt-2 font-heading text-3xl font-bold text-foreground">{sessionCount}</p>
          <p className="mt-1 text-xs text-primary">Manage sessions →</p>
        </Link>

        <Link
          href="/operations/orders"
          className="rounded-lg border border-border bg-card p-6 hover:border-primary/50 transition-colors"
        >
          <p className="text-sm font-medium text-muted-foreground">Pending Orders</p>
          <p className={`mt-2 font-heading text-3xl font-bold ${pendingOrderCount > 0 ? 'text-amber-600' : 'text-foreground'}`}>
            {pendingOrderCount}
          </p>
          <p className="mt-1 text-xs text-primary">Manage orders →</p>
        </Link>

        <Link
          href="/operations/notifications"
          className="rounded-lg border border-border bg-card p-6 hover:border-primary/50 transition-colors"
        >
          <p className="text-sm font-medium text-muted-foreground">Unread Notifications</p>
          <p className={`mt-2 font-heading text-3xl font-bold ${unreadNotifCount > 0 ? 'text-amber-600' : 'text-foreground'}`}>
            {unreadNotifCount}
          </p>
          <p className="mt-1 text-xs text-primary">View all →</p>
        </Link>
      </div>

      {(isAdmin || canManageTables || canManageMenu) && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Setup</h2>
          <div className="flex flex-wrap gap-3">
            {canManageTables && (
              <Link
                href="/operations/admin/tables"
                className="rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground hover:border-primary/50"
              >
                Manage Tables →
              </Link>
            )}
            {canManageMenu && (
              <Link
                href="/operations/admin/menu"
                className="rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground hover:border-primary/50"
              >
                Manage Menu →
              </Link>
            )}
            {isAdmin && (
              <Link
                href="/operations/admin/settings"
                className="rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground hover:border-primary/50"
              >
                Restaurant Settings →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
