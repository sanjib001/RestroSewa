'use client'

import { useReducer, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { Category, MenuItem, Session, Order } from './page'
import { MenuView } from './menu-view'
import { CartView } from './cart-view'
import { OrdersView } from './orders-view'

export type CartEntry = {
  key: string
  menuItemId: string
  menuItemName: string
  variantId: string | null
  variantName: string | null
  addonIds: string[]
  addonNames: string[]
  addonTotalPaise: number
  unitPricePaise: number
  quantity: number
  notes: string
}

export type CartAction =
  | { type: 'ADD'; entry: CartEntry }
  | { type: 'INCREMENT'; key: string }
  | { type: 'DECREMENT'; key: string }
  | { type: 'REMOVE'; key: string }
  | { type: 'CLEAR' }

function cartReducer(state: CartEntry[], action: CartAction): CartEntry[] {
  switch (action.type) {
    case 'ADD': {
      const idx = state.findIndex((e) => e.key === action.entry.key)
      if (idx >= 0) {
        return state.map((e, i) =>
          i === idx ? { ...e, quantity: e.quantity + action.entry.quantity } : e,
        )
      }
      return [...state, action.entry]
    }
    case 'INCREMENT':
      return state.map((e) => (e.key === action.key ? { ...e, quantity: e.quantity + 1 } : e))
    case 'DECREMENT':
      return state.map((e) =>
        e.key === action.key ? { ...e, quantity: Math.max(1, e.quantity - 1) } : e,
      )
    case 'REMOVE':
      return state.filter((e) => e.key !== action.key)
    case 'CLEAR':
      return []
    default:
      return state
  }
}

type Tab = 'menu' | 'cart' | 'orders'

export function CustomerApp({
  qrToken,
  restaurant,
  table,
  session,
  categories,
  items,
  initialOrders,
}: {
  qrToken: string
  restaurant: { id: string; name: string }
  table: { id: string; display_name: string }
  session: Session | null
  categories: Category[]
  items: MenuItem[]
  initialOrders: Order[]
}) {
  const router = useRouter()
  const [cart, dispatch] = useReducer(cartReducer, [])
  const [tab, setTab] = useState<Tab>('menu')
  const [orders, setOrders] = useState<Order[]>(initialOrders)

  // Sync fresh orders from server after router.refresh()
  useEffect(() => { setOrders(initialOrders) }, [initialOrders])

  // Poll for order status updates every 30s when session is active
  useEffect(() => {
    if (!session) return
    const id = setInterval(() => router.refresh(), 30000)
    return () => clearInterval(id)
  }, [session, router])

  const cartCount = cart.reduce((s, e) => s + e.quantity, 0)
  const canOrder = !!session && !session.ordering_locked

  function onOrderPlaced() {
    dispatch({ type: 'CLEAR' })
    setTab('orders')
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border bg-card/90 backdrop-blur-sm">
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground">{restaurant.name}</p>
          <p className="font-heading text-lg font-semibold leading-tight text-foreground">{table.display_name}</p>
        </div>
        {!session && (
          <div className="border-t border-border bg-amber-500/10 px-4 py-2">
            <p className="text-xs text-amber-700">Waiting for staff to activate your table. You can browse the menu.</p>
          </div>
        )}
        {session?.ordering_locked && (
          <div className="border-t border-border bg-muted px-4 py-2">
            <p className="text-xs text-muted-foreground">Bill has been requested — ordering is locked. Speak to staff if you wish to continue ordering.</p>
          </div>
        )}
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto pb-20">
        {tab === 'menu' && (
          <MenuView
            categories={categories}
            items={items}
            session={session}
            cart={cart}
            dispatch={dispatch}
          />
        )}
        {tab === 'cart' && (
          <CartView
            qrToken={qrToken}
            session={session}
            cart={cart}
            dispatch={dispatch}
            onOrderPlaced={onOrderPlaced}
          />
        )}
        {tab === 'orders' && (
          <OrdersView orders={orders} />
        )}
      </main>

      {/* Bottom navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-10 border-t border-border bg-card">
        <div className="grid grid-cols-3">
          {(['menu', 'cart', 'orders'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`relative py-3 text-sm font-medium transition-colors ${
                tab === t ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t === 'cart' ? 'Cart' : t === 'orders' ? 'Orders' : 'Menu'}
              {t === 'cart' && cartCount > 0 && (
                <span className="absolute -top-0.5 right-[calc(50%-22px)] flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                  {cartCount > 9 ? '9+' : cartCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}
