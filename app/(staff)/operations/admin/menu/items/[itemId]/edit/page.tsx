import { notFound, redirect } from 'next/navigation'
import { getAuthUser, hasPermission } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { EditItemForm } from './edit-item-form'
import { VariantsEditor } from './variants-editor'
import { AddonsEditor } from './addons-editor'

export default async function EditItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params
  const user = await getAuthUser()
  if (!user || !hasPermission(user, 'MANAGE_MENU')) redirect('/operations')

  const service = createServiceClient()
  const [itemRes, catRes, varRes, addonRes] = await Promise.all([
    service
      .from('menu_items')
      .select('id, name, description, base_price, category_id, is_veg, is_special, sort_order, status')
      .eq('id', itemId)
      .eq('restaurant_id', user.restaurantId!)
      .single(),
    service
      .from('menu_categories')
      .select('id, name')
      .eq('restaurant_id', user.restaurantId!)
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
    service
      .from('variants')
      .select('id, name, additional_price, is_active, sort_order')
      .eq('menu_item_id', itemId)
      .eq('restaurant_id', user.restaurantId!)
      .order('sort_order', { ascending: true }),
    service
      .from('addons')
      .select('id, name, additional_price, is_active')
      .eq('menu_item_id', itemId)
      .eq('restaurant_id', user.restaurantId!),
  ])

  if (!itemRes.data) notFound()

  const item = itemRes.data as {
    id: string; name: string; description: string | null; base_price: number
    category_id: string | null; is_veg: boolean; is_special: boolean; sort_order: number; status: string
  }
  const categories = (catRes.data ?? []) as { id: string; name: string }[]
  const variants = (varRes.data ?? []) as { id: string; name: string; additional_price: number; is_active: boolean; sort_order: number }[]
  const addons = (addonRes.data ?? []) as { id: string; name: string; additional_price: number; is_active: boolean }[]

  return (
    <div className="max-w-2xl space-y-8">
      <h1 className="font-heading text-2xl font-semibold text-foreground">Edit Item</h1>

      <EditItemForm item={item} categories={categories} />

      <div className="border-t border-border" />

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Variants</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Different versions of the item (e.g. Small / Medium / Large). Each variant has an additional price on top of the base price.
          </p>
        </div>
        <VariantsEditor menuItemId={itemId} variants={variants} />
      </section>

      <div className="border-t border-border" />

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Add-ons</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Optional extras customers can add (e.g. Extra Cheese, Extra Sauce).
          </p>
        </div>
        <AddonsEditor menuItemId={itemId} addons={addons} />
      </section>
    </div>
  )
}
