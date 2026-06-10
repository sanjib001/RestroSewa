'use client'

import { useTransition } from 'react'
import { signOut } from '@/app/actions/auth'

export function SignOutButton() {
  const [isPending, startTransition] = useTransition()
  return (
    <button
      onClick={() => startTransition(() => signOut())}
      disabled={isPending}
      className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
    >
      {isPending ? 'Signing out…' : 'Sign Out'}
    </button>
  )
}
