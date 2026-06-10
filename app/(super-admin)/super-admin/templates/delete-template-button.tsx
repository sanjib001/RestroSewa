'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deletePermissionTemplate } from '@/app/actions/permission-templates'

export function DeleteTemplateButton({ templateId }: { templateId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function handleDelete() {
    if (!confirm('Delete this template? This cannot be undone.')) return
    startTransition(async () => {
      const result = await deletePermissionTemplate(templateId)
      if (!result.success) { alert(result.error); return }
      router.refresh()
    })
  }

  return (
    <button onClick={handleDelete} disabled={isPending} className="text-xs text-destructive/60 hover:text-destructive disabled:opacity-50">
      {isPending ? '…' : 'Delete'}
    </button>
  )
}
