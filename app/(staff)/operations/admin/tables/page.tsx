import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAuthUser, hasPermission } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { GroupManager } from './group-manager'
import { TableRow } from './table-row'

export default async function TablesPage() {
  const user = await getAuthUser()
  if (!user || !hasPermission(user, 'MANAGE_TABLES')) redirect('/operations')

  const service = createServiceClient()
  const [groupsRes, tablesRes] = await Promise.all([
    service
      .from('table_groups')
      .select('id, name')
      .eq('restaurant_id', user.restaurantId!)
      .order('name'),
    service
      .from('restaurant_tables')
      .select('id, display_name, status, qr_token, position, table_group_id')
      .eq('restaurant_id', user.restaurantId!)
      .order('position', { ascending: true }),
  ])

  const groups = (groupsRes.data ?? []) as { id: string; name: string }[]
  const tables = (tablesRes.data ?? []) as {
    id: string; display_name: string; status: string
    qr_token: string; position: number; table_group_id: string | null
  }[]

  // Organise tables under groups
  const byGroup = new Map<string | null, typeof tables>()
  byGroup.set(null, [])
  for (const g of groups) byGroup.set(g.id, [])
  for (const t of tables) byGroup.get(t.table_group_id ?? null)?.push(t)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">Tables</h1>
          <p className="mt-1 text-sm text-muted-foreground">{tables.length} table{tables.length !== 1 ? 's' : ''} · {groups.length} group{groups.length !== 1 ? 's' : ''}</p>
        </div>
        <Link href="/operations/admin/tables/new" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
          Add Table
        </Link>
      </div>

      {/* Group Management */}
      <GroupManager groups={groups} />

      {/* Tables by Group */}
      <div className="space-y-6">
        {groups.map((g) => {
          const groupTables = byGroup.get(g.id) ?? []
          return (
            <section key={g.id}>
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">{g.name} ({groupTables.length})</h2>
              {groupTables.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border py-4 text-center text-xs text-muted-foreground">
                  No tables in this group.
                </p>
              ) : (
                <TableList tables={groupTables} appUrl={appUrl} />
              )}
            </section>
          )
        })}

        {/* Ungrouped */}
        {(byGroup.get(null)?.length ?? 0) > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">No Group ({byGroup.get(null)!.length})</h2>
            <TableList tables={byGroup.get(null)!} appUrl={appUrl} />
          </section>
        )}

        {tables.length === 0 && (
          <div className="rounded-lg border border-dashed border-border py-16 text-center">
            <p className="text-sm text-muted-foreground">No tables yet.</p>
            <Link href="/operations/admin/tables/new" className="mt-2 inline-block text-sm text-primary hover:underline">
              Add your first table
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

function TableList({
  tables,
  appUrl,
}: {
  tables: { id: string; display_name: string; status: string; qr_token: string; position: number; table_group_id: string | null }[]
  appUrl: string
}) {
  return (
    <div className="rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">QR URL</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {tables.map((t) => (
            <TableRow key={t.id} table={t} appUrl={appUrl} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
