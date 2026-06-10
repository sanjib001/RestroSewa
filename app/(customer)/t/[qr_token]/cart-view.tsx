'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { submitOrder, submitHelpRequest, submitBillRequest } from '@/app/actions/customer'
import type { Session } from './page'
import type { CartEntry, CartAction } from './customer-app'

function fmt(paise: number) {
  return `₹${(paise / 100).toFixed(2)}`
}

export function CartView({
  qrToken,
  session,
  cart,
  dispatch,
  onOrderPlaced,
}: {
  qrToken: string
  session: Session | null
  cart: CartEntry[]
  dispatch: React.Dispatch<CartAction>
  onOrderPlaced: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [helpPending, startHelpTransition] = useTransition()
  const [billPending, startBillTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [helpMsg, setHelpMsg] = useState<string | null>(null)
  const [billMsg, setBillMsg] = useState<string | null>(null)

  const cartTotal = cart.reduce((s, e) => s + (e.unitPricePaise + e.addonTotalPaise) * e.quantity, 0)

  function handleOrder() {
    if (!session) return
    setError(null)
    startTransition(async () => {
      const result = await submitOrder(
        qrToken,
        session.id,
        cart.map((e) => ({
          menuItemId: e.menuItemId,
          variantId: e.variantId,
          addonIds: e.addonIds,
          quantity: e.quantity,
          notes: e.notes,
        })),
      )
      if (!result.success) { setError(result.error); return }
      router.refresh()
      onOrderPlaced()
    })
  }

  function handleHelp() {
    if (!session) return
    setHelpMsg(null)
    startHelpTransition(async () => {
      const result = await submitHelpRequest(qrToken, session.id)
      if (!result.success) { setHelpMsg(result.error); return }
      setHelpMsg('Help request sent! Staff will be with you shortly.')
    })
  }

  function handleBill() {
    if (!session) return
    setBillMsg(null)
    startBillTransition(async () => {
      const result = await submitBillRequest(qrToken, session.id)
      if (!result.success) { setBillMsg(result.error); return }
      setBillMsg('Bill requested! Staff will bring your bill shortly.')
      router.refresh()
    })
  }

  return (
    <div className="px-4 py-4 space-y-5">
      {/* Cart items */}
      {cart.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-muted-foreground">Your cart is empty. Browse the Menu tab to add items.</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {cart.map((entry) => {
              const lineTotal = (entry.unitPricePaise + entry.addonTotalPaise) * entry.quantity
              return (
                <div key={entry.key} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground">{entry.menuItemName}</p>
                      {entry.variantName && (
                        <p className="text-xs text-muted-foreground">{entry.variantName}</p>
                      )}
                      {entry.addonNames.length > 0 && (
                        <p className="text-xs text-muted-foreground">{entry.addonNames.join(', ')}</p>
                      )}
                      {entry.notes && (
                        <p className="mt-0.5 text-xs italic text-muted-foreground">"{entry.notes}"</p>
                      )}
                    </div>
                    <p className="shrink-0 font-mono text-sm font-medium text-foreground">{fmt(lineTotal)}</p>
                  </div>

                  <div className="mt-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-3 rounded-lg border border-border px-2.5 py-1">
                      <button
                        onClick={() => dispatch({ type: 'DECREMENT', key: entry.key })}
                        className="text-base font-bold text-primary w-5 text-center"
                      >−</button>
                      <span className="w-4 text-center text-sm text-foreground">{entry.quantity}</span>
                      <button
                        onClick={() => dispatch({ type: 'INCREMENT', key: entry.key })}
                        className="text-base font-bold text-primary w-5 text-center"
                      >+</button>
                    </div>
                    <button
                      onClick={() => dispatch({ type: 'REMOVE', key: entry.key })}
                      className="text-xs text-destructive/60 hover:text-destructive"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Total + Place Order */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-foreground">Subtotal</p>
              <p className="font-mono text-sm font-semibold text-foreground">{fmt(cartTotal)}</p>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Taxes and service charge added at billing.</p>
          </div>

          {error && (
            <p className="rounded-lg bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</p>
          )}

          {session && !session.ordering_locked ? (
            <button
              onClick={handleOrder}
              disabled={isPending}
              className="w-full rounded-xl bg-primary py-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {isPending ? 'Placing Order…' : `Place Order · ${fmt(cartTotal)}`}
            </button>
          ) : session?.ordering_locked ? (
            <div className="rounded-xl bg-muted px-4 py-3 text-center">
              <p className="text-sm text-muted-foreground">Ordering locked — bill has been requested.</p>
            </div>
          ) : null}
        </>
      )}

      {/* Session actions */}
      {session && (
        <div className="border-t border-border pt-5 space-y-3">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Table Actions</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <button
                onClick={handleHelp}
                disabled={helpPending}
                className="w-full rounded-xl border border-border bg-card py-3 text-sm font-medium text-foreground disabled:opacity-50"
              >
                {helpPending ? '…' : '🙋 Call Staff'}
              </button>
              {helpMsg && <p className="mt-1 text-xs text-muted-foreground">{helpMsg}</p>}
            </div>

            <div>
              {!session.bill_requested ? (
                <>
                  <button
                    onClick={handleBill}
                    disabled={billPending}
                    className="w-full rounded-xl border border-primary bg-primary/10 py-3 text-sm font-medium text-primary disabled:opacity-50"
                  >
                    {billPending ? '…' : '🧾 Request Bill'}
                  </button>
                  {billMsg && <p className="mt-1 text-xs text-muted-foreground">{billMsg}</p>}
                </>
              ) : (
                <div className="w-full rounded-xl border border-border bg-muted py-3 text-center text-sm text-muted-foreground">
                  Bill Requested
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
