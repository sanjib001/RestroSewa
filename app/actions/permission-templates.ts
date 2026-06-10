'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuth } from '@/lib/auth'
import type { ActionResult, Permission } from '@/types/app'

async function onlySuperAdmin() {
  const user = await requireAuth('/login')
  if (user.role !== 'super_admin') redirect('/unauthorized')
}

export async function createPermissionTemplate(
  name: string,
  permissions: Permission[]
): Promise<ActionResult<{ id: string }>> {
  await onlySuperAdmin()

  if (!name.trim()) return { success: false, error: 'Template name is required.' }
  if (permissions.length === 0) return { success: false, error: 'Select at least one permission.' }

  const service = createServiceClient()
  const { data, error } = await service
    .from('permission_templates')
    .insert({ name: name.trim(), permissions })
    .select('id')
    .single()

  if (error) return { success: false, error: 'Failed to create template.', code: 'DB_ERROR' }

  revalidatePath('/super-admin/templates')
  return { success: true, data: { id: (data as { id: string }).id } }
}

export async function updatePermissionTemplate(
  id: string,
  name: string,
  permissions: Permission[]
): Promise<ActionResult<void>> {
  await onlySuperAdmin()

  if (!name.trim()) return { success: false, error: 'Template name is required.' }
  if (permissions.length === 0) return { success: false, error: 'Select at least one permission.' }

  const service = createServiceClient()
  const { error } = await service
    .from('permission_templates')
    .update({ name: name.trim(), permissions })
    .eq('id', id)

  if (error) return { success: false, error: 'Failed to update template.', code: 'DB_ERROR' }

  revalidatePath('/super-admin/templates')
  return { success: true, data: undefined }
}

export async function deletePermissionTemplate(id: string): Promise<ActionResult<void>> {
  await onlySuperAdmin()

  const service = createServiceClient()
  // Check if any users are assigned to this template
  const { count } = await service
    .from('restaurant_users')
    .select('id', { count: 'exact', head: true })
    .eq('permission_template_id', id)

  if ((count ?? 0) > 0) {
    return { success: false, error: 'Cannot delete — this template is assigned to one or more users.', code: 'TEMPLATE_IN_USE' }
  }

  const { error } = await service.from('permission_templates').delete().eq('id', id)

  if (error) return { success: false, error: 'Failed to delete template.', code: 'DB_ERROR' }

  revalidatePath('/super-admin/templates')
  return { success: true, data: undefined }
}
