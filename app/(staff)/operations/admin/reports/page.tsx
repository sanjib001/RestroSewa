import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAuthUser } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'

function fmt(paise: number) {
  return `₹${(paise / 100).toFixed(2)}`
}

function sessionDuration(startedAt: string, endedAt: string | null): string {
  const end = endedAt ? new Date(endedAt) : new Date()
  const mins = Math.floor((end.getTime() - new Date(startedAt).getTime()) / 60000)
  const h = Math.floor(mins / 60)
  return h > 0 ? `${h}h ${mins % 60}m` : `${mins}m`
}

export default async function ReportsPage() {
  const user = await getAuthUser()
  if (!user || user.role !== 'restaurant_admin') redirect('/operations')

  const service = createServiceClient()

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayStartISO = todayStart.toISOString()

  // Round 1 — all independent queries in parallel
  const [paymentsRes, sessionsRes, ordersRes, outstandingPaymentsRes] = await Promise.all([
    service
      .from('session_payments')
      .select('session_id, amount, method')
      .eq('restaurant_id', user.restaurantId!)
      .gte('created_at', todayStartISO),
    service
      .from('sessions')
      .select('id, table_id, started_at, ended_at')
      .eq('restaurant_id', user.restaurantId!)
      .eq('status', 'completed')
      .gte('ended_at', todayStartISO)
      .order('ended_at', { ascending: false }),
    service
      .from('session_orders')
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', user.restaurantId!)
      .gte('created_at', todayStartISO)
      .neq('status', 'cancelled')
      .neq('status', 'rejected'),
    service
      .from('session_payments')
      .select('session_id, amount, created_at')
      .eq('restaurant_id', user.restaurantId!)
      .eq('method', 'outstanding')
      .order('created_at', { ascending: false }),
  ])

  const payments = (paymentsRes.data ?? []) as any[]
  const sessions = (sessionsRes.data ?? []) as any[]
  const orderCount = ordersRes.count ?? 0
  const outstandingPayments = (outstandingPaymentsRes.data ?? []) as any[]

  // Revenue computation (today)
  let cashTotal = 0, onlineTotal = 0, outstandingTodayTotal = 0
  for (const p of payments) {
    if (p.method === 'cash') cashTotal += p.amount
    else if (p.method === 'online') onlineTotal += p.amount
    else if (p.method === 'outstanding') outstandingTodayTotal += p.amount
  }
  const totalRevenue = cashTotal + onlineTotal + outstandingTodayTotal
  const avgSessionValue = sessions.length > 0 ? Math.round(totalRevenue / sessions.length) : 0

  // Round 2 — fetch outstanding session details if any exist
  const outstandingSessionIds = outstandingPayments.map((p: any) => p.session_id)
  let outstandingSessionDetails: any[] = []
  if (outstandingSessionIds.length > 0) {
    const { data } = await service
      .from('sessions')
      .select('id, table_id, ended_at')
      .in('id', outstandingSessionIds)
    outstandingSessionDetails = (data ?? []) as any[]
  }

  // Round 3 — fetch all needed table names in one query
  const allTableIds = [
    ...new Set([
      ...sessions.map((s: any) => s.table_id),
      ...outstandingSessionDetails.map((s: any) => s.table_id),
    ]),
  ]
  const tableMap = new Map<string, string>()
  if (allTableIds.length > 0) {
    const { data: tables } = await service
      .from('restaurant_tables')
      .select('id, display_name')
      .in('id', allTableIds)
    for (const t of (tables ?? []) as any[]) tableMap.set(t.id, t.display_name)
  }

  // Build today's session rows with payment data
  const paymentsBySession = new Map<string, { total: number; methods: string[] }>()
  for (const p of payments) {
    const cur = paymentsBySession.get(p.session_id) ?? { total: 0, methods: [] }
    cur.total += p.amount
    if (!cur.methods.includes(p.method)) cur.methods.push(p.method)
    paymentsBySession.set(p.session_id, cur)
  }
  const todaySessions = sessions.map((s: any) => ({
    id: s.id,
    tableName: tableMap.get(s.table_id) ?? 'Unknown',
    duration: sessionDuration(s.started_at, s.ended_at),
    payment: paymentsBySession.get(s.id) ?? { total: 0, methods: [] },
  }))

  // Build outstanding balance rows
  const outstandingRows = outstandingPayments.map((p: any) => {
    const detail = outstandingSessionDetails.find((s: any) => s.id === p.session_id)
    return {
      sessionId: p.session_id,
      amount: p.amount,
      tableName: detail ? (tableMap.get(detail.table_id) ?? 'Unknown') : 'Unknown',
      closedAt: detail?.ended_at ?? p.created_at,
    }
  })

  const todayLabel = todayStart.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="mb-1 flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/operations" className="hover:text-foreground">Dashboard</Link>
          <span>›</span>
          <span>Reports</span>
        </div>
        <h1 className="font-heading text-2xl font-bold text-foreground">Reports</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Today · {todayLabel}</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-card px-5 py-4">
          <p className="text-xs text-muted-foreground">Revenue</p>
          <p className="mt-1 font-mono text-2xl font-bold text-foreground">{fmt(totalRevenue)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-5 py-4">
          <p className="text-xs text-muted-foreground">Sessions Closed</p>
          <p className="mt-1 font-heading text-2xl font-bold text-foreground">{sessions.length}</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-5 py-4">
          <p className="text-xs text-muted-foreground">Orders Served</p>
          <p className="mt-1 font-heading text-2xl font-bold text-foreground">{orderCount}</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-5 py-4">
          <p className="text-xs text-muted-foreground">Avg Session Value</p>
          <p className="mt-1 font-mono text-2xl font-bold text-foreground">
            {sessions.length > 0 ? fmt(avgSessionValue) : '—'}
          </p>
        </div>
      </div>

      {/* Revenue by payment method */}
      {totalRevenue > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Revenue by Method
          </h2>
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {cashTotal > 0 && (
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="w-14 text-sm text-foreground">Cash</span>
                  <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-green-500"
                      style={{ width: `${((cashTotal / totalRevenue) * 100).toFixed(0)}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {((cashTotal / totalRevenue) * 100).toFixed(0)}%
                  </span>
                </div>
                <span className="font-mono text-sm text-foreground">{fmt(cashTotal)}</span>
              </div>
            )}
            {onlineTotal > 0 && (
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="w-14 text-sm text-foreground">Online</span>
                  <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-blue-500"
                      style={{ width: `${((onlineTotal / totalRevenue) * 100).toFixed(0)}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {((onlineTotal / totalRevenue) * 100).toFixed(0)}%
                  </span>
                </div>
                <span className="font-mono text-sm text-foreground">{fmt(onlineTotal)}</span>
              </div>
            )}
            {outstandingTodayTotal > 0 && (
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="w-14 text-sm text-amber-600">Outstanding</span>
                  <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-amber-500"
                      style={{ width: `${((outstandingTodayTotal / totalRevenue) * 100).toFixed(0)}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {((outstandingTodayTotal / totalRevenue) * 100).toFixed(0)}%
                  </span>
                </div>
                <span className="font-mono text-sm text-amber-600">{fmt(outstandingTodayTotal)}</span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Outstanding balances — all time */}
      {outstandingRows.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Outstanding Balances ({outstandingRows.length})
          </h2>
          <div className="overflow-hidden rounded-xl border border-amber-500/20 bg-amber-500/5">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-amber-500/20">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Table</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Amount</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Closed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-500/10">
                {outstandingRows.map((row) => (
                  <tr key={row.sessionId}>
                    <td className="px-4 py-2.5 font-medium text-foreground">{row.tableName}</td>
                    <td className="px-4 py-2.5 font-mono text-amber-600">{fmt(row.amount)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {new Date(row.closedAt).toLocaleString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Today's sessions */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Today's Sessions ({sessions.length})
        </h2>
        {sessions.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">No sessions closed yet today.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Table</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Duration</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Amount</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Method</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {todaySessions.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-2.5 font-medium text-foreground">{s.tableName}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{s.duration}</td>
                    <td className="px-4 py-2.5 font-mono text-foreground">{fmt(s.payment.total)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {s.payment.methods.map((m: string) => (
                          <span
                            key={m}
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${
                              m === 'outstanding'
                                ? 'border-amber-500/20 bg-amber-500/10 text-amber-600'
                                : 'border-border bg-muted text-muted-foreground'
                            }`}
                          >
                            {m}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
