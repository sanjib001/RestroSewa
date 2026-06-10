'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuth } from '@/lib/auth'
import type { ActionResult } from '@/types/app'

async function onlySuperAdmin() {
  const u = await requireAuth('/login')
  if (u.role !== 'super_admin') redirect('/unauthorized')
}

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export async function createRestaurant(formData: FormData): Promise<ActionResult<{ id: string }>> {
  await onlySuperAdmin()

  const name = (formData.get('name') as string)?.trim()
  const slug = (formData.get('slug') as string)?.trim().toLowerCase() || slugify(name)
  const phone = (formData.get('phone') as string)?.trim() || null
  const email = (formData.get('email') as string)?.trim() || null
  const address = (formData.get('address') as string)?.trim() || null

  if (!name) return { success: false, error: 'Restaurant name is required.' }
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return { success: false, error: 'Slug must be lowercase letters, numbers and hyphens only.' }

  const service = createServiceClient()
  const { data, error } = await service.from('restaurants').insert({ name, slug, phone, email, address }).select('id').single()

  if (error) {
    if (error.code === '23505') return { success: false, error: 'That slug is already taken. Choose another.', code: 'SLUG_TAKEN' }
    return { success: false, error: 'Failed to create restaurant.', code: 'DB_ERROR' }
  }

  const r = data as { id: string }

  // Create 1:1 restaurant_settings row with defaults
  await service.from('restaurant_settings').insert({ restaurant_id: r.id })

  revalidatePath('/super-admin/restaurants')
  return { success: true, data: { id: r.id } }
}

export async function updateRestaurant(
  id: string,
  formData: FormData
): Promise<ActionResult<void>> {
  await onlySuperAdmin()

  const name = (formData.get('name') as string)?.trim()
  const phone = (formData.get('phone') as string)?.trim() || null
  const email = (formData.get('email') as string)?.trim() || null
  const address = (formData.get('address') as string)?.trim() || null

  if (!name) return { success: false, error: 'Restaurant name is required.' }

  const service = createServiceClient()
  const { error } = await service.from('restaurants').update({ name, phone, email, address }).eq('id', id)

  if (error) return { success: false, error: 'Failed to update restaurant.', code: 'DB_ERROR' }

  revalidatePath(`/super-admin/restaurants/${id}`)
  revalidatePath('/super-admin/restaurants')
  return { success: true, data: undefined }
}

export async function setRestaurantStatus(
  id: string,
  status: 'active' | 'suspended' | 'archived'
): Promise<ActionResult<void>> {
  await onlySuperAdmin()

  const service = createServiceClient()
  const { error } = await service.from('restaurants').update({ status }).eq('id', id)

  if (error) return { success: false, error: 'Failed to update restaurant status.', code: 'DB_ERROR' }

  revalidatePath(`/super-admin/restaurants/${id}`)
  revalidatePath('/super-admin/restaurants')
  return { success: true, data: undefined }
}
