'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuth } from '@/lib/auth'
import type { ActionResult } from '@/types/app'

async function onlySuperAdmin() {
  const user = await requireAuth('/login')
  if (user.role !== 'super_admin') redirect('/unauthorized')
}

export async function createRestaurantUser(
  restaurantId: string,
  data: {
    employeeId: string
    name: string
    displayTitle: string
    role: 'restaurant_admin' | 'restaurant_employee'
    permissionTemplateId?: string
    pin: string
  }
): Promise<ActionResult<void>> {
  await onlySuperAdmin()

  const { employeeId, name, displayTitle, role, permissionTemplateId, pin } = data

  if (!employeeId.trim()) return { success: false, error: 'Employee ID is required.' }
  if (!name.trim()) return { success: false, error: 'Name is required.' }
  if (!displayTitle.trim()) return { success: false, error: 'Display title is required.' }
  if (pin.length < 4 || !/^\d+$/.test(pin)) return { success: false, error: 'PIN must be at least 4 digits.' }
  if (role === 'restaurant_employee' && !permissionTemplateId) {
    return { success: false, error: 'A permission template is required for employees.' }
  }

  const email = `emp-${employeeId.trim()}-${restaurantId}@restrosewa.internal`
  const service = createServiceClient()

  // Step 1: Create Supabase Auth user via Admin API
  const { data: authData, error: authError } = await service.auth.admin.createUser({
    email,
    password: pin,
    email_confirm: true,
  })

  if (authError || !authData.user) {
    if (authError?.message?.includes('already been registered')) {
      return { success: false, error: 'That Employee ID is already registered.', code: 'DUPLICATE_EMPLOYEE_ID' }
    }
    return { success: false, error: authError?.message ?? 'Failed to create user account.', code: 'AUTH_ERROR' }
  }

  // Step 2: Insert restaurant_users row
  const { error: dbError } = await service.from('restaurant_users').insert({
    restaurant_id: restaurantId,
    auth_user_id: authData.user.id,
    employee_id: employeeId.trim(),
    name: name.trim(),
    display_title: displayTitle.trim(),
    role,
    permission_template_id: permissionTemplateId || null,
  })

  if (dbError) {
    // Clean up orphaned auth user
    await service.auth.admin.deleteUser(authData.user.id)
    if (dbError.code === '23505') {
      return { success: false, error: 'Employee ID already exists in this restaurant.', code: 'DUPLICATE_EMPLOYEE_ID' }
    }
    return { success: false, error: 'Failed to create user.', code: 'DB_ERROR' }
  }

  revalidatePath(`/super-admin/restaurants/${restaurantId}`)
  return { success: true, data: undefined }
}

export async function setUserActive(
  restaurantUserId: string,
  restaurantId: string,
  isActive: boolean
): Promise<ActionResult<void>> {
  await onlySuperAdmin()

  const service = createServiceClient()
  const { error } = await service
    .from('restaurant_users')
    .update({ is_active: isActive })
    .eq('id', restaurantUserId)

  if (error) return { success: false, error: 'Failed to update user.', code: 'DB_ERROR' }

  revalidatePath(`/super-admin/restaurants/${restaurantId}`)
  return { success: true, data: undefined }
}

export async function resetUserPin(
  authUserId: string,
  newPin: string,
  restaurantId: string
): Promise<ActionResult<void>> {
  await onlySuperAdmin()

  if (newPin.length < 4 || !/^\d+$/.test(newPin)) {
    return { success: false, error: 'PIN must be at least 4 digits.' }
  }

  const service = createServiceClient()
  const { error } = await service.auth.admin.updateUserById(authUserId, { password: newPin })

  if (error) return { success: false, error: 'Failed to reset PIN.', code: 'AUTH_ERROR' }

  revalidatePath(`/super-admin/restaurants/${restaurantId}`)
  return { success: true, data: undefined }
}
