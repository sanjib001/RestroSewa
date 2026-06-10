'use client'

import type { Order } from './page'

function fmt(paise: number) {
  return `₹${(paise / 100).toFixed(2)}`
}

const ORDER_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: 'Placed', color: 'text-yellow-600 bg-yellow-500/10' },
  accepted: { label: 'Accepted', color: 'text-blue-600 bg-blue-500/10' },
  preparing: { label: 'Preparing', color: 'text-purple-600 bg-purple-500/10' },
  ready: { label: 'Ready', color: 'text-green-700 bg-green-500/10' },
  served: { label: 'Served', color: 'text-green-700 bg-green-500/10' },
  cancelled: { label: 'Cancelled', color: 'text-muted-foreground bg-muted' },
  rejected: { label: 'Rejected', color: 'text-destructive bg-destructive/10' },
}

const SERVING_STATUS: Record<string, string> = {
  pending: 'Pending',
  served: 'Served',
}

export function OrdersView({ orders }: { orders: Order[] }) {
  if (orders.length === 0) {
    return (
      <div className="px-4 py-16 text-center">
        <p className="text-sm text-muted-foreground">No orders placed yet.</p>
        <p className="mt-1 text-xs text-muted-foreground">Add items from the Menu tab and place your order.</p>
      </div>
    )
  }

  return (
    <div className="px-4 py-4 space-y-4">
      <p className="text-xs text-muted-foreground">{orders.length} order{orders.length !== 1 ? 's' : ''} placed</p>

      {orders.map((order, idx) => {
        const status = ORDER_STATUS[order.status] ?? { label: order.status, color: 'text-muted-foreground bg-muted' }
        const time = new Date(order.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })

        return (
          <div key={order.id} className="rounded-xl border border-border bg-card overflow-hidden">
            {/* Order header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div>
                <p className="text-xs text-muted-foreground">Order #{orders.length - idx}</p>
                <p className="text-xs text-muted-foreground">{time}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${status.color}`}>
                  {status.label}
                </span>
                <span className="font-mono text-sm font-semibold text-foreground">{fmt(order.total_amount)}</span>
              </div>
            </div>

            {/* Order items */}
            <div className="divide-y divide-border">
              {order.items.map((item) => {
                const addonTotal = (item.addons_snapshot ?? []).reduce(
                  (s: number, a: any) => s + a.additional_price,
                  0,
                )
                const itemTotal = (item.unit_price + addonTotal) * item.quantity

                return (
                  <div key={item.id} className="flex items-start justify-between gap-2 px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground">
                        {item.quantity}× {item.menu_item_name}
                        {item.variant_name && <span className="text-muted-foreground"> ({item.variant_name})</span>}
                      </p>
                      {(item.addons_snapshot ?? []).length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          + {(item.addons_snapshot as any[]).map((a) => a.name).join(', ')}
                        </p>
                      )}
                      {item.notes && (
                        <p className="text-xs italic text-muted-foreground">"{item.notes}"</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-mono text-sm text-foreground">{fmt(itemTotal)}</p>
                      {item.serving_status === 'served' && (
                        <p className="text-xs text-green-600">✓ Served</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
