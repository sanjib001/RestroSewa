export type ActionResult<T = void> =
  | { success: true; data: T }
  | {
      success: false
      error: string
      code?: string
      fieldErrors?: Record<string, string[]>
    }

export type UserRole = 'super_admin' | 'restaurant_admin' | 'restaurant_employee'

export interface AuthUser {
  id: string
  restaurantUserId?: string
  role: UserRole
  restaurantId?: string
  permissions: string[]
}

export type Permission =
  | 'ACTIVATE_SESSION'
  | 'CLOSE_SESSION'
  | 'ACCEPT_ORDER'
  | 'REJECT_ORDER'
  | 'PROCESS_PAYMENT'
  | 'APPLY_DISCOUNT'
  | 'MANAGE_MENU'
  | 'MANAGE_TABLES'
  | 'VIEW_REPORTS'
  | 'VIEW_KDS'
