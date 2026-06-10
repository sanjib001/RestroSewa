'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteCategory } from '@/app/actions/menu-categories'

export function DeleteCategoryButton({ categoryId, categoryName }: { categoryId: string; categoryName: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  return (
    <button
      onClick={() => {
        if (!confirm(`Delete category "${categoryName}"?`)) return
        startTransition(async () => {
          const result = await deleteCategory(categoryId)
          if (!result.success) { alert(result.error); return }
          router.refresh()
        })
      }}
      disabled={isPending}
      className="text-xs text-destructive/50 hover:text-destructive disabled:opacity-50"
    >
      {isPending ? '…' : 'Delete'}
    </button>
  )
}
