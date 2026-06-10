import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import EmployeeLoginForm from './employee-login-form'

export default async function RestaurantLoginPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const service = createServiceClient()
  const { data: restaurant } = await service
    .from('restaurants')
    .select('id, name, status, logo_url')
    .eq('slug', slug)
    .single()

  if (!restaurant || (restaurant as { status: string }).status === 'archived') notFound()

  const r = restaurant as { id: string; name: string; status: string; logo_url: string | null }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-border bg-card p-8">
        <div className="space-y-1 text-center">
          {r.logo_url && (
            <img src={r.logo_url} alt={r.name} className="mx-auto mb-4 h-12 w-auto object-contain" />
          )}
          <h1 className="font-heading text-2xl font-semibold text-foreground">{r.name}</h1>
          <p className="text-sm text-muted-foreground">Staff Login</p>
        </div>

        {r.status === 'suspended' && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            This restaurant is currently suspended.
          </div>
        )}

        <EmployeeLoginForm slug={slug} disabled={r.status !== 'active'} />
      </div>
    </main>
  )
}
