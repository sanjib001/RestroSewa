'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { activateSession, forceCloseSession, markCleaningComplete } from '@/app/actions/sessions'

type SessionInfo = {
  id: string
  started_at: string
  ordering_locked: boolean
  bill_requested: boolean
}

type TableData = {
  id: string
  display_name: string
  status: string
  group_name: string | null
  session: SessionInfo | null
}

const STATUS_CONFIG: Record<string, { label: string; badge: string }> = {
  available: { label: 'Available', badge: 'bg-green-500/10 text-green-700 border-green-500/20' },
  waiting_activation: { label: 'Waiting', badge: 'bg-amber-500/10 text-amber-700 border-amber-500/20' },
  occupied: { label: 'Occupied', badge: 'bg-blue-500/10 text-blue-700 border-blue-500/20' },
  cleaning: { label: 'Cleaning', badge: 'bg-muted text-muted-foreground border-border' },
}

function elapsedLabel(startedAt: string): string {
  const diffMs = Date.now() - new Date(startedAt).getTime()
  const minutes = Math.floor(diffMs / 60000)
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return hours > 0 ? `${hours}h ${mins}m` : `${minutes}m`
}

export function SessionTableCard({
  table,
  canActivate,
  canClose,
}: {
  table: TableData
  canActivate: boolean
  canClose: boolean
}) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const statusConfig = STATUS_CONFIG[table.status] ?? {
    label: table.status,
    badge: 'bg-muted text-muted-foreground border-border',
  }

  function handleActivate() {
    setError(null)
    startTransition(async () => {
      const result = await activateSession(table.id)
      if (!result.success) setError(result.error)
    })
  }

  function handleForceClose() {
    if (!table.session) return
    if (
      !confirm(
        `Force close session at ${table.display_name}?\n\nThis ends the session without payment. Use only for exceptional situations.`,
      )
    )
      return
    setError(null)
    startTransition(async () => {
      const result = await forceCloseSession(table.session!.id)
      if (!result.success) setError(result.error)
    })
  }

  function handleMarkClean() {
    setError(null)
    startTransition(async () => {
      const result = await markCleaningComplete(table.id)
      if (!result.success) setError(result.error)
    })
  }

  return (
    <div
      className={`flex flex-col rounded-xl border border-border bg-card p-4 transition-opacity ${isPending ? 'opacity-50 pointer-events-none' : ''}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-foreground">{table.display_name}</p>
          {table.group_name && (
            <p className="text-xs text-muted-foreground">{table.group_name}</p>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusConfig.badge}`}
        >
          {statusConfig.label}
        </span>
      </div>

      {/* Session info */}
      {table.session && (
        <div className="mt-3 space-y-0.5 text-xs">
          <p className="text-muted-foreground">
            Active for{' '}
            <span className="font-medium text-foreground">{elapsedLabel(table.session.started_at)}</span>
          </p>
          {table.session.bill_requested && (
            <p className="text-amber-600">Bill requested</p>
          )}
          {table.session.ordering_locked && !table.session.bill_requested && (
            <p className="text-muted-foreground">Ordering locked</p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex flex-col gap-2">
        {table.status === 'occupied' && table.session && (
          <Link
            href={`/operations/sessions/${table.session.id}/bill`}
            className="rounded-lg border border-border px-3 py-2 text-center text-sm font-medium text-foreground hover:bg-muted"
          >
            {table.session.bill_requested ? 'Process Bill →' : 'View Bill →'}
          </Link>
        )}

        {table.status === 'waiting_activation' && canActivate && (
          <button
            onClick={handleActivate}
            disabled={isPending}
            className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Activate Session
          </button>
        )}

        {table.status === 'occupied' && canClose && table.session && (
          <button
            onClick={handleForceClose}
            disabled={isPending}
            className="rounded-lg border border-destructive/30 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/5 disabled:opacity-50"
          >
            Force Close
          </button>
        )}

        {table.status === 'cleaning' && (
          <button
            onClick={handleMarkClean}
            disabled={isPending}
            className="rounded-lg bg-muted px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/80 disabled:opacity-50"
          >
            Mark as Clean
          </button>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  )
}
