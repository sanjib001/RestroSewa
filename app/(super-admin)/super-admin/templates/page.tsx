import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/service'
import { DeleteTemplateButton } from './delete-template-button'

const PERMISSION_LABELS: Record<string, string> = {
  ACTIVATE_SESSION: 'Activate Session',
  CLOSE_SESSION: 'Close Session',
  ACCEPT_ORDER: 'Accept Order',
  REJECT_ORDER: 'Reject Order',
  PROCESS_PAYMENT: 'Process Payment',
  APPLY_DISCOUNT: 'Apply Discount',
  MANAGE_MENU: 'Manage Menu',
  MANAGE_TABLES: 'Manage Tables',
  VIEW_REPORTS: 'View Reports',
  VIEW_KDS: 'View KDS',
}

export default async function TemplatesPage() {
  const service = createServiceClient()
  const { data } = await service
    .from('permission_templates')
    .select('id, name, permissions, created_at')
    .order('name')

  const templates = (data ?? []) as { id: string; name: string; permissions: string[]; created_at: string }[]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">Permission Templates</h1>
          <p className="mt-1 text-sm text-muted-foreground">{templates.length} template{templates.length !== 1 ? 's' : ''}</p>
        </div>
        <Link href="/super-admin/templates/new" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
          New Template
        </Link>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          No templates yet.{' '}
          <Link href="/super-admin/templates/new" className="text-primary hover:underline">Create one</Link>.
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => (
            <div key={t.id} className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <p className="font-medium text-foreground">{t.name}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {t.permissions.map((p) => (
                      <span key={p} className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-primary">
                        {PERMISSION_LABELS[p] ?? p}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link href={`/super-admin/templates/${t.id}/edit`} className="text-xs text-muted-foreground hover:text-foreground">
                    Edit
                  </Link>
                  <DeleteTemplateButton templateId={t.id} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
