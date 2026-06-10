'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuth } from '@/lib/auth'
import type { ActionResult } from '@/types/app'

export async function updateRestaurantSettings(formData: FormData): Promise<ActionResult<void>> {
  const user = await requireAuth()
  if (user.role !== 'restaurant_admin') return { success: false, error: 'Only restaurant admins can change settings.', code: 'UNAUTHORIZED' }
  if (!user.restaurantId) return { success: false, error: 'No restaurant associated with your account.', code: 'NO_RESTAURANT' }

  const cleaningRequired = formData.get('cleaning_required') === 'true'
  const soundNotificationsEnabled = formData.get('sound_notifications_enabled') === 'true'
  const serviceChargeRaw = parseFloat(formData.get('default_service_charge_percent') as string) || 0
  const defaultServiceChargePercent = Math.min(100, Math.max(0, serviceChargeRaw))

  const service = createServiceClient()
  const { error } = await service
    .from('restaurant_settings')
    .update({ cleaning_required: cleaningRequired, sound_notifications_enabled: soundNotificationsEnabled, default_service_charge_percent: defaultServiceChargePercent })
    .eq('restaurant_id', user.restaurantId)

  if (error) return { success: false, error: 'Failed to save settings.', code: 'DB_ERROR' }

  revalidatePath('/operations/admin/settings')
  return { success: true, data: undefined }
}

export async function updateRestaurantInfo(formData: FormData): Promise<ActionResult<void>> {
  const user = await requireAuth()
  if (user.role !== 'restaurant_admin') return { success: false, error: 'Only restaurant admins can update restaurant info.', code: 'UNAUTHORIZED' }
  if (!user.restaurantId) return { success: false, error: 'No restaurant associated with your account.', code: 'NO_RESTAURANT' }

  const name = (formData.get('name') as string)?.trim()
  const phone = (formData.get('phone') as string)?.trim() || null
  const email = (formData.get('email') as string)?.trim() || null
  const address = (formData.get('address') as string)?.trim() || null
  const logoUrl = (formData.get('logo_url') as string)?.trim() || null

  if (!name) return { success: false, error: 'Restaurant name is required.' }

  const service = createServiceClient()
  const { error } = await service
    .from('restaurants')
    .update({ name, phone, email, address, logo_url: logoUrl })
    .eq('id', user.restaurantId)

  if (error) return { success: false, error: 'Failed to update restaurant info.', code: 'DB_ERROR' }

  revalidatePath('/operations/admin/settings')
  return { success: true, data: undefined }
}
