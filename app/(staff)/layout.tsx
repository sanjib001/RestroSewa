import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAuthUser, hasPermission } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { SignOutButton } from '@/components/staff/sign-out-button'
import { RealtimeRefresher } from '@/components/staff/realtime-refresher'

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthUser()
  if (!user || (user.role !== 'restaurant_admin' && user.role !== 'restaurant_employee')) {
    redirect('/unauthorized')
  }

  let restaurantName = 'Restaurant'
  let unreadCount = 0
  let soundEnabled = false

  if (user.restaurantId) {
    const service = createServiceClient()
    const [restaurantRes, notifRes, settingsRes] = await Promise.all([
      service.from('restaurants').select('name').eq('id', user.restaurantId).single(),
      service
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', user.restaurantId)
        .eq('status', 'unread'),
      service
        .from('restaurant_settings')
        .select('sound_notifications_enabled')
        .eq('restaurant_id', user.restaurantId)
        .single(),
    ])
    if (restaurantRes.data) restaurantName = (restaurantRes.data as any).name
    unreadCount = notifRes.count ?? 0
    soundEnabled = (settingsRes.data as any)?.sound_notifications_enabled ?? false
  }

  const isAdmin = user.role === 'restaurant_admin'
  const canManageTables = hasPermission(user, 'MANAGE_TABLES')
  const canManageMenu = hasPermission(user, 'MANAGE_MENU')

  return (
    <div className="min-h-screen bg-background">
      {user.restaurantId && (
        <RealtimeRefresher restaurantId={user.restaurantId} soundEnabled={soundEnabled} />
      )}
      <header className="sticky top-0 z-10 border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-8">
            <span className="font-heading text-base font-semibold text-foreground">{restaurantName}</span>
            <nav className="flex items-center gap-1">
              <Link href="/operations" className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                Dashboard
              </Link>
              <Link href="/operations/sessions" className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                Sessions
              </Link>
              <Link href="/operations/orders" className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                Orders
              </Link>
              <Link href="/operations/notifications" className="relative rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                Notifications
                {unreadCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </Link>
              {canManageTables && (
                <Link href="/operations/admin/tables" className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  Tables
                </Link>
              )}
              {canManageMenu && (
                <Link href="/operations/admin/menu" className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  Menu
                </Link>
              )}
              {isAdmin && (
                <Link href="/operations/admin/reports" className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  Reports
                </Link>
              )}
              {isAdmin && (
                <Link href="/operations/admin/settings" className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  Settings
                </Link>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{isAdmin ? 'Admin' : user.restaurantUserId}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  )
}
