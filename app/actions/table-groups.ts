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

export async function createTableGroup(name: string): Promise<ActionResult<{ id: string }>> {
  const { user, error } = await guard()
  if (!user) return { success: false, error: error! }
  if (!name.trim()) return { success: false, error: 'Group name is required.' }

  const service = createServiceClient()
  const { data, error: dbError } = await service
    .from('table_groups')
    .insert({ restaurant_id: user.restaurantId, name: name.trim() })
    .select('id')
    .single()

  if (dbError) return { success: false, error: 'Failed to create group.', code: 'DB_ERROR' }

  revalidatePath('/operations/admin/tables')
  return { success: true, data: { id: (data as { id: string }).id } }
}

export async function deleteTableGroup(groupId: string): Promise<ActionResult<void>> {
  const { user, error } = await guard()
  if (!user) return { success: false, error: error! }

  const service = createServiceClient()

  const { count } = await service
    .from('restaurant_tables')
    .select('id', { count: 'exact', head: true })
    .eq('table_group_id', groupId)

  if ((count ?? 0) > 0) {
    return { success: false, error: 'Move or reassign all tables in this group first.', code: 'GROUP_HAS_TABLES' }
  }

  const { error: dbError } = await service
    .from('table_groups')
    .delete()
    .eq('id', groupId)
    .eq('restaurant_id', user.restaurantId!)

  if (dbError) return { success: false, error: 'Failed to delete group.', code: 'DB_ERROR' }

  revalidatePath('/operations/admin/tables')
  return { success: true, data: undefined }
}
