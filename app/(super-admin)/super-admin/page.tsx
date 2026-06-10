import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/service'

export default async function SuperAdminDashboard() {
  const service = createServiceClient()

  const [restaurants, templates, users] = await Promise.all([
    service.from('restaurants').select('id, status', { count: 'exact' }),
    service.from('permission_templates').select('id', { count: 'exact' }),
    service.from('restaurant_users').select('id', { count: 'exact' }),
  ])

  const totalRestaurants = restaurants.count ?? 0
  const activeRestaurants = (restaurants.data as { status: string }[] ?? []).filter((r) => r.status === 'active').length
  const totalTemplates = templates.count ?? 0
  const totalUsers = users.count ?? 0

  const stats = [
    { label: 'Restaurants', value: totalRestaurants, sub: `${activeRestaurants} active`, href: '/super-admin/restaurants' },
    { label: 'Permission Templates', value: totalTemplates, sub: 'platform-wide', href: '/super-admin/templates' },
    { label: 'Total Users', value: totalUsers, sub: 'all restaurants', href: '/super-admin/restaurants' },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Platform Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">RestroSewa administration</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="rounded-lg border border-border bg-card p-6 transition-colors hover:border-primary/50"
          >
            <p className="text-sm text-muted-foreground">{s.label}</p>
            <p className="mt-2 font-heading text-3xl font-bold text-foreground">{s.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{s.sub}</p>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href="/super-admin/restaurants/new"
          className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-card p-5 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
        >
          <span className="text-xl">+</span>
          <span>Onboard a new restaurant</span>
        </Link>
        <Link
          href="/super-admin/templates/new"
          className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-card p-5 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
        >
          <span className="text-xl">+</span>
          <span>Create a permission template</span>
        </Link>
      </div>
    </div>
  )
}
