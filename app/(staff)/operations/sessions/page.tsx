import { notFound } from 'next/navigation'
import { requireAuth, hasPermission } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { SessionTableCard } from './session-table-card'

export default async function SessionsPage() {
  const user = await requireAuth()
  if (!user.restaurantId) notFound()

  const service = createServiceClient()

  const [tablesRes, sessionsRes, groupsRes] = await Promise.all([
    service
      .from('restaurant_tables')
      .select('id, display_name, status, table_group_id')
      .eq('restaurant_id', user.restaurantId)
      .order('position', { ascending: true }),
    service
      .from('sessions')
      .select('id, table_id, started_at, ordering_locked, bill_requested')
      .eq('restaurant_id', user.restaurantId)
      .eq('status', 'active'),
    service
      .from('table_groups')
      .select('id, name')
      .eq('restaurant_id', user.restaurantId),
  ])

  const groupNames = new Map<string, string>()
  for (const g of (groupsRes.data ?? []) as any[]) {
    groupNames.set(g.id, g.name)
  }

  const sessionByTable = new Map<string, any>()
  for (const s of (sessionsRes.data ?? []) as any[]) {
    sessionByTable.set(s.table_id, s)
  }

  const tables = ((tablesRes.data ?? []) as any[]).map((t) => ({
    id: t.id as string,
    display_name: t.display_name as string,
    status: t.status as string,
    group_name: t.table_group_id ? (groupNames.get(t.table_group_id) ?? null) : null,
    session: (sessionByTable.get(t.id) ?? null) as {
      id: string
      started_at: string
      ordering_locked: boolean
      bill_requested: boolean
    } | null,
  }))

  const canActivate = hasPermission(user, 'ACTIVATE_SESSION')
  const canClose = hasPermission(user, 'CLOSE_SESSION')

  const waiting = tables.filter((t) => t.status === 'waiting_activation')
  const occupied = tables.filter((t) => t.status === 'occupied')
  const cleaning = tables.filter((t) => t.status === 'cleaning')
  const available = tables.filter((t) => t.status === 'available')

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">Sessions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage table sessions and customer flow.
        </p>
      </div>

      {tables.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No tables configured. Add tables in the{' '}
            <a href="/operations/admin/tables" className="text-primary underline underline-offset-2">
              Tables
            </a>{' '}
            admin page.
          </p>
        </div>
      )}

      {waiting.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <h2 className="text-sm font-semibold text-foreground">
              Waiting for Activation
              <span className="ml-2 text-muted-foreground">({waiting.length})</span>
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {waiting.map((t) => (
              <SessionTableCard
                key={t.id}
                table={t}
                canActivate={canActivate}
                canClose={canClose}
              />
            ))}
          </div>
        </section>
      )}

      {occupied.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            <h2 className="text-sm font-semibold text-foreground">
              Occupied
              <span className="ml-2 text-muted-foreground">({occupied.length})</span>
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {occupied.map((t) => (
              <SessionTableCard
                key={t.id}
                table={t}
                canActivate={canActivate}
                canClose={canClose}
              />
            ))}
          </div>
        </section>
      )}

      {cleaning.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">
              Cleaning Required
              <span className="ml-2 text-muted-foreground">({cleaning.length})</span>
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cleaning.map((t) => (
              <SessionTableCard
                key={t.id}
                table={t}
                canActivate={canActivate}
                canClose={canClose}
              />
            ))}
          </div>
        </section>
      )}

      {available.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            <h2 className="text-sm font-semibold text-foreground">
              Available
              <span className="ml-2 text-muted-foreground">({available.length})</span>
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {available.map((t) => (
              <SessionTableCard
                key={t.id}
                table={t}
                canActivate={canActivate}
                canClose={canClose}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
