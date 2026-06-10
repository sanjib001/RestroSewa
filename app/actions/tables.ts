'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuth, hasPermission } from '@/lib/auth'
import type { ActionResult } from '@/types/app'

async function guard() {
  const user = await requireAuth()
  if (!hasPermission(user, 'MANAGE_TABLES')) return { user: null as null, error: 'Permission denied.' }
  if (!user.restaurantId) return { user: null as null, error: 'No restaurant associated with your account.' }
  return { user, error: null }
}

export async function createTable(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const { user, error } = await guard()
  if (!user) return { success: false, error: error! }

  const displayName = (formData.get('display_name') as string)?.trim()
  const tableGroupId = (formData.get('table_group_id') as string) || null
  const position = parseInt(formData.get('position') as string) || 0

  if (!displayName) return { success: false, error: 'Table name is required.' }

  const service = createServiceClient()
  const { data, error: dbError } = await service
    .from('restaurant_tables')
    .insert({
      restaurant_id: user.restaurantId,
      table_group_id: tableGroupId,
      display_name: displayName,
      position,
    })
    .select('id')
    .single()

  if (dbError) return { success: false, error: 'Failed to create table.', code: 'DB_ERROR' }

  revalidatePath('/operations/admin/tables')
  return { success: true, data: { id: (data as { id: string }).id } }
}

export async function updateTable(tableId: string, formData: FormData): Promise<ActionResult<void>> {
  const { user, error } = await guard()
  if (!user) return { success: false, error: error! }

  const displayName = (formData.get('display_name') as string)?.trim()
  const tableGroupId = (formData.get('table_group_id') as string) || null
  const position = parseInt(formData.get('position') as string) || 0

  if (!displayName) return { success: false, error: 'Table name is required.' }

  const service = createServiceClient()
  const { error: dbError } = await service
    .from('restaurant_tables')
    .update({ display_name: displayName, table_group_id: tableGroupId, position })
    .eq('id', tableId)
    .eq('restaurant_id', user.restaurantId!)

  if (dbError) return { success: false, error: 'Failed to update table.', code: 'DB_ERROR' }

  revalidatePath('/operations/admin/tables')
  return { success: true, data: undefined }
}

export async function deleteTable(tableId: string): Promise<ActionResult<void>> {
  const { user, error } = await guard()
  if (!user) return { success: false, error: error! }

  const service = createServiceClient()

  // Block deletion if an active session exists on this table
  const { count } = await service
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('table_id', tableId)
    .eq('status', 'active')

  if ((count ?? 0) > 0) {
    return { success: false, error: 'Cannot delete — this table has an active session.', code: 'TABLE_HAS_SESSION' }
  }

  const { error: dbError } = await service
    .from('restaurant_tables')
    .delete()
    .eq('id', tableId)
    .eq('restaurant_id', user.restaurantId!)

  if (dbError) return { success: false, error: 'Failed to delete table.', code: 'DB_ERROR' }

  revalidatePath('/operations/admin/tables')
  return { success: true, data: undefined }
}
