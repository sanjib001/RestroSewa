import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { TemplateForm } from '../../template-form'

export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const service = createServiceClient()
  const { data } = await service.from('permission_templates').select('id, name, permissions').eq('id', id).single()

  if (!data) notFound()

  const t = data as { id: string; name: string; permissions: string[] }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Edit Template</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.name}</p>
      </div>
      <TemplateForm templateId={t.id} initialName={t.name} initialPermissions={t.permissions as any} />
    </div>
  )
}
