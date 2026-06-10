import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/service'

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-green-500/15 text-green-400',
  suspended: 'bg-yellow-500/15 text-yellow-400',
  archived: 'bg-muted text-muted-foreground',
}

export default async function RestaurantsPage() {
  const service = createServiceClient()
  const { data } = await service
    .from('restaurants')
    .select('id, name, slug, status, phone, email, created_at')
    .order('created_at', { ascending: false })

  const restaurants = (data ?? []) as {
    id: string; name: string; slug: string; status: string
    phone: string | null; email: string | null; created_at: string
  }[]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">Restaurants</h1>
          <p className="mt-1 text-sm text-muted-foreground">{restaurants.length} restaurant{restaurants.length !== 1 ? 's' : ''}</p>
        </div>
        <Link
          href="/super-admin/restaurants/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Add Restaurant
        </Link>
      </div>

      {restaurants.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          No restaurants yet.{' '}
          <Link href="/super-admin/restaurants/new" className="text-primary underline-offset-4 hover:underline">
            Add the first one
          </Link>
          .
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Slug</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Contact</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {restaurants.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium text-foreground">{r.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{r.slug}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[r.status] ?? ''}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{r.email ?? r.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/super-admin/restaurants/${r.id}`}
                      className="text-xs text-primary hover:underline"
                    >
                      Manage →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
