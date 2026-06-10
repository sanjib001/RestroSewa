'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createTableGroup, deleteTableGroup } from '@/app/actions/table-groups'

type Group = { id: string; name: string }

export function GroupManager({ groups }: { groups: Group[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await createTableGroup(newName)
      if (!result.success) { setError(result.error); return }
      setNewName('')
      router.refresh()
    })
  }

  function handleDelete(groupId: string) {
    startTransition(async () => {
      const result = await deleteTableGroup(groupId)
      if (!result.success) { alert(result.error); return }
      router.refresh()
    })
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-3 text-sm font-medium text-foreground hover:bg-muted/30"
      >
        <span>Manage Groups ({groups.length})</span>
        <span className="text-muted-foreground">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-border px-5 py-4 space-y-4">
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          {groups.length > 0 && (
            <ul className="space-y-1.5">
              {groups.map((g) => (
                <li key={g.id} className="flex items-center justify-between text-sm">
                  <span className="text-foreground">{g.name}</span>
                  <button
                    onClick={() => handleDelete(g.id)}
                    disabled={isPending}
                    className="text-xs text-destructive/60 hover:text-destructive disabled:opacity-50"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={handleCreate} className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New group name"
              disabled={isPending}
              className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isPending || !newName.trim()}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {isPending ? '…' : 'Add'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
