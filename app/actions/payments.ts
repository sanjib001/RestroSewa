'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuth, hasPermission } from '@/lib/auth'
import type { ActionResult } from '@/types/app'

export async function applyDiscount(
  sessionId: string,
  type: 'fixed' | 'percentage',
  value: number,
): Promise<ActionResult<void>> {
  const user = await requireAuth()
  if (!hasPermission(user, 'APPLY_DISCOUNT')) {
    return { success: false, error: 'You do not have permission to apply discounts.' }
  }
  if (!user.restaurantId) return { success: false, error: 'No restaurant associated with your account.' }

  const service = createServiceClient()

  const { data: session } = await service
    .from('sessions')
    .select('id, status')
    .eq('id', sessionId)
    .eq('restaurant_id', user.restaurantId)
    .single()

  if (!session) return { success: false, error: 'Session not found.' }
  if ((session as any).status !== 'active') return { success: false, error: 'Session is not active.' }

  // One discount per session in V1 — replace any existing
  await service.from('discounts').delete().eq('session_id', sessionId)

  const { error } = await service.from('discounts').insert({
    restaurant_id: user.restaurantId,
    session_id: sessionId,
    type,
    value,
    applied_by: user.restaurantUserId ?? null,
  })

  if (error) return { success: false, error: 'Failed to apply discount.' }

  revalidatePath(`/operations/sessions/${sessionId}/bill`)
  return { success: true, data: undefined }
}

export async function removeDiscount(sessionId: string): Promise<ActionResult<void>> {
  const user = await requireAuth()
  if (!hasPermission(user, 'APPLY_DISCOUNT')) {
    return { success: false, error: 'You do not have permission to remove discounts.' }
  }
  if (!user.restaurantId) return { success: false, error: 'No restaurant associated with your account.' }

  const service = createServiceClient()
  await service
    .from('discounts')
    .delete()
    .eq('session_id', sessionId)
    .eq('restaurant_id', user.restaurantId)

  revalidatePath(`/operations/sessions/${sessionId}/bill`)
  return { success: true, data: undefined }
}

export async function processPayment(
  sessionId: string,
  payments: Array<{ method: 'cash' | 'online' | 'outstanding'; amount: number; reference?: string }>,
): Promise<ActionResult<void>> {
  const user = await requireAuth()
  if (!hasPermission(user, 'PROCESS_PAYMENT')) {
    return { success: false, error: 'You do not have permission to process payments.' }
  }
  if (!user.restaurantId) return { success: false, error: 'No restaurant associated with your account.' }
  if (payments.length === 0) return { success: false, error: 'No payment provided.' }

  const service = createServiceClient()

  const { data: sessionData } = await service
    .from('sessions')
    .select('id, table_id, status')
    .eq('id', sessionId)
    .eq('restaurant_id', user.restaurantId)
    .single()

  if (!sessionData) return { success: false, error: 'Session not found.' }
  const session = sessionData as any
  if (session.status !== 'active') return { success: false, error: 'Session is not active.' }

  // Compute bill total
  const [ordersRes, discountsRes, settingsRes] = await Promise.all([
    service
      .from('session_orders')
      .select('total_amount, status')
      .eq('session_id', sessionId),
    service
      .from('discounts')
      .select('type, value')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(1),
    service
      .from('restaurant_settings')
      .select('default_service_charge_percent, cleaning_required')
      .eq('restaurant_id', user.restaurantId)
      .single(),
  ])

  const subtotal = ((ordersRes.data ?? []) as any[])
    .filter((o) => o.status !== 'cancelled' && o.status !== 'rejected')
    .reduce((s: number, o: any) => s + o.total_amount, 0)

  const serviceChargePct = (settingsRes.data as any)?.default_service_charge_percent ?? 0
  const serviceChargePaise = Math.round(subtotal * serviceChargePct / 100)
  const cleaningRequired = (settingsRes.data as any)?.cleaning_required ?? false

  const discount = ((discountsRes.data ?? []) as any[])[0] ?? null
  let discountPaise = 0
  if (discount) {
    discountPaise =
      discount.type === 'fixed'
        ? discount.value
        : Math.round(subtotal * discount.value / 100)
  }

  const totalPayable = Math.max(0, subtotal + serviceChargePaise - discountPaise)
  const isOutstanding = payments.length === 1 && payments[0].method === 'outstanding'

  if (!isOutstanding) {
    const totalPaid = payments.reduce((s, p) => s + p.amount, 0)
    if (totalPaid < totalPayable) {
      return {
        success: false,
        error: `Payment ₹${(totalPaid / 100).toFixed(2)} is less than total ₹${(totalPayable / 100).toFixed(2)}.`,
      }
    }
  }

  // Persist service charge as a financial record
  if (serviceChargePaise > 0) {
    await service.from('additional_charges').insert({
      restaurant_id: user.restaurantId,
      session_id: sessionId,
      description: `Service Charge (${serviceChargePct}%)`,
      amount: serviceChargePaise,
    })
  }

  // Create payment records
  await service.from('session_payments').insert(
    payments.map((p) => ({
      restaurant_id: user.restaurantId,
      session_id: sessionId,
      payment_method: p.method,
      amount_paid: p.method === 'outstanding' ? totalPayable : p.amount,
      payment_reference: p.reference ?? null,
      processed_by: user.restaurantUserId ?? null,
    })),
  )

  // Close session + release table
  await service
    .from('sessions')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', sessionId)

  await service
    .from('restaurant_tables')
    .update({ status: cleaningRequired ? 'cleaning' : 'available' })
    .eq('id', session.table_id)

  revalidatePath('/operations/sessions')
  revalidatePath('/operations/orders')
  return { success: true, data: undefined }
}
