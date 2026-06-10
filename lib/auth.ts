import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { AuthUser, UserRole, Permission } from '@/types/app'

function decodeJWT(token: string): Record<string, unknown> {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return {}
  }
}

export async function getAuthUser(): Promise<AuthUser | null> {
  const supabase = await createSupabaseServerClient()

  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null

  // Super admin is identified via app_metadata — no JWT hook required
  if (user.app_metadata?.role === 'super_admin') {
    return {
      id: user.id,
      restaurantUserId: undefined,
      role: 'super_admin',
      restaurantId: undefined,
      permissions: [],
    }
  }

  // Restaurant staff: role and claims come from JWT (requires custom_access_token_hook)
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null

  const payload = decodeJWT(session.access_token)
  const role = (payload.role ?? 'restaurant_employee') as UserRole
  const restaurantId = payload.restaurant_id as string | undefined
  const restaurantUserId = payload.restaurant_user_id as string | undefined
  const permissions = (payload.permissions as string[]) ?? []

  return { id: user.id, restaurantUserId, role, restaurantId, permissions }
}

export async function requireAuth(redirectTo = '/login'): Promise<AuthUser> {
  const user = await getAuthUser()
  if (!user) redirect(redirectTo)
  return user
}

export function hasPermission(user: AuthUser, permission: Permission): boolean {
  if (user.role === 'super_admin' || user.role === 'restaurant_admin') return true
  return user.permissions.includes(permission)
}

export function requirePermission(user: AuthUser, permission: Permission): void {
  if (!hasPermission(user, permission)) redirect('/unauthorized')
}
