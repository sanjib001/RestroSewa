'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuth, hasPermission } from '@/lib/auth'
import type { ActionResult } from '@/types/app'

async function resolveOrder(
  orderId: string,
  restaurantId: string,
  expectedStatuses: string[],
): Promise<{ id: string; status: string } | { error: string }> {
  const service = createServiceClient()
  const { data } = await service
    .from('session_orders')
    .select('id, status')
    .eq('id', orderId)
    .eq('restaurant_id', restaurantId)
    .single()

  if (!data) return { error: 'Order not found.' }
  const order = data as any
  if (!expectedStatuses.includes(order.status)) {
    return { error: `Order is "${order.status}" and cannot be updated from this state.` }
  }
  return { id: order.id, status: order.status }
}

export async function acceptOrder(orderId: string): Promise<ActionResult<void>> {
  const user = await requireAuth()
  if (!hasPermission(user, 'ACCEPT_ORDER')) {
    return { success: false, error: 'You do not have permission to accept orders.' }
  }
  if (!user.restaurantId) return { success: false, error: 'No restaurant associated with your account.' }

  const order = await resolveOrder(orderId, user.restaurantId, ['pending'])
  if ('error' in order) return { success: false, error: order.error }

  const service = createServiceClient()
  await service.from('session_orders').update({ status: 'accepted' }).eq('id', orderId)
  revalidatePath('/operations/orders')
  return { success: true, data: undefined }
}

export async function rejectOrder(orderId: string): Promise<ActionResult<void>> {
  const user = await requireAuth()
  if (!hasPermission(user, 'REJECT_ORDER')) {
    return { success: false, error: 'You do not have permission to reject orders.' }
  }
  if (!user.restaurantId) return { success: false, error: 'No restaurant associated with your account.' }

  const order = await resolveOrder(orderId, user.restaurantId, ['pending'])
  if ('error' in order) return { success: false, error: order.error }

  const service = createServiceClient()
  await service.from('session_orders').update({ status: 'rejected' }).eq('id', orderId)
  revalidatePath('/operations/orders')
  return { success: true, data: undefined }
}

export async function markOrderPreparing(orderId: string): Promise<ActionResult<void>> {
  const user = await requireAuth()
  if (!hasPermission(user, 'ACCEPT_ORDER')) {
    return { success: false, error: 'You do not have permission to update orders.' }
  }
  if (!user.restaurantId) return { success: false, error: 'No restaurant associated with your account.' }

  const order = await resolveOrder(orderId, user.restaurantId, ['accepted'])
  if ('error' in order) return { success: false, error: order.error }

  const service = createServiceClient()
  await service.from('session_orders').update({ status: 'preparing' }).eq('id', orderId)
  revalidatePath('/operations/orders')
  return { success: true, data: undefined }
}

export async function markOrderReady(orderId: string): Promise<ActionResult<void>> {
  const user = await requireAuth()
  if (!hasPermission(user, 'ACCEPT_ORDER')) {
    return { success: false, error: 'You do not have permission to update orders.' }
  }
  if (!user.restaurantId) return { success: false, error: 'No restaurant associated with your account.' }

  const order = await resolveOrder(orderId, user.restaurantId, ['preparing'])
  if ('error' in order) return { success: false, error: order.error }

  const service = createServiceClient()
  await service.from('session_orders').update({ status: 'ready' }).eq('id', orderId)
  revalidatePath('/operations/orders')
  return { success: true, data: undefined }
}

export async function markOrderServed(orderId: string): Promise<ActionResult<void>> {
  const user = await requireAuth()
  if (!hasPermission(user, 'ACCEPT_ORDER')) {
    return { success: false, error: 'You do not have permission to update orders.' }
  }
  if (!user.restaurantId) return { success: false, error: 'No restaurant associated with your account.' }

  const order = await resolveOrder(orderId, user.restaurantId, ['ready'])
  if ('error' in order) return { success: false, error: order.error }

  const service = createServiceClient()
  await Promise.all([
    service
      .from('session_order_items')
      .update({ serving_status: 'served' })
      .eq('order_id', orderId),
    service.from('session_orders').update({ status: 'served' }).eq('id', orderId),
  ])
  revalidatePath('/operations/orders')
  return { success: true, data: undefined }
}

export async function markItemServed(itemId: string): Promise<ActionResult<void>> {
  const user = await requireAuth()
  if (!hasPermission(user, 'ACCEPT_ORDER')) {
    return { success: false, error: 'You do not have permission to update order items.' }
  }
  if (!user.restaurantId) return { success: false, error: 'No restaurant associated with your account.' }

  const service = createServiceClient()

  const { data } = await service
    .from('session_order_items')
    .select('id, restaurant_id')
    .eq('id', itemId)
    .eq('restaurant_id', user.restaurantId)
    .single()

  if (!data) return { success: false, error: 'Order item not found.' }

  await service
    .from('session_order_items')
    .update({ serving_status: 'served' })
    .eq('id', itemId)

  revalidatePath('/operations/orders')
  return { success: true, data: undefined }
}
