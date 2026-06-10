import { TemplateForm } from '../template-form'

export default function NewTemplatePage() {
  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">New Permission Template</h1>
        <p className="mt-1 text-sm text-muted-foreground">Define a reusable set of permissions for restaurant employees.</p>
      </div>
      <TemplateForm />
    </div>
  )
}
