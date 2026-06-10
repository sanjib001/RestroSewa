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

function parsePrice(raw: FormDataEntryValue | null): number {
  const n = parseFloat(raw as string)
  if (isNaN(n) || n < 0) return 0
  return Math.round(n * 100) // rupees → paise
}

export async function createMenuItem(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const { user, error } = await guard()
  if (!user) return { success: false, error: error! }

  const name = (formData.get('name') as string)?.trim()
  const description = (formData.get('description') as string)?.trim() || null
  const basePrice = parsePrice(formData.get('base_price'))
  const categoryId = (formData.get('category_id') as string) || null
  const isVeg = formData.get('is_veg') === 'true'
  const isSpecial = formData.get('is_special') === 'true'
  const sortOrder = parseInt(formData.get('sort_order') as string) || 0

  if (!name) return { success: false, error: 'Item name is required.' }

  const service = createServiceClient()
  const { data, error: dbError } = await service
    .from('menu_items')
    .insert({
      restaurant_id: user.restaurantId,
      category_id: categoryId,
      name,
      description,
      base_price: basePrice,
      is_veg: isVeg,
      is_special: isSpecial,
      sort_order: sortOrder,
      status: 'available',
    })
    .select('id')
    .single()

  if (dbError) return { success: false, error: 'Failed to create menu item.', code: 'DB_ERROR' }

  revalidatePath('/operations/admin/menu')
  return { success: true, data: { id: (data as { id: string }).id } }
}

export async function updateMenuItem(itemId: string, formData: FormData): Promise<ActionResult<void>> {
  const { user, error } = await guard()
  if (!user) return { success: false, error: error! }

  const name = (formData.get('name') as string)?.trim()
  const description = (formData.get('description') as string)?.trim() || null
  const basePrice = parsePrice(formData.get('base_price'))
  const categoryId = (formData.get('category_id') as string) || null
  const isVeg = formData.get('is_veg') === 'true'
  const isSpecial = formData.get('is_special') === 'true'
  const sortOrder = parseInt(formData.get('sort_order') as string) || 0

  if (!name) return { success: false, error: 'Item name is required.' }

  const service = createServiceClient()
  const { error: dbError } = await service
    .from('menu_items')
    .update({ name, description, base_price: basePrice, category_id: categoryId, is_veg: isVeg, is_special: isSpecial, sort_order: sortOrder })
    .eq('id', itemId)
    .eq('restaurant_id', user.restaurantId!)

  if (dbError) return { success: false, error: 'Failed to update menu item.', code: 'DB_ERROR' }

  revalidatePath('/operations/admin/menu')
  return { success: true, data: undefined }
}

export async function setMenuItemStatus(
  itemId: string,
  status: 'available' | 'out_of_stock' | 'hidden',
): Promise<ActionResult<void>> {
  const { user, error } = await guard()
  if (!user) return { success: false, error: error! }

  const service = createServiceClient()
  const { error: dbError } = await service
    .from('menu_items')
    .update({ status })
    .eq('id', itemId)
    .eq('restaurant_id', user.restaurantId!)

  if (dbError) return { success: false, error: 'Failed to update item status.', code: 'DB_ERROR' }

  revalidatePath('/operations/admin/menu')
  return { success: true, data: undefined }
}

export async function deleteMenuItem(itemId: string): Promise<ActionResult<void>> {
  const { user, error } = await guard()
  if (!user) return { success: false, error: error! }

  const service = createServiceClient()
  const { error: dbError } = await service
    .from('menu_items')
    .delete()
    .eq('id', itemId)
    .eq('restaurant_id', user.restaurantId!)

  if (dbError) return { success: false, error: 'Failed to delete menu item.', code: 'DB_ERROR' }

  revalidatePath('/operations/admin/menu')
  return { success: true, data: undefined }
}
