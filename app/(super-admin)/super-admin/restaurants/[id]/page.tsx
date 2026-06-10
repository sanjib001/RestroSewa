import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { RestaurantStatusActions } from './status-actions'
import { UserRow } from './user-row'

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-green-500/15 text-green-400',
  suspended: 'bg-yellow-500/15 text-yellow-400',
  archived: 'bg-muted text-muted-foreground',
}

export default async function RestaurantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const service = createServiceClient()

  const [restaurantRes, usersRes] = await Promise.all([
    service
      .from('restaurants')
      .select('id, name, slug, status, phone, email, address, created_at')
      .eq('id', id)
      .single(),
    service
      .from('restaurant_users')
      .select('id, employee_id, name, display_title, role, is_active, auth_user_id, permission_templates(id, name)')
      .eq('restaurant_id', id)
      .order('created_at', { ascending: true }),
  ])

  if (!restaurantRes.data) notFound()

  const r = restaurantRes.data as {
    id: string; name: string; slug: string; status: string
    phone: string | null; email: string | null; address: string | null; created_at: string
  }

  const users = (usersRes.data ?? []) as unknown as {
    id: string; employee_id: string; name: string; display_title: string
    role: string; is_active: boolean; auth_user_id: string
    permission_templates: { id: string; name: string } | null
  }[]

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="font-heading text-2xl font-semibold text-foreground">{r.name}</h1>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[r.status] ?? ''}`}>
              {r.status}
            </span>
          </div>
          <p className="font-mono text-xs text-muted-foreground">/r/{r.slug}/login</p>
        </div>
        <RestaurantStatusActions restaurantId={r.id} currentStatus={r.status} />
      </div>

      {/* Restaurant info */}
      <div className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-card p-5 sm:grid-cols-4">
        {[
          { label: 'Phone', value: r.phone },
          { label: 'Email', value: r.email },
          { label: 'Address', value: r.address },
          { label: 'Created', value: new Date(r.created_at).toLocaleDateString('en-IN') },
        ].map(({ label, value }) => (
          <div key={label}>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-0.5 text-sm text-foreground">{value ?? '—'}</p>
          </div>
        ))}
      </div>

      {/* Users */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold text-foreground">
            Users <span className="ml-1 text-sm font-normal text-muted-foreground">({users.length})</span>
          </h2>
          <Link
            href={`/super-admin/restaurants/${r.id}/users/new`}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Add User
          </Link>
        </div>

        {users.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
            No users yet.{' '}
            <Link href={`/super-admin/restaurants/${r.id}/users/new`} className="text-primary hover:underline">
              Add the first user
            </Link>
            .
          </div>
        ) : (
          <div className="rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Employee ID</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Title</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Role</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Template</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Active</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <UserRow key={u.id} user={u} restaurantId={r.id} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="text-xs text-muted-foreground">
        <Link href="/super-admin/restaurants" className="hover:underline">← Back to restaurants</Link>
      </div>
    </div>
  )
}
