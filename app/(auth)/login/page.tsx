import RestaurantPortalForm from './restaurant-portal-form'

export default function RestaurantPortalPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-border bg-card p-8">
        <div className="space-y-1 text-center">
          <h1 className="font-heading text-2xl font-semibold text-foreground">RestroSewa</h1>
          <p className="text-sm text-muted-foreground">Staff Portal</p>
        </div>
        <RestaurantPortalForm />
      </div>
    </main>
  )
}
