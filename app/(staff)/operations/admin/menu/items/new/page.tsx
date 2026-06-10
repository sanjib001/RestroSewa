import { redirect } from 'next/navigation'
import { getAuthUser, hasPermission } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { NewItemForm } from './new-item-form'

export default async function NewItemPage({
  searchParams,
}: {
  searchParams: Promise<{ categoryId?: string }>
}) {
  const { categoryId } = await searchParams
  const user = await getAuthUser()
  if (!user || !hasPermission(user, 'MANAGE_MENU')) redirect('/operations')

  const service = createServiceClient()
  const { data } = await service
    .from('menu_categories')
    .select('id, name')
    .eq('restaurant_id', user.restaurantId!)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  const categories = (data ?? []) as { id: string; name: string }[]

  return (
    <div className="max-w-lg">
      <h1 className="mb-6 font-heading text-2xl font-semibold text-foreground">New Menu Item</h1>
      <NewItemForm categories={categories} defaultCategoryId={categoryId ?? ''} />
    </div>
  )
}
