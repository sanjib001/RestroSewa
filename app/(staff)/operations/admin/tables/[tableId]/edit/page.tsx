import { notFound, redirect } from 'next/navigation'
import { getAuthUser, hasPermission } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { EditTableForm } from './edit-table-form'

export default async function EditTablePage({ params }: { params: Promise<{ tableId: string }> }) {
  const { tableId } = await params
  const user = await getAuthUser()
  if (!user || !hasPermission(user, 'MANAGE_TABLES')) redirect('/operations')

  const service = createServiceClient()
  const [tableRes, groupsRes] = await Promise.all([
    service
      .from('restaurant_tables')
      .select('id, display_name, table_group_id, position')
      .eq('id', tableId)
      .eq('restaurant_id', user.restaurantId!)
      .single(),
    service
      .from('table_groups')
      .select('id, name')
      .eq('restaurant_id', user.restaurantId!)
      .order('name'),
  ])

  if (!tableRes.data) notFound()

  const table = tableRes.data as { id: string; display_name: string; table_group_id: string | null; position: number }
  const groups = (groupsRes.data ?? []) as { id: string; name: string }[]

  return (
    <div className="max-w-lg">
      <h1 className="mb-6 font-heading text-2xl font-semibold text-foreground">Edit Table</h1>
      <EditTableForm table={table} groups={groups} />
    </div>
  )
}
