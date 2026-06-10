import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { requireAuth, hasPermission } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { DiscountForm } from './discount-form'
import { PaymentForm } from './payment-form'
import { UnlockOrderingButton } from './unlock-ordering-button'

function fmt(paise: number) {
  return `₹${(paise / 100).toFixed(2)}`
}

export default async function BillPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const { sessionId } = await params
  const user = await requireAuth()
  if (!user.restaurantId) notFound()

  const canProcessPayment = hasPermission(user, 'PROCESS_PAYMENT')
  const canApplyDiscount = hasPermission(user, 'APPLY_DISCOUNT')
  const canUnlockOrdering = hasPermission(user, 'CLOSE_SESSION')

  const service = createServiceClient()

  const [sessionRes, settingsRes] = await Promise.all([
    service
      .from('sessions')
      .select('id, table_id, status, started_at, ordering_locked, bill_requested')
      .eq('id', sessionId)
      .eq('restaurant_id', user.restaurantId)
      .single(),
    service
      .from('restaurant_settings')
      .select('default_service_charge_percent')
      .eq('restaurant_id', user.restaurantId)
      .single(),
  ])

  if (!sessionRes.data) notFound()
  const session = sessionRes.data as any
  if (session.status !== 'active') redirect('/operations/sessions')

  const { data: tableData } = await service
    .from('restaurant_tables')
    .select('display_name')
    .eq('id', session.table_id)
    .single()

  const tableName = (tableData as any)?.display_name ?? 'Unknown Table'
  const serviceChargePct = (settingsRes.data as any)?.default_service_charge_percent ?? 0

  const [ordersRes, discountsRes] = await Promise.all([
    service
      .from('session_orders')
      .select('id, status, total_amount, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true }),
    service
      .from('discounts')
      .select('id, type, value')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(1),
  ])

  const allOrders = (ordersRes.data ?? []) as any[]
  const billableOrders = allOrders.filter(
    (o) => o.status !== 'cancelled' && o.status !== 'rejected',
  )

  // Fetch items for billable orders
  const itemsByOrder = new Map<string, any[]>()
  if (billableOrders.length > 0) {
    const { data: items } = await service
      .from('session_order_items')
      .select('id, order_id, menu_item_name, variant_name, unit_price, quantity, addons_snapshot')
      .in('order_id', billableOrders.map((o) => o.id))
    for (const item of (items ?? []) as any[]) {
      const arr = itemsByOrder.get(item.order_id) ?? []
      arr.push(item)
      itemsByOrder.set(item.order_id, arr)
    }
  }

  // Bill calculation
  const subtotal = billableOrders.reduce((s, o) => s + o.total_amount, 0)
  const serviceChargePaise = Math.round(subtotal * serviceChargePct / 100)
  const currentDiscount = ((discountsRes.data ?? []) as any[])[0] ?? null

  let discountPaise = 0
  if (currentDiscount) {
    discountPaise =
      currentDiscount.type === 'fixed'
        ? currentDiscount.value
        : Math.round(subtotal * currentDiscount.value / 100)
  }

  const totalPayable = Math.max(0, subtotal + serviceChargePaise - discountPaise)

  const elapsedMins = Math.floor(
    (Date.now() - new Date(session.started_at).getTime()) / 60000,
  )
  const elapsedLabel =
    elapsedMins >= 60
      ? `${Math.floor(elapsedMins / 60)}h ${elapsedMins % 60}m`
      : `${elapsedMins}m`

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/operations/sessions"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        ← Sessions
      </Link>

      {/* Session header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">{tableName}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Active for {elapsedLabel}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {session.bill_requested && (
            <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-600">
              Bill Requested
            </span>
          )}
          {session.ordering_locked && (
            <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
              Ordering Locked
            </span>
          )}
        </div>
      </div>

      {/* Orders breakdown */}
      {billableOrders.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Orders
          </h2>
          <div className="space-y-2">
            {billableOrders.map((order, idx) => {
              const items = itemsByOrder.get(order.id) ?? []
              const time = new Date(order.created_at).toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
              })
              return (
                <div
                  key={order.id}
                  className="overflow-hidden rounded-xl border border-border bg-card"
                >
                  <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                    <p className="text-xs text-muted-foreground">
                      Order #{idx + 1} · {time}
                    </p>
                    <span className="font-mono text-sm font-medium text-foreground">
                      {fmt(order.total_amount)}
                    </span>
                  </div>
                  <div className="divide-y divide-border">
                    {items.map((item) => {
                      const addonTotal = ((item.addons_snapshot ?? []) as any[]).reduce(
                        (s: number, a: any) => s + a.additional_price,
                        0,
                      )
                      return (
                        <div
                          key={item.id}
                          className="flex items-center justify-between px-4 py-2 text-sm"
                        >
                          <span className="text-foreground">
                            {item.quantity}× {item.menu_item_name}
                            {item.variant_name && (
                              <span className="text-muted-foreground"> ({item.variant_name})</span>
                            )}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {fmt((item.unit_price + addonTotal) * item.quantity)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Bill summary */}
      <section className="overflow-hidden rounded-xl border border-border bg-card divide-y divide-border">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm text-muted-foreground">Items Subtotal</span>
          <span className="font-mono text-sm text-foreground">{fmt(subtotal)}</span>
        </div>
        {serviceChargePaise > 0 && (
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-muted-foreground">
              Service Charge ({serviceChargePct}%)
            </span>
            <span className="font-mono text-sm text-foreground">{fmt(serviceChargePaise)}</span>
          </div>
        )}
        {discountPaise > 0 && (
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-muted-foreground">
              Discount
              {currentDiscount.type === 'percentage'
                ? ` (${currentDiscount.value}%)`
                : ''}
            </span>
            <span className="font-mono text-sm text-green-600">-{fmt(discountPaise)}</span>
          </div>
        )}
        <div className="flex items-center justify-between bg-muted/30 px-4 py-3">
          <span className="text-base font-semibold text-foreground">Total Payable</span>
          <span className="font-mono text-lg font-bold text-foreground">{fmt(totalPayable)}</span>
        </div>
      </section>

      {/* Discount management */}
      {canApplyDiscount && (
        <DiscountForm
          sessionId={sessionId}
          currentDiscount={
            currentDiscount
              ? {
                  id: currentDiscount.id,
                  type: currentDiscount.type,
                  value: currentDiscount.value,
                  displayAmount: discountPaise,
                }
              : null
          }
        />
      )}

      {/* Payment processing */}
      {canProcessPayment && (
        <PaymentForm sessionId={sessionId} totalPayable={totalPayable} />
      )}

      {/* Unlock ordering */}
      {session.ordering_locked && canUnlockOrdering && (
        <UnlockOrderingButton sessionId={sessionId} />
      )}
    </div>
  )
}
