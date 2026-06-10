'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteTable } from '@/app/actions/tables'

const STATUS_COLORS: Record<string, string> = {
  available: 'text-green-400',
  occupied: 'text-yellow-400',
  waiting_activation: 'text-blue-400',
  cleaning: 'text-orange-400',
}

type TableData = {
  id: string
  display_name: string
  status: string
  qr_token: string
  position: number
  table_group_id: string | null
}

export function TableRow({ table: t, appUrl }: { table: TableData; appUrl: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [copied, setCopied] = useState(false)
  const tableUrl = `${appUrl}/t/${t.qr_token}`

  function handleCopy() {
    navigator.clipboard.writeText(tableUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function handleDelete() {
    if (!confirm(`Delete table "${t.display_name}"?`)) return
    startTransition(async () => {
      const result = await deleteTable(t.id)
      if (!result.success) { alert(result.error); return }
      router.refresh()
    })
  }

  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/30">
      <td className="px-4 py-3 font-medium text-foreground">{t.display_name}</td>
      <td className="px-4 py-3">
        <span className={`text-xs font-medium ${STATUS_COLORS[t.status] ?? 'text-muted-foreground'}`}>
          {t.status.replace('_', ' ')}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="max-w-[200px] truncate font-mono text-xs text-muted-foreground">{tableUrl}</span>
          <button onClick={handleCopy} className="shrink-0 text-xs text-primary hover:underline">
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-3">
          <Link href={`/operations/admin/tables/${t.id}/edit`} className="text-xs text-muted-foreground hover:text-foreground">
            Edit
          </Link>
          <Link
            href={`/operations/admin/tables/${t.id}/qr`}
            className="text-xs text-primary hover:underline"
            target="_blank"
          >
            QR
          </Link>
          <button onClick={handleDelete} disabled={isPending} className="text-xs text-destructive/60 hover:text-destructive disabled:opacity-50">
            {isPending ? '…' : 'Delete'}
          </button>
        </div>
      </td>
    </tr>
  )
}
