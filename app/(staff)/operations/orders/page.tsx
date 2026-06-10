import { notFound } from 'next/navigation'
import { requireAuth, hasPermission } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { OrderCard } from './order-card'
import type { Order, OrderItem } from './order-card'

export default async function OrdersPage() {
  const user = await requireAuth()
  if (!user.restaurantId) notFound()

  const canAccept = hasPermission(user, 'ACCEPT_ORDER')
  const canReject = hasPermission(user, 'REJECT_ORDER')

  const service = createServiceClient()

  // Parallel: active sessions + table names
  const [sessionsRes, tablesRes] = await Promise.all([
    service
      .from('sessions')
      .select('id, table_id')
      .eq('restaurant_id', user.restaurantId)
      .eq('status', 'active'),
    service
      .from('restaurant_tables')
      .select('id, display_name')
      .eq('restaurant_id', user.restaurantId),
  ])

  const tableNames = new Map<string, string>()
  for (const t of (tablesRes.data ?? []) as any[]) {
    tableNames.set(t.id, t.display_name as string)
  }

  const sessionTableMap = new Map<string, string>()
  for (const s of (sessionsRes.data ?? []) as any[]) {
    sessionTableMap.set(s.id as string, tableNames.get(s.table_id) ?? 'Unknown Table')
  }

  const sessionIds = [...sessionTableMap.keys()]

  if (sessionIds.length === 0) {
    return <EmptyState message="No active sessions. Activate a table session to start taking orders." />
  }

  // Active non-terminal orders for these sessions
  const ordersRes = await service
    .from('session_orders')
    .select('id, session_id, status, total_amount, created_at')
    .in('session_id', sessionIds)
    .in('status', ['pending', 'accepted', 'preparing', 'ready'])
    .order('created_at', { ascending: true })

  const rawOrders = (ordersRes.data ?? []) as any[]

  if (rawOrders.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader />
        <EmptyState message="No active orders right now. New orders will appear here." />
      </div>
    )
  }

  const orderIds = rawOrders.map((o) => o.id as string)

  const itemsRes = await service
    .from('session_order_items')
    .select(
      'id, order_id, menu_item_name, variant_name, unit_price, quantity, addons_snapshot, notes, serving_status',
    )
    .in('order_id', orderIds)

  const itemsByOrder = new Map<string, OrderItem[]>()
  for (const item of (itemsRes.data ?? []) as any[]) {
    const arr = itemsByOrder.get(item.order_id) ?? []
    arr.push({
      id: item.id,
      menu_item_name: item.menu_item_name,
      variant_name: item.variant_name,
      unit_price: item.unit_price,
      quantity: item.quantity,
      addons_snapshot: (item.addons_snapshot ?? []) as { name: string; additional_price: number }[],
      notes: item.notes,
      serving_status: item.serving_status,
    })
    itemsByOrder.set(item.order_id, arr)
  }

  const orders: Order[] = rawOrders.map((o) => ({
    id: o.id,
    status: o.status,
    total_amount: o.total_amount,
    created_at: o.created_at,
    table_name: sessionTableMap.get(o.session_id) ?? 'Unknown Table',
    items: itemsByOrder.get(o.id) ?? [],
  }))

  const pending = orders.filter((o) => o.status === 'pending')
  const inKitchen = orders.filter((o) => o.status === 'accepted' || o.status === 'preparing')
  const ready = orders.filter((o) => o.status === 'ready')

  return (
    <div className="space-y-8">
      <PageHeader />

      {pending.length > 0 && (
        <section>
          <SectionHeading
            dot="bg-amber-500"
            label="New Orders"
            count={pending.length}
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pending.map((o) => (
              <OrderCard key={o.id} order={o} canAccept={canAccept} canReject={canReject} />
            ))}
          </div>
        </section>
      )}

      {inKitchen.length > 0 && (
        <section>
          <SectionHeading
            dot="bg-purple-500"
            label="In Kitchen"
            count={inKitchen.length}
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {inKitchen.map((o) => (
              <OrderCard key={o.id} order={o} canAccept={canAccept} canReject={canReject} />
            ))}
          </div>
        </section>
      )}

      {ready.length > 0 && (
        <section>
          <SectionHeading
            dot="bg-green-500"
            label="Ready to Serve"
            count={ready.length}
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ready.map((o) => (
              <OrderCard key={o.id} order={o} canAccept={canAccept} canReject={canReject} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function PageHeader() {
  return (
    <div>
      <h1 className="font-heading text-2xl font-bold text-foreground">Orders</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Manage orders across all active sessions.
      </p>
    </div>
  )
}

function SectionHeading({
  dot,
  label,
  count,
}: {
  dot: string
  label: string
  count: number
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <h2 className="text-sm font-semibold text-foreground">
        {label}
        <span className="ml-2 text-muted-foreground">({count})</span>
      </h2>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-12 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}
