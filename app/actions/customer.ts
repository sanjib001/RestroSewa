'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import type { ActionResult } from '@/types/app'

// Resolves qr_token + sessionId into validated table + session objects.
// All customer actions require both — qr_token is the customer's "key".
type ValidTable = { id: string; restaurant_id: string; display_name: string; status: string }
type ValidSession = { id: string; table_id: string; restaurant_id: string; status: string; ordering_locked: boolean; bill_requested: boolean }
type ValidationOk = { table: ValidTable; session: ValidSession }
type ValidationErr = { error: string }

async function validateSession(qrToken: string, sessionId: string): Promise<ValidationOk | ValidationErr> {
  const service = createServiceClient()

  const [tableRes, sessionRes] = await Promise.all([
    service
      .from('restaurant_tables')
      .select('id, restaurant_id, display_name, status')
      .eq('qr_token', qrToken)
      .single(),
    service
      .from('sessions')
      .select('id, table_id, restaurant_id, status, ordering_locked, bill_requested')
      .eq('id', sessionId)
      .single(),
  ])

  if (!tableRes.data) return { error: 'Invalid QR code.' }
  if (!sessionRes.data) return { error: 'Session not found.' }

  const table = tableRes.data as ValidTable
  const session = sessionRes.data as ValidSession

  if (session.table_id !== table.id) return { error: 'Session does not match this table.' }
  if (session.status !== 'active') return { error: 'Session is no longer active.' }

  return { table, session }
}

export type ClientCartItem = {
  menuItemId: string
  variantId: string | null
  addonIds: string[]
  quantity: number
  notes: string
}

export async function submitOrder(
  qrToken: string,
  sessionId: string,
  items: ClientCartItem[],
): Promise<ActionResult<void>> {
  if (items.length === 0) return { success: false, error: 'Cart is empty.' }

  const validation = await validateSession(qrToken, sessionId)
  if (!('table' in validation)) return { success: false, error: (validation as ValidationErr).error }
  const { table, session } = validation

  if (session.ordering_locked) return { success: false, error: 'Ordering is currently locked.' }

  const service = createServiceClient()

  // Re-fetch current prices from DB — price snapshot at submission time
  const menuItemIds = [...new Set(items.map((i) => i.menuItemId))]
  const variantIds = items.map((i) => i.variantId).filter(Boolean) as string[]
  const addonIds = [...new Set(items.flatMap((i) => i.addonIds))]

  const [menuItemsRes, variantsRes, addonsRes] = await Promise.all([
    service
      .from('menu_items')
      .select('id, name, base_price, status')
      .in('id', menuItemIds)
      .eq('restaurant_id', table.restaurant_id),
    variantIds.length > 0
      ? service.from('variants').select('id, name, additional_price').in('id', variantIds)
      : { data: [] as any[] },
    addonIds.length > 0
      ? service.from('addons').select('id, name, additional_price').in('id', addonIds)
      : { data: [] as any[] },
  ])

  const menuMap = new Map<string, any>((menuItemsRes.data ?? []).map((m: any) => [m.id, m]))
  const variantMap = new Map<string, any>((variantsRes.data ?? []).map((v: any) => [v.id, v]))
  const addonMap = new Map<string, any>((addonsRes.data ?? []).map((a: any) => [a.id, a]))

  // Validate availability
  for (const item of items) {
    const m = menuMap.get(item.menuItemId)
    if (!m) return { success: false, error: 'A menu item in your cart was not found.' }
    if (m.status === 'hidden') return { success: false, error: `"${m.name}" is no longer available.` }
    if (m.status === 'out_of_stock') return { success: false, error: `"${m.name}" is currently out of stock.` }
    if (item.variantId && !variantMap.has(item.variantId))
      return { success: false, error: 'A selected variant is no longer available.' }
  }

  // Build order items with DB-sourced price snapshots
  type BuiltItem = {
    menu_item_id: string; menu_item_name: string
    variant_id: string | null; variant_name: string | null
    unit_price: number; quantity: number; addons_snapshot: object[]
    notes: string | null; itemTotal: number
  }
  const builtItems: BuiltItem[] = items.map((item) => {
    const m = menuMap.get(item.menuItemId)
    const v = item.variantId ? variantMap.get(item.variantId) : null
    const selectedAddons = item.addonIds.map((id) => addonMap.get(id)).filter(Boolean)

    const unitPrice: number = m.base_price + (v?.additional_price ?? 0)
    const addonTotal: number = selectedAddons.reduce((s: number, a: any) => s + a.additional_price, 0)

    return {
      menu_item_id: item.menuItemId,
      menu_item_name: m.name,
      variant_id: item.variantId,
      variant_name: v?.name ?? null,
      unit_price: unitPrice,
      quantity: item.quantity,
      addons_snapshot: selectedAddons.map((a: any) => ({
        id: a.id,
        name: a.name,
        additional_price: a.additional_price,
      })),
      notes: item.notes || null,
      itemTotal: (unitPrice + addonTotal) * item.quantity,
    }
  })

  const totalAmount = builtItems.reduce((s, i) => s + i.itemTotal, 0)

  // Create order header
  const { data: order, error: orderError } = await service
    .from('session_orders')
    .insert({ restaurant_id: table.restaurant_id, session_id: sessionId, total_amount: totalAmount })
    .select('id')
    .single()

  if (orderError) return { success: false, error: 'Failed to place order. Please try again.' }

  const orderId = (order as { id: string }).id

  // Create order items
  const { error: itemsError } = await service.from('session_order_items').insert(
    builtItems.map(({ itemTotal: _drop, ...item }) => ({
      ...item,
      order_id: orderId,
      restaurant_id: table.restaurant_id,
    })),
  )

  if (itemsError) {
    await service.from('session_orders').delete().eq('id', orderId)
    return { success: false, error: 'Failed to save order items. Please try again.' }
  }

  // Create notification for staff
  await service.from('notifications').insert({
    restaurant_id: table.restaurant_id,
    type: 'new_order',
    session_id: sessionId,
    order_id: orderId,
    table_id: table.id,
    message: `New order from ${table.display_name}`,
  })

  revalidatePath(`/t/${qrToken}`)
  return { success: true, data: undefined }
}

