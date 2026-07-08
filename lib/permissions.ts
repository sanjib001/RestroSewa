export const PERMISSIONS = {
  // Dashboard
  VIEW_DASHBOARD:   "view_dashboard",
  // Orders
  VIEW_ORDERS:      "view_orders",
  MANAGE_ORDERS:    "manage_orders",
  CREATE_ORDERS:    "create_orders",
  EDIT_ORDERS:      "edit_orders",
  CANCEL_ORDERS:    "cancel_orders",
  CLOSE_BILLS:      "close_bills",
  // Menu
  VIEW_MENU:        "view_menu",
  MANAGE_MENU:      "manage_menu",
  // Tables
  VIEW_TABLES:      "view_tables",
  MANAGE_TABLES:    "manage_tables",
  // Rooms
  VIEW_ROOMS:       "view_rooms",
  MANAGE_ROOMS:     "manage_rooms",
  // Billing
  PROCESS_PAYMENTS: "process_payments",
  APPLY_DISCOUNTS:  "apply_discounts",
  REFUND_BILLS:     "refund_bills",
  // Customers
  VIEW_CUSTOMERS:   "view_customers",
  MANAGE_CUSTOMERS: "manage_customers",
  // Reports
  VIEW_REPORTS:     "view_reports",
  // Staff
  VIEW_STAFF:       "view_staff",
  CREATE_STAFF:     "create_staff",
  EDIT_STAFF:       "edit_staff",
  DELETE_STAFF:     "delete_staff",
  // Settings
  VIEW_SETTINGS:    "view_settings",
  MANAGE_SETTINGS:  "manage_settings",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export type PermissionGroupDef = {
  label: string;
  items: { key: Permission; label: string }[];
};

export const PERMISSION_GROUPS: PermissionGroupDef[] = [
  {
    label: "Dashboard",
    items: [{ key: "view_dashboard", label: "View Dashboard" }],
  },
  {
    label: "Orders",
    items: [
      { key: "view_orders",    label: "View Orders" },
      { key: "manage_orders",  label: "Manage Orders" },
      { key: "create_orders",  label: "Create Orders" },
      { key: "edit_orders",    label: "Edit Orders" },
      { key: "cancel_orders",  label: "Cancel Orders" },
      { key: "close_bills",    label: "Close Bills" },
    ],
  },
  {
    label: "Menu",
    items: [
      { key: "view_menu",   label: "View Menu" },
      { key: "manage_menu", label: "Manage Menu" },
    ],
  },
  {
    label: "Tables",
    items: [
      { key: "view_tables",   label: "View Tables" },
      { key: "manage_tables", label: "Manage Tables" },
    ],
  },
  {
    label: "Rooms",
    items: [
      { key: "view_rooms",   label: "View Rooms" },
      { key: "manage_rooms", label: "Manage Rooms" },
    ],
  },
  {
    label: "Billing",
    items: [
      { key: "process_payments", label: "Process Payments" },
      { key: "apply_discounts",  label: "Apply Discounts" },
      { key: "refund_bills",     label: "Refund Bills" },
    ],
  },
  {
    label: "Customers",
    items: [
      { key: "view_customers",   label: "View Customers" },
      { key: "manage_customers", label: "Manage Customers" },
    ],
  },
  {
    label: "Reports",
    items: [{ key: "view_reports", label: "View Reports" }],
  },
  {
    label: "Staff",
    items: [
      { key: "view_staff",   label: "View Staff" },
      { key: "create_staff", label: "Create Staff" },
      { key: "edit_staff",   label: "Edit Staff" },
      { key: "delete_staff", label: "Delete Staff" },
    ],
  },
  {
    label: "Settings",
    items: [
      { key: "view_settings",   label: "View Settings" },
      { key: "manage_settings", label: "Manage Restaurant Settings" },
    ],
  },
];

// restaurant_admin role always bypasses permission checks.
// Only restaurant_employee role is subject to per-permission enforcement.
export function hasPermission(
  user: { role: string; permissions: string[] },
  permission: Permission
): boolean {
  if (user.role === "restaurant_admin") return true;
  return user.permissions.includes(permission);
}

// True when the admin, or when the user holds ANY of the given permissions.
export function hasAnyPermission(
  user: { role: string; permissions: string[] },
  permissions: Permission[]
): boolean {
  if (user.role === "restaurant_admin") return true;
  return permissions.some((p) => user.permissions.includes(p));
}

// ─── Staff Navigation (single source of truth) ────────────────────────────────
// The employee sidebar/nav is derived entirely from permissions so the visible
// items always match what the backend route guards allow. Each entry declares
// the permission(s) that unlock it; the layout renders only the allowed items
// and each page re-checks the same permission server-side.

const P_ = PERMISSIONS;

export type StaffNavKey = "tables" | "orders" | "menu" | "sales" | "notifications";

export type StaffNavItem = {
  key: StaffNavKey;
  label: string;
  href: string;
  exact: boolean;
  /** Any of these permissions grants access. */
  anyOf: Permission[];
};

export const STAFF_NAV: StaffNavItem[] = [
  {
    key: "tables",
    label: "Tables",
    href: "/employee/dashboard",
    exact: true,
    anyOf: [P_.VIEW_DASHBOARD, P_.VIEW_TABLES, P_.VIEW_ROOMS],
  },
  {
    key: "orders",
    label: "Orders",
    href: "/employee/queue",
    exact: false,
    anyOf: [P_.VIEW_ORDERS, P_.MANAGE_ORDERS, P_.CREATE_ORDERS, P_.EDIT_ORDERS],
  },
  {
    key: "menu",
    label: "Menu",
    href: "/employee/menu",
    exact: false,
    anyOf: [P_.MANAGE_MENU],
  },
  {
    key: "sales",
    label: "Sales",
    href: "/employee/sales",
    exact: false,
    anyOf: [P_.PROCESS_PAYMENTS, P_.CLOSE_BILLS, P_.VIEW_REPORTS],
  },
  {
    key: "notifications",
    label: "Notifications",
    href: "/employee/notifications",
    exact: false,
    anyOf: [P_.VIEW_DASHBOARD, P_.VIEW_ORDERS, P_.MANAGE_ORDERS, P_.VIEW_TABLES, P_.CREATE_ORDERS, P_.EDIT_ORDERS],
  },
];

// Returns the nav items a given staff user is permitted to see.
export function getStaffNav(user: { role: string; permissions: string[] }): StaffNavItem[] {
  return STAFF_NAV.filter((item) => hasAnyPermission(user, item.anyOf));
}

// Convenience booleans used by page guards so nav ↔ route protection stay in sync.
export const NAV_ACCESS = {
  canSeeOrders: (u: { role: string; permissions: string[] }) =>
    hasAnyPermission(u, [P_.VIEW_ORDERS, P_.MANAGE_ORDERS, P_.CREATE_ORDERS, P_.EDIT_ORDERS]),
  canManageOrders: (u: { role: string; permissions: string[] }) =>
    hasAnyPermission(u, [P_.MANAGE_ORDERS, P_.EDIT_ORDERS]),
  canSeeSales: (u: { role: string; permissions: string[] }) =>
    hasAnyPermission(u, [P_.PROCESS_PAYMENTS, P_.CLOSE_BILLS, P_.VIEW_REPORTS]),
};

// ─── Staff Presets ────────────────────────────────────────────────────────────
// Job-type templates that pre-fill the permission checkboxes with a sensible
// set for common restaurant/hotel roles. Presets are a convenience only —
// after applying one, the admin can still tick/untick any individual
// permission. The chosen preset is NOT stored; only the resulting permission
// list is persisted on the staff record.

export type StaffPresetDef = {
  key: string;
  label: string;
  description: string;
  permissions: Permission[];
};

const P = PERMISSIONS;

export const STAFF_PRESETS: StaffPresetDef[] = [
  {
    key: "waiter",
    label: "Waiter",
    description: "Takes and serves orders. View-only on menu, tables and rooms.",
    permissions: [
      P.VIEW_DASHBOARD,
      P.VIEW_ORDERS,
      P.MANAGE_ORDERS,
      P.CREATE_ORDERS,
      P.EDIT_ORDERS,
      P.VIEW_MENU,
      P.VIEW_TABLES,
      P.VIEW_ROOMS,
    ],
  },
  {
    key: "cashier",
    label: "Cashier",
    description: "Handles billing and payments. Can create orders and close bills.",
    permissions: [
      P.VIEW_DASHBOARD,
      P.VIEW_ORDERS,
      P.CREATE_ORDERS,
      P.VIEW_MENU,
      P.VIEW_TABLES,
      P.CLOSE_BILLS,
      P.PROCESS_PAYMENTS,
      P.APPLY_DISCOUNTS,
    ],
  },
  {
    key: "chef",
    label: "Chef / Kitchen",
    description: "Works the kitchen queue. Sees orders and toggles menu availability.",
    permissions: [
      P.VIEW_DASHBOARD,
      P.VIEW_ORDERS,
      P.MANAGE_ORDERS,
      P.VIEW_MENU,
      P.MANAGE_MENU,
    ],
  },
  {
    key: "manager",
    label: "Manager",
    description: "Broad operational access across orders, billing, menu, tables and reports.",
    permissions: [
      P.VIEW_DASHBOARD,
      P.VIEW_ORDERS,
      P.MANAGE_ORDERS,
      P.CREATE_ORDERS,
      P.EDIT_ORDERS,
      P.CANCEL_ORDERS,
      P.CLOSE_BILLS,
      P.VIEW_MENU,
      P.MANAGE_MENU,
      P.VIEW_TABLES,
      P.MANAGE_TABLES,
      P.VIEW_ROOMS,
      P.MANAGE_ROOMS,
      P.PROCESS_PAYMENTS,
      P.APPLY_DISCOUNTS,
      P.REFUND_BILLS,
      P.VIEW_CUSTOMERS,
      P.MANAGE_CUSTOMERS,
      P.VIEW_REPORTS,
      P.VIEW_STAFF,
      P.VIEW_SETTINGS,
      P.MANAGE_SETTINGS,
    ],
  },
  {
    key: "host",
    label: "Host / Guest",
    description: "View-only access to the dashboard, tables and menu.",
    permissions: [
      P.VIEW_DASHBOARD,
      P.VIEW_TABLES,
      P.VIEW_MENU,
    ],
  },
];

// Returns the preset key whose permission set exactly matches the given
// selection, or null when the selection doesn't match any preset (i.e. the
// admin has customised it manually).
export function matchPreset(permissions: string[]): string | null {
  const selected = new Set(permissions);
  for (const preset of STAFF_PRESETS) {
    if (
      preset.permissions.length === selected.size &&
      preset.permissions.every((p) => selected.has(p))
    ) {
      return preset.key;
    }
  }
  return null;
}
