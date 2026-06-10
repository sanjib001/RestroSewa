import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAuthUser, hasPermission } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { ItemStatusToggle } from './item-status-toggle'
import { DeleteItemButton } from './delete-item-button'
import { DeleteCategoryButton } from './delete-category-button'

type Category = { id: string; name: string; sort_order: number; is_active: boolean }
type MenuItem = {
  id: string; name: string; description: string | null; base_price: number
  status: string; is_veg: boolean; is_special: boolean; category_id: string | null
}

const STATUS_LABEL: Record<string, string> = {
  available: 'Available',
  out_of_stock: 'Out of Stock',
  hidden: 'Hidden',
}
const STATUS_COLOR: Record<string, string> = {
  available: 'text-green-400',
  out_of_stock: 'text-yellow-400',
  hidden: 'text-muted-foreground',
}

export default async function MenuPage() {
  const user = await getAuthUser()
  if (!user || !hasPermission(user, 'MANAGE_MENU')) redirect('/operations')

  const service = createServiceClient()
  const [catRes, itemRes] = await Promise.all([
    service
      .from('menu_categories')
      .select('id, name, sort_order, is_active')
      .eq('restaurant_id', user.restaurantId!)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    service
      .from('menu_items')
      .select('id, name, description, base_price, status, is_veg, is_special, category_id')
      .eq('restaurant_id', user.restaurantId!)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
  ])

  const categories = (catRes.data ?? []) as Category[]
  const items = (itemRes.data ?? []) as MenuItem[]

  const byCategory = new Map<string | null, MenuItem[]>()
  byCategory.set(null, [])
  for (const c of categories) byCategory.set(c.id, [])
  for (const item of items) byCategory.get(item.category_id ?? null)?.push(item)

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">Menu</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {categories.length} categor{categories.length !== 1 ? 'ies' : 'y'} · {items.length} item{items.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/operations/admin/menu/categories/new" className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:border-primary/50">
            + Category
          </Link>
          <Link href="/operations/admin/menu/items/new" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
            + Item
          </Link>
        </div>
      </div>

      <div className="space-y-8">
        {categories.map((cat) => {
          const catItems = byCategory.get(cat.id) ?? []
          return (
            <section key={cat.id}>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-foreground">{cat.name}</h2>
                  {!cat.is_active && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">Inactive</span>
                  )}
                  <span className="text-xs text-muted-foreground">({catItems.length})</span>
                </div>
                <div className="flex items-center gap-3">
                  <Link href={`/operations/admin/menu/items/new?categoryId=${cat.id}`} className="text-xs text-primary hover:underline">
                    + Add Item
                  </Link>
                  <Link href={`/operations/admin/menu/categories/${cat.id}/edit`} className="text-xs text-muted-foreground hover:text-foreground">
                    Edit
                  </Link>
                  <DeleteCategoryButton categoryId={cat.id} categoryName={cat.name} />
                </div>
              </div>

              {catItems.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border py-4 text-center text-xs text-muted-foreground">
                  No items in this category.
                </p>
              ) : (
                <div className="rounded-lg border border-border divide-y divide-border">
                  {catItems.map((item) => (
                    <ItemRow key={item.id} item={item} />
                  ))}
                </div>
              )}
            </section>
          )
        })}

        {/* Uncategorised items */}
        {(byCategory.get(null)?.length ?? 0) > 0 && (
          <section>
            <h2 className="mb-3 text-base font-semibold text-muted-foreground">Uncategorised ({byCategory.get(null)!.length})</h2>
            <div className="rounded-lg border border-border divide-y divide-border">
              {byCategory.get(null)!.map((item) => (
                <ItemRow key={item.id} item={item} />
              ))}
            </div>
          </section>
        )}

        {items.length === 0 && categories.length === 0 && (
          <div className="rounded-lg border border-dashed border-border py-20 text-center">
            <p className="text-sm text-muted-foreground">No menu items yet.</p>
            <Link href="/operations/admin/menu/categories/new" className="mt-2 inline-block text-sm text-primary hover:underline">
              Start by creating a category
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

function fmt(paise: number) {
  return `₹${(paise / 100).toFixed(2)}`
}

function ItemRow({ item }: { item: MenuItem }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 hover:bg-muted/20">
      {/* Veg indicator */}
      <span
        className={`h-3 w-3 shrink-0 rounded-sm border-2 ${item.is_veg ? 'border-green-500 bg-green-500/20' : 'border-red-500 bg-red-500/20'}`}
        title={item.is_veg ? 'Veg' : 'Non-veg'}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">{item.name}</span>
          {item.is_special && (
            <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-400">Special</span>
          )}
        </div>
        {item.description && (
          <p className="mt-0.5 text-xs text-muted-foreground truncate">{item.description}</p>
        )}
      </div>

      <span className="shrink-0 font-mono text-sm text-foreground">{fmt(item.base_price)}</span>

      <span className={`shrink-0 text-xs font-medium ${STATUS_COLOR[item.status] ?? 'text-muted-foreground'}`}>
        {STATUS_LABEL[item.status] ?? item.status}
      </span>

      <ItemStatusToggle itemId={item.id} currentStatus={item.status as 'available' | 'out_of_stock' | 'hidden'} />

      <Link href={`/operations/admin/menu/items/${item.id}/edit`} className="shrink-0 text-xs text-muted-foreground hover:text-foreground">
        Edit
      </Link>

      <DeleteItemButton itemId={item.id} itemName={item.name} />
    </div>
  )
}
