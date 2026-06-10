'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import type { ActionResult } from '@/types/app'

export async function signInEmployee(
  employeeId: string,
  restaurantSlug: string,
  pin: string
): Promise<ActionResult<void>> {
  const service = createServiceClient()

  const { data: restaurant } = await service
    .from('restaurants')
    .select('id, status')
    .eq('slug', restaurantSlug.toLowerCase().trim())
    .single()

  if (!restaurant) {
    return { success: false, error: 'Restaurant not found.', code: 'RESTAURANT_NOT_FOUND' }
  }
  if ((restaurant as { id: string; status: string }).status !== 'active') {
    return { success: false, error: 'This restaurant is currently unavailable.', code: 'RESTAURANT_INACTIVE' }
  }

  const email = `emp-${employeeId.trim()}-${(restaurant as { id: string; status: string }).id}@restrosewa.internal`

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: pin })

  if (error) {
    return { success: false, error: 'Invalid Employee ID or PIN.', code: 'INVALID_CREDENTIALS' }
  }

  // Portal separation: super admin accounts must not log in through the staff portal
  if (data.user?.app_metadata?.role === 'super_admin') {
    await supabase.auth.signOut()
    return { success: false, error: 'Invalid Employee ID or PIN.', code: 'INVALID_CREDENTIALS' }
  }

  redirect('/operations')
}

export async function signInSuperAdmin(
  email: string,
  password: string
): Promise<ActionResult<void>> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return { success: false, error: 'Invalid credentials.', code: 'INVALID_CREDENTIALS' }
  }

  // Portal separation: only super admin accounts may use this portal
  if (data.user?.app_metadata?.role !== 'super_admin') {
    await supabase.auth.signOut()
    return { success: false, error: 'Access denied.', code: 'UNAUTHORIZED' }
  }

  redirect('/super-admin')
}

export async function signOut() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const isSuperAdmin = user?.app_metadata?.role === 'super_admin'
  await supabase.auth.signOut()
  redirect(isSuperAdmin ? '/super-admin/login' : '/login')
}
