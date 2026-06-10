import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { CustomerApp } from './customer-app'

export const dynamic = 'force-dynamic'

export type Variant = { id: string; menu_item_id: string; name: string; additional_price: number; sort_order: number }
export type Addon = { id: string; menu_item_id: string; name: string; additional_price: number }
export type MenuItem = {
  id: string; name: string; description: string | null; base_price: number
  status: string; is_veg: boolean; is_special: boolean; sort_order: number; category_id: string | null
  variants: Variant[]; addons: Addon[]
}
export type Category = { id: string; name: string; sort_order: number }
export type OrderItem = {
  id: string; order_id: string; menu_item_name: string; variant_name: string | null
  unit_price: number; quantity: number; addons_snapshot: { id: string; name: string; additional_price: number }[]
  notes: string | null; serving_status: string
}
export type Order = { id: string; status: string; total_amount: number; created_at: string; items: OrderItem[] }
export type Session = { id: string; status: string; ordering_locked: boolean; bill_requested: boolean }

export default async function CustomerPage({ params }: { params: Promise<{ qr_token: string }> }) {
  const { qr_token } = await params
  const service = createServiceClient()

  const { data: tableData } = await service
    .from('restaurant_tables')
    .select('id, restaurant_id, display_name, status')
    .eq('qr_token', qr_token)
    .single()

  if (!tableData) notFound()

  const table = tableData as { id: string; restaurant_id: string; display_name: string; status: string }

  const { data: restaurantData } = await service
    .from('restaurants')
    .select('id, name, status')
    .eq('id', table.restaurant_id)
    .single()

  if (!restaurantData) notFound()
  const restaurant = restaurantData as { id: string; name: string; status: string }

  if (restaurant.status !== 'active') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
        <p className="text-lg font-semibold text-foreground">Restaurant Unavailable</p>
        <p className="mt-2 text-sm text-muted-foreground">This restaurant is not currently accepting orders.</p>
      </div>
    )
  }

  const { data: sessionData } = await service
    .from('sessions')
    .select('id, status, ordering_locked, bill_requested')
    .eq('table_id', table.id)
    .eq('status', 'active')
    .maybeSingle()

  const session = sessionData as Session | null

  // Transition table to waiting_activation + notify staff on first customer arrival
  if (!session && table.status === 'available') {
    await service
      .from('restaurant_tables')
      .update({ status: 'waiting_activation' })
      .eq('id', table.id)
      .eq('status', 'available') // conditional — only fires once

    await service.from('notifications').insert({
      restaurant_id: table.restaurant_id,
      type: 'new_arrival',
      table_id: table.id,
      message: `Customer arrived at ${table.display_name}`,
    })
  }

  // Load menu — active categories + non-hidden items + variants + addons
  const [catRes, itemRes, varRes, addonRes] = await Promise.all([
    service
      .from('menu_categories')
      .select('id, name, sort_order')
      .eq('restaurant_id', table.restaurant_id)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    service
      .from('menu_items')
      .select('id, name, description, base_price, status, is_veg, is_special, sort_order, category_id')
      .eq('restaurant_id', table.restaurant_id)
      .neq('status', 'hidden')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    service
      .from('variants')
      .select('id, menu_item_id, name, additional_price, sort_order')
      .eq('restaurant_id', table.restaurant_id)
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
    service
      .from('addons')
      .select('id, menu_item_id, name, additional_price')
      .eq('restaurant_id', table.restaurant_id)
      .eq('is_active', true),
  ])

  const categories = (catRes.data ?? []) as Category[]
  const rawItems = (itemRes.data ?? []) as Omit<MenuItem, 'variants' | 'addons'>[]
  const rawVariants = (varRes.data ?? []) as Variant[]
  const rawAddons = (addonRes.data ?? []) as Addon[]

  const variantsByItem = new Map<string, Variant[]>()
  for (const v of rawVariants) {
    const arr = variantsByItem.get(v.menu_item_id) ?? []
    arr.push(v)
    variantsByItem.set(v.menu_item_id, arr)
  }
  const addonsByItem = new Map<string, Addon[]>()
  for (const a of rawAddons) {
    const arr = addonsByItem.get(a.menu_item_id) ?? []
    arr.push(a)
    addonsByItem.set(a.menu_item_id, arr)
  }

  const items: MenuItem[] = rawItems.map((item) => ({
    ...item,
    variants: variantsByItem.get(item.id) ?? [],
    addons: addonsByItem.get(item.id) ?? [],
  }))

  // Load existing orders for current session
  let orders: Order[] = []
  if (session) {
    const { data: ordersData } = await service
      .from('session_orders')
      .select('id, status, total_amount, created_at')
      .eq('session_id', session.id)
      .order('created_at', { ascending: false })

    if (ordersData && (ordersData as any[]).length > 0) {
      const orderIds = (ordersData as any[]).map((o) => o.id)
      const { data: orderItemsData } = await service
        .from('session_order_items')
        .select('id, order_id, menu_item_name, variant_name, unit_price, quantity, addons_snapshot, notes, serving_status')
        .in('order_id', orderIds)

      const itemsByOrder = new Map<string, OrderItem[]>()
      for (const oi of (orderItemsData ?? []) as any[]) {
        const arr = itemsByOrder.get(oi.order_id) ?? []
        arr.push(oi)
        itemsByOrder.set(oi.order_id, arr)
      }

      orders = (ordersData as any[]).map((o) => ({
        ...o,
        items: itemsByOrder.get(o.id) ?? [],
      }))
    }
  }

  return (
    <CustomerApp
      qrToken={qr_token}
      restaurant={{ id: restaurant.id, name: restaurant.name }}
      table={{ id: table.id, display_name: table.display_name }}
      session={session}
      categories={categories}
      items={items}
      initialOrders={orders}
    />
  )
}
