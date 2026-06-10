import { notFound, redirect } from 'next/navigation'
import { getAuthUser, hasPermission } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { EditCategoryForm } from './edit-category-form'

export default async function EditCategoryPage({
  params,
}: {
  params: Promise<{ categoryId: string }>
}) {
  const { categoryId } = await params
  const user = await getAuthUser()
  if (!user || !hasPermission(user, 'MANAGE_MENU')) redirect('/operations')

  const service = createServiceClient()
  const { data } = await service
    .from('menu_categories')
    .select('id, name, description, sort_order, is_active')
    .eq('id', categoryId)
    .eq('restaurant_id', user.restaurantId!)
    .single()

  if (!data) notFound()

  const category = data as {
    id: string; name: string; description: string | null; sort_order: number; is_active: boolean
  }

  return (
    <div className="max-w-lg">
      <h1 className="mb-6 font-heading text-2xl font-semibold text-foreground">Edit Category</h1>
      <EditCategoryForm category={category} />
    </div>
  )
}
