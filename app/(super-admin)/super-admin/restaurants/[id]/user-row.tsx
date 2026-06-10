'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setUserActive } from '@/app/actions/users'

type UserRowProps = {
  user: {
    id: string
    employee_id: string
    name: string
    display_title: string
    role: string
    is_active: boolean
    auth_user_id: string
    permission_templates: { id: string; name: string } | null
  }
  restaurantId: string
}

export function UserRow({ user: u, restaurantId }: UserRowProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function toggle() {
    startTransition(async () => {
      await setUserActive(u.id, restaurantId, !u.is_active)
      router.refresh()
    })
  }

  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/30">
      <td className="px-4 py-3 font-mono text-xs text-foreground">{u.employee_id}</td>
      <td className="px-4 py-3 text-foreground">{u.name}</td>
      <td className="px-4 py-3 text-muted-foreground">{u.display_title}</td>
      <td className="px-4 py-3">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
          u.role === 'restaurant_admin'
            ? 'bg-primary/15 text-primary'
            : 'bg-muted text-muted-foreground'
        }`}>
          {u.role === 'restaurant_admin' ? 'Admin' : 'Employee'}
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {u.permission_templates?.name ?? '—'}
      </td>
      <td className="px-4 py-3">
        <span className={`text-xs font-medium ${u.is_active ? 'text-green-400' : 'text-muted-foreground'}`}>
          {u.is_active ? 'Yes' : 'No'}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <button
          onClick={toggle}
          disabled={isPending}
          className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {isPending ? '…' : u.is_active ? 'Deactivate' : 'Activate'}
        </button>
      </td>
    </tr>
  )
}
