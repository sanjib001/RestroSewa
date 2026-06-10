import { redirect } from 'next/navigation'
import { getAuthUser, hasPermission } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { TableForm } from './table-form'

export default async function NewTablePage() {
  const user = await getAuthUser()
  if (!user || !hasPermission(user, 'MANAGE_TABLES')) redirect('/operations')

  const service = createServiceClient()
  const { data } = await service
    .from('table_groups')
    .select('id, name')
    .eq('restaurant_id', user.restaurantId!)
    .order('name')

  const groups = (data ?? []) as { id: string; name: string }[]

  return (
    <div className="max-w-lg">
      <h1 className="mb-6 font-heading text-2xl font-semibold text-foreground">New Table</h1>
      <TableForm groups={groups} />
    </div>
  )
}
