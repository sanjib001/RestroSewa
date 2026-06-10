'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuth, hasPermission } from '@/lib/auth'
import type { ActionResult } from '@/types/app'

export async function activateSession(tableId: string): Promise<ActionResult<{ sessionId: string }>> {
  const user = await requireAuth()
  if (!hasPermission(user, 'ACTIVATE_SESSION')) {
    return { success: false, error: 'You do not have permission to activate sessions.' }
  }
  if (!user.restaurantId) return { success: false, error: 'No restaurant associated with your account.' }

  const service = createServiceClient()

  const { data: tableData } = await service
    .from('restaurant_tables')
    .select('id, restaurant_id, display_name, status')
    .eq('id', tableId)
    .eq('restaurant_id', user.restaurantId)
    .single()

  if (!tableData) return { success: false, error: 'Table not found.' }
  const table = tableData as { id: string; display_name: string; status: string }

  if (table.status !== 'waiting_activation' && table.status !== 'available') {
    return { success: false, error: `Table is currently "${table.status}" and cannot be activated.` }
  }

  const { data: sessionData, error: sessionError } = await service
    .from('sessions')
    .insert({
      restaurant_id: user.restaurantId,
      table_id: tableId,
      activated_by: user.restaurantUserId ?? null,
      status: 'active',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (sessionError) {
    if (sessionError.code === '23505') {
      return { success: false, error: 'A session is already active for this table.' }
    }
    return { success: false, error: 'Failed to create session. Please try again.' }
  }

  const sessionId = (sessionData as { id: string }).id

  await service
    .from('restaurant_tables')
    .update({ status: 'occupied' })
    .eq('id', tableId)

  revalidatePath('/operations/sessions')
  return { success: true, data: { sessionId } }
}

export async function forceCloseSession(sessionId: string): Promise<ActionResult<void>> {
  const user = await requireAuth()
  if (!hasPermission(user, 'CLOSE_SESSION')) {
    return { success: false, error: 'You do not have permission to close sessions.' }
  }
  if (!user.restaurantId) return { success: false, error: 'No restaurant associated with your account.' }

  const service = createServiceClient()

  const { data: sessionData } = await service
    .from('sessions')
    .select('id, table_id, restaurant_id, status')
    .eq('id', sessionId)
    .eq('restaurant_id', user.restaurantId)
    .single()

  if (!sessionData) return { success: false, error: 'Session not found.' }
  const session = sessionData as { id: string; table_id: string; status: string }
  if (session.status !== 'active') return { success: false, error: 'Session is not active.' }

  const { data: settingsData } = await service
    .from('restaurant_settings')
    .select('cleaning_required')
    .eq('restaurant_id', user.restaurantId)
    .single()

  const cleaningRequired = (settingsData as any)?.cleaning_required ?? false
  const newTableStatus = cleaningRequired ? 'cleaning' : 'available'

  await service
    .from('sessions')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', sessionId)

  await service
    .from('restaurant_tables')
    .update({ status: newTableStatus })
    .eq('id', session.table_id)

  revalidatePath('/operations/sessions')
  return { success: true, data: undefined }
}

export async function markCleaningComplete(tableId: string): Promise<ActionResult<void>> {
  const user = await requireAuth()
  if (!user.restaurantId) return { success: false, error: 'No restaurant associated with your account.' }

  const service = createServiceClient()

  const { data: tableData } = await service
    .from('restaurant_tables')
    .select('id, status')
    .eq('id', tableId)
    .eq('restaurant_id', user.restaurantId)
    .single()

  if (!tableData) return { success: false, error: 'Table not found.' }
  if ((tableData as any).status !== 'cleaning') {
    return { success: false, error: 'Table is not in cleaning status.' }
  }

  await service
    .from('restaurant_tables')
    .update({ status: 'available' })
    .eq('id', tableId)

  revalidatePath('/operations/sessions')
  return { success: true, data: undefined }
}

export async function unlockOrdering(sessionId: string): Promise<ActionResult<void>> {
  const user = await requireAuth()
  if (!hasPermission(user, 'CLOSE_SESSION')) {
    return { success: false, error: 'You do not have permission to unlock ordering.' }
  }
  if (!user.restaurantId) return { success: false, error: 'No restaurant associated with your account.' }

  const service = createServiceClient()

  const { data } = await service
    .from('sessions')
    .select('id, status')
    .eq('id', sessionId)
    .eq('restaurant_id', user.restaurantId)
    .single()

  if (!data) return { success: false, error: 'Session not found.' }
  if ((data as any).status !== 'active') return { success: false, error: 'Session is not active.' }

  await service
    .from('sessions')
    .update({ ordering_locked: false, bill_requested: false })
    .eq('id', sessionId)

  revalidatePath('/operations/sessions')
  revalidatePath(`/operations/sessions/${sessionId}/bill`)
  return { success: true, data: undefined }
}
