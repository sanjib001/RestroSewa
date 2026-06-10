import { redirect } from 'next/navigation'
import { getAuthUser } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { RestaurantInfoForm } from './restaurant-info-form'
import { OperationalSettingsForm } from './operational-settings-form'

export default async function SettingsPage() {
  const user = await getAuthUser()
  if (!user || user.role !== 'restaurant_admin') redirect('/operations')

  const service = createServiceClient()
  const [restaurantRes, settingsRes] = await Promise.all([
    service
      .from('restaurants')
      .select('name, phone, email, address, logo_url')
      .eq('id', user.restaurantId!)
      .single(),
    service
      .from('restaurant_settings')
      .select('cleaning_required, sound_notifications_enabled, default_service_charge_percent')
      .eq('restaurant_id', user.restaurantId!)
      .single(),
  ])

  const restaurant = (restaurantRes.data ?? {}) as {
    name: string; phone: string | null; email: string | null; address: string | null; logo_url: string | null
  }
  const settings = (settingsRes.data ?? {}) as {
    cleaning_required: boolean; sound_notifications_enabled: boolean; default_service_charge_percent: number
  }

  return (
    <div className="max-w-2xl space-y-10">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Restaurant configuration and operational preferences.</p>
      </div>

      <section className="space-y-4">
        <h2 className="text-base font-semibold text-foreground">Restaurant Info</h2>
        <RestaurantInfoForm restaurant={restaurant} />
      </section>

      <div className="border-t border-border" />

      <section className="space-y-4">
        <h2 className="text-base font-semibold text-foreground">Operational Settings</h2>
        <OperationalSettingsForm settings={settings} />
      </section>
    </div>
  )
}
