import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { UserForm } from './user-form'

export default async function NewUserPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const service = createServiceClient()

  const [restaurantRes, templatesRes] = await Promise.all([
    service.from('restaurants').select('id, name, status').eq('id', id).single(),
    service.from('permission_templates').select('id, name, permissions').order('name'),
  ])

  if (!restaurantRes.data) notFound()

  const restaurant = restaurantRes.data as { id: string; name: string; status: string }
  const templates = (templatesRes.data ?? []) as { id: string; name: string; permissions: string[] }[]

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Add User</h1>
        <p className="mt-1 text-sm text-muted-foreground">For: {restaurant.name}</p>
      </div>
      <UserForm restaurantId={restaurant.id} templates={templates} />
    </div>
  )
}
