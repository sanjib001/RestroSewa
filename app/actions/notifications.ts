'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuth } from '@/lib/auth'
import type { ActionResult } from '@/types/app'

export async function markNotificationRead(id: string): Promise<ActionResult<void>> {
  const user = await requireAuth()
  if (!user.restaurantId) return { success: false, error: 'No restaurant.' }

  const service = createServiceClient()
  await service
    .from('notifications')
    .update({ status: 'read' })
    .eq('id', id)
    .eq('restaurant_id', user.restaurantId)
    .eq('status', 'unread')

  revalidatePath('/operations/notifications')
  return { success: true, data: undefined }
}

export async function dismissNotification(id: string): Promise<ActionResult<void>> {
  const user = await requireAuth()
  if (!user.restaurantId) return { success: false, error: 'No restaurant.' }

  const service = createServiceClient()
  await service
    .from('notifications')
    .update({ status: 'dismissed' })
    .eq('id', id)
    .eq('restaurant_id', user.restaurantId)

  revalidatePath('/operations/notifications')
  return { success: true, data: undefined }
}

export async function markAllNotificationsRead(): Promise<ActionResult<void>> {
  const user = await requireAuth()
  if (!user.restaurantId) return { success: false, error: 'No restaurant.' }

  const service = createServiceClient()
  await service
    .from('notifications')
    .update({ status: 'read' })
    .eq('restaurant_id', user.restaurantId)
    .eq('status', 'unread')

  revalidatePath('/operations/notifications')
  revalidatePath('/operations')
  return { success: true, data: undefined }
}
