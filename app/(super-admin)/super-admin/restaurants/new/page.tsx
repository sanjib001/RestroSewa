import { RestaurantForm } from './restaurant-form'

export default function NewRestaurantPage() {
  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Add Restaurant</h1>
        <p className="mt-1 text-sm text-muted-foreground">Onboard a new restaurant to the platform.</p>
      </div>
      <RestaurantForm />
    </div>
  )
}
