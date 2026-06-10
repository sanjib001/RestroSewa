'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuth, hasPermission } from '@/lib/auth'
import type { ActionResult } from '@/types/app'

async function guard() {
  const user = await requireAuth()
  if (!hasPermission(user, 'MANAGE_MENU')) return { user: null as null, error: 'Permission denied.' }
  if (!user.restaurantId) return { user: null as null, error: 'No restaurant associated with your account.' }
  return { user, error: null }
}

export async function createCategory(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const { user, error } = await guard()
  if (!user) return { success: false, error: error! }

  const name = (formData.get('name') as string)?.trim()
  const description = (formData.get('description') as string)?.trim() || null
  const sortOrder = parseInt(formData.get('sort_order') as string) || 0

  if (!name) return { success: false, error: 'Category name is required.' }

  const service = createServiceClient()
  const { data, error: dbError } = await service
    .from('menu_categories')
    .insert({ restaurant_id: user.restaurantId, name, description, sort_order: sortOrder })
    .select('id')
    .single()

  if (dbError) return { success: false, error: 'Failed to create category.', code: 'DB_ERROR' }

  revalidatePath('/operations/admin/menu')
  return { success: true, data: { id: (data as { id: string }).id } }
}

export async function updateCategory(categoryId: string, formData: FormData): Promise<ActionResult<void>> {
  const { user, error } = await guard()
  if (!user) return { success: false, error: error! }

  const name = (formData.get('name') as string)?.trim()
  const description = (formData.get('description') as string)?.trim() || null
  const sortOrder = parseInt(formData.get('sort_order') as string) || 0
  const isActive = formData.get('is_active') === 'true'

  if (!name) return { success: false, error: 'Category name is required.' }

  const service = createServiceClient()
  const { error: dbError } = await service
    .from('menu_categories')
    .update({ name, description, sort_order: sortOrder, is_active: isActive })
    .eq('id', categoryId)
    .eq('restaurant_id', user.restaurantId!)

  if (dbError) return { success: false, error: 'Failed to update category.', code: 'DB_ERROR' }

  revalidatePath('/operations/admin/menu')
  return { success: true, data: undefined }
}

export async function deleteCategory(categoryId: string): Promise<ActionResult<void>> {
  const { user, error } = await guard()
  if (!user) return { success: false, error: error! }

  const service = createServiceClient()

  const { count } = await service
    .from('menu_items')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', categoryId)
    .eq('restaurant_id', user.restaurantId!)

  if ((count ?? 0) > 0) {
    return { success: false, error: 'Cannot delete — move or delete all items in this category first.' }
  }

  const { error: dbError } = await service
    .from('menu_categories')
    .delete()
    .eq('id', categoryId)
    .eq('restaurant_id', user.restaurantId!)

  if (dbError) return { success: false, error: 'Failed to delete category.', code: 'DB_ERROR' }

  revalidatePath('/operations/admin/menu')
  return { success: true, data: undefined }
}
