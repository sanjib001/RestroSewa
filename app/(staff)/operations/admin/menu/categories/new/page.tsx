import { redirect } from 'next/navigation'
import { getAuthUser, hasPermission } from '@/lib/auth'
import { CategoryForm } from './category-form'

export default async function NewCategoryPage() {
  const user = await getAuthUser()
  if (!user || !hasPermission(user, 'MANAGE_MENU')) redirect('/operations')

  return (
    <div className="max-w-lg">
      <h1 className="mb-6 font-heading text-2xl font-semibold text-foreground">New Category</h1>
      <CategoryForm />
    </div>
  )
}