export async function submitHelpRequest(
  qrToken: string,
  sessionId: string,
): Promise<ActionResult<void>> {
  const validation = await validateSession(qrToken, sessionId)
  if (!('table' in validation)) return { success: false, error: (validation as ValidationErr).error }
  const { table, session } = validation

  const service = createServiceClient()

  // Check for existing open help request (one at a time per product spec)
  const { count } = await service
    .from('help_requests')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .in('status', ['open', 'claimed'])

  if ((count ?? 0) > 0) {
    return { success: false, error: 'A help request is already active. Please wait for staff.' }
  }

  const { error } = await service
    .from('help_requests')
    .insert({ restaurant_id: table.restaurant_id, session_id: sessionId })

  if (error) return { success: false, error: 'Failed to send help request. Please try again.' }

  await service.from('notifications').insert({
    restaurant_id: table.restaurant_id,
    type: 'help_request',
    session_id: sessionId,
    table_id: table.id,
    message: `Help requested at ${table.display_name}`,
  })

  revalidatePath(`/t/${qrToken}`)
  return { success: true, data: undefined }
}

export async function submitBillRequest(
  qrToken: string,
  sessionId: string,
): Promise<ActionResult<void>> {
  const validation = await validateSession(qrToken, sessionId)
  if (!('table' in validation)) return { success: false, error: (validation as ValidationErr).error }
  const { table, session } = validation

  if (session.bill_requested) {
    return { success: false, error: 'Bill has already been requested.' }
  }

  const service = createServiceClient()

  // Create bill request (unique index will block duplicates)
  const { error: brError } = await service
    .from('bill_requests')
    .insert({ restaurant_id: table.restaurant_id, session_id: sessionId })

  if (brError) return { success: false, error: 'Failed to request bill. Please try again.' }

  // Lock ordering + mark bill requested
  await service
    .from('sessions')
    .update({ ordering_locked: true, bill_requested: true })
    .eq('id', sessionId)

  await service.from('notifications').insert({
    restaurant_id: table.restaurant_id,
    type: 'bill_request',
    session_id: sessionId,
    table_id: table.id,
    message: `Bill requested at ${table.display_name}`,
  })

  revalidatePath(`/t/${qrToken}`)
  return { success: true, data: undefined }
}
