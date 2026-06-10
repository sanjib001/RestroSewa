'use client'

import { useState, useTransition } from 'react'
import {
  acceptOrder,
  rejectOrder,
  markOrderPreparing,
  markOrderReady,
  markOrderServed,
  markItemServed,
} from '@/app/actions/orders'

export type OrderItem = {
  id: string
  menu_item_name: string
  variant_name: string | null
  unit_price: number
  quantity: number
  addons_snapshot: { name: string; additional_price: number }[]
  notes: string | null
  serving_status: string
}

export type Order = {
  id: string
  status: string
  total_amount: number
  created_at: string
  table_name: string
  items: OrderItem[]
}

function fmt(paise: number) {
  return `₹${(paise / 100).toFixed(2)}`
}

function elapsedLabel(createdAt: string): string {
  const diffMs = Date.now() - new Date(createdAt).getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'text-amber-600 bg-amber-500/10 border-amber-500/20',
  accepted: 'text-blue-600 bg-blue-500/10 border-blue-500/20',
  preparing: 'text-purple-600 bg-purple-500/10 border-purple-500/20',
  ready: 'text-green-700 bg-green-500/10 border-green-500/20',
  served: 'text-muted-foreground bg-muted border-border',
  rejected: 'text-destructive bg-destructive/10 border-destructive/20',
  cancelled: 'text-muted-foreground bg-muted border-border',
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'New',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
  served: 'Served',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

export function OrderCard({
  order,
  canAccept,
  canReject,
}: {
  order: Order
  canAccept: boolean
  canReject: boolean
}) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const statusColor = STATUS_COLORS[order.status] ?? STATUS_COLORS.pending
  const statusLabel = STATUS_LABELS[order.status] ?? order.status

  function run(action: () => Promise<{ success: boolean; error?: string }>) {
    setError(null)
    startTransition(async () => {
      const result = await action()
      if (!result.success) setError((result as any).error ?? 'Something went wrong.')
    })
  }

  const pendingItemCount = order.items.filter((i) => i.serving_status === 'pending').length

  return (
    <div
      className={`rounded-xl border border-border bg-card overflow-hidden transition-opacity ${isPending ? 'opacity-50 pointer-events-none' : ''}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <p className="font-medium text-foreground">{order.table_name}</p>
          <p className="text-xs text-muted-foreground">{elapsedLabel(order.created_at)}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusColor}`}>
            {statusLabel}
          </span>
          <span className="font-mono text-sm font-semibold text-foreground">{fmt(order.total_amount)}</span>
        </div>
      </div>

      {/* Items */}
      <div className="divide-y divide-border">
        {order.items.map((item) => {
          const addonTotal = item.addons_snapshot.reduce((s, a) => s + a.additional_price, 0)
          const itemTotal = (item.unit_price + addonTotal) * item.quantity
          const isServed = item.serving_status === 'served'

          return (
            <div key={item.id} className={`flex items-start justify-between gap-2 px-4 py-2.5 ${isServed ? 'opacity-50' : ''}`}>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground">
                  <span className="font-medium">{item.quantity}×</span> {item.menu_item_name}
                  {item.variant_name && (
                    <span className="text-muted-foreground"> ({item.variant_name})</span>
                  )}
                </p>
                {item.addons_snapshot.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    + {item.addons_snapshot.map((a) => a.name).join(', ')}
                  </p>
                )}
                {item.notes && (
                  <p className="mt-0.5 text-xs italic text-amber-600">"{item.notes}"</p>
                )}
              </div>
              <div className="shrink-0 flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{fmt(itemTotal)}</span>
                {order.status === 'ready' && !isServed && (
                  <button
                    onClick={() => run(() => markItemServed(item.id))}
                    className="rounded border border-green-500/30 px-2 py-0.5 text-xs font-medium text-green-700 hover:bg-green-500/10"
                  >
                    Serve
                  </button>
                )}
                {isServed && (
                  <span className="text-xs text-green-600">✓</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Actions */}
      <div className="border-t border-border px-4 py-3">
        {error && <p className="mb-2 text-xs text-destructive">{error}</p>}

        <div className="flex flex-wrap gap-2">
          {order.status === 'pending' && (
            <>
              {canAccept && (
                <button
                  onClick={() => run(() => acceptOrder(order.id))}
                  className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground"
                >
                  Accept
                </button>
              )}
              {canReject && (
                <button
                  onClick={() => run(() => rejectOrder(order.id))}
                  className="rounded-lg border border-destructive/30 px-4 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/5"
                >
                  Reject
                </button>
              )}
            </>
          )}

          {order.status === 'accepted' && canAccept && (
            <button
              onClick={() => run(() => markOrderPreparing(order.id))}
              className="rounded-lg bg-purple-600 px-4 py-1.5 text-sm font-medium text-white"
            >
              Start Preparing
            </button>
          )}

          {order.status === 'preparing' && canAccept && (
            <button
              onClick={() => run(() => markOrderReady(order.id))}
              className="rounded-lg bg-green-600 px-4 py-1.5 text-sm font-medium text-white"
            >
              Mark Ready
            </button>
          )}

          {order.status === 'ready' && canAccept && (
            <button
              onClick={() => run(() => markOrderServed(order.id))}
              className="rounded-lg bg-green-700 px-4 py-1.5 text-sm font-medium text-white"
            >
              {pendingItemCount > 0 ? `Serve All (${pendingItemCount} left)` : 'Mark Served'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
