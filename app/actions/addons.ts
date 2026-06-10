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

export async function addAddon(
  menuItemId: string,
  name: string,
  additionalPriceRupees: number,
): Promise<ActionResult<{ id: string }>> {
  const { user, error } = await guard()
  if (!user) return { success: false, error: error! }

  const additionalPrice = Math.round(additionalPriceRupees * 100)

  const service = createServiceClient()
  const { data, error: dbError } = await service
    .from('addons')
    .insert({ restaurant_id: user.restaurantId, menu_item_id: menuItemId, name, additional_price: additionalPrice })
    .select('id')
    .single()

  if (dbError) return { success: false, error: 'Failed to add add-on.', code: 'DB_ERROR' }

  revalidatePath('/operations/admin/menu')
  return { success: true, data: { id: (data as { id: string }).id } }
}

export async function updateAddon(
  addonId: string,
  name: string,
  additionalPriceRupees: number,
): Promise<ActionResult<void>> {
  const { user, error } = await guard()
  if (!user) return { success: false, error: error! }

  const additionalPrice = Math.round(additionalPriceRupees * 100)

  const service = createServiceClient()
  const { error: dbError } = await service
    .from('addons')
    .update({ name, additional_price: additionalPrice })
    .eq('id', addonId)
    .eq('restaurant_id', user.restaurantId!)

  if (dbError) return { success: false, error: 'Failed to update add-on.', code: 'DB_ERROR' }

  revalidatePath('/operations/admin/menu')
  return { success: true, data: undefined }
}

export async function removeAddon(addonId: string): Promise<ActionResult<void>> {
  const { user, error } = await guard()
  if (!user) return { success: false, error: error! }

  const service = createServiceClient()
  const { error: dbError } = await service
    .from('addons')
    .delete()
    .eq('id', addonId)
    .eq('restaurant_id', user.restaurantId!)

  if (dbError) return { success: false, error: 'Failed to remove add-on.', code: 'DB_ERROR' }

  revalidatePath('/operations/admin/menu')
  return { success: true, data: undefined }
}
