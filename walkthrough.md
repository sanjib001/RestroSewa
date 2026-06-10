# Chakra Project — "The Classy" Restaurant POS System

## Overview

This is a **restaurant Point-of-Sale (POS) and online ordering system** called **"The Classy"**. It is a frontend-only web application (no server-side code) that connects directly to **Supabase** (a hosted PostgreSQL + real-time backend). The system has two sides: a **customer-facing menu** and an **admin dashboard**.

> [!TIP]
> The production frontend is deployed at `https://the-classy.pages.dev/` (Cloudflare Pages).

---

## Project File Structure

| File | Role |
|---|---|
| [index.html](file:///e:/project/Chakra/index.html) | Customer-facing menu & ordering page |
| [menu (1).js](file:///e:/project/Chakra/menu%20(1).js) | All customer-side logic (menu fetch, cart, order submission) |
| [index-style.css](file:///e:/project/Chakra/index-style.css) | Styles for the customer menu page |
| [admin.html](file:///e:/project/Chakra/admin.html) | Admin login page |
| [dashboard.html](file:///e:/project/Chakra/dashboard.html) | Admin dashboard (orders + menu management) |
| [admin (1).js](file:///e:/project/Chakra/admin%20(1).js) | All admin-side logic (auth, orders, payments, menu CRUD) |
| [styles.css](file:///e:/project/Chakra/styles.css) | Styles for the admin dashboard |
| [table_selector.html](file:///e:/project/Chakra/table_selector.html) | Manual table selection page for admin-initiated orders |

---

## Technology Stack

- **Frontend**: Vanilla HTML + JavaScript
- **Styling**: TailwindCSS (CDN) for menu page, vanilla CSS for dashboard
- **Backend**: [Supabase](https://supabase.com/) (PostgreSQL + Realtime subscriptions + Auth)
- **Deployment**: Cloudflare Pages (`the-classy.pages.dev`)

---

## Complete Application Workflow

### 1. Customer Flow (Menu → Order → Real-time Updates)

```mermaid
flowchart TD
    A["Customer scans QR / opens URL<br/>e.g. ?table=A1"] --> B["index.html loads"]
    B --> C["Extract table ID from URL"]
    C --> D["Fetch menu from Supabase<br/>(menus table, is_available=true)"]
    D --> E["Render category filter + menu items"]
    E --> F["Check for existing open tab<br/>on this table"]
    F -->|Open tab exists| G["Display current bill + items<br/>(served vs pending)"]
    F -->|No open tab| H["Show 'Ready for new order'"]
    G --> I["Subscribe to real-time updates<br/>on this order"]
    H --> J["Customer browses menu,<br/>adds items to cart"]
    J --> K["Click 'Place New Order'<br/>or 'Add to Open Tab'"]
    K -->|New order| L["INSERT into orders table<br/>(status: pending)"]
    K -->|Existing tab| M["UPDATE order: append items,<br/>recalculate total,<br/>reset status to 'preparing'"]
    L --> N["Order appears on<br/>Admin Dashboard"]
    M --> N
    I --> O["Customer sees live updates:<br/>status changes, item modifications,<br/>kitchen messages"]
```

**Key Details:**
- The URL parameter `?table=A1` identifies which table the customer is at
- Prices are internally converted to **Paise (integer)** to avoid floating-point errors, then converted back to Rupees for display/storage
- When adding items to an existing tab, the order status resets to `preparing` to alert the kitchen
- Customers can **acknowledge admin messages** (e.g., "item removed due to unavailability")

---

### 2. Admin Flow (Login → Dashboard → Order & Menu Management)

```mermaid
flowchart TD
    A["Admin opens admin.html"] --> B["Login with email/password<br/>(Supabase Auth)"]
    B --> C{"Auth + Role Check<br/>(profiles table)"}
    C -->|Not admin| D["Access Denied"]
    C -->|Admin role| E["Redirect to dashboard.html"]
    E --> F["Fetch today's orders<br/>+ menu items"]
    F --> G["Subscribe to real-time<br/>order changes"]
    G --> H["Dashboard displays:<br/>• Orders table<br/>• Menu management<br/>• Daily sales summary"]
```

---

### 3. Order Lifecycle (Status State Machine)

```mermaid
stateDiagram-v2
    [*] --> pending: Customer places order
    pending --> preparing: Admin clicks "Order Received"
    preparing --> preparing: Customer adds more items
    preparing --> served: Admin clicks "Order Ready"
    served --> paid: Full payment received
    served --> partially_paid: Partial payment
    partially_paid --> paid: Remaining payment received
    pending --> cancelled: Admin cancels
    preparing --> cancelled: Admin cancels
    paid --> [*]
    cancelled --> [*]
```

**Admin Actions per Status:**

| Order Status | Available Actions |
|---|---|
| **Pending** | "Order Received" → preparing, "Modify Items / Cancel" |
| **Preparing** | "Order Ready" → served, "Modify Items / Cancel" |
| **Served** | "Mark Paid" (payment modal), "Reduce Items" |
| **Partially Paid** | "Finalize Payment", "Reduce Items" |
| **Paid / Cancelled** | No actions (terminal states) |

---

### 4. Payment Flow

```mermaid
flowchart TD
    A["Admin clicks 'Mark Paid'"] --> B["Payment Modal opens<br/>showing total due"]
    B --> C{"Payment Method?"}
    C -->|Cash Only| D["Full amount → cash_amount"]
    C -->|Online Only| E["Full amount → online_amount"]
    C -->|Mixed| F["Enter cash portion,<br/>online auto-calculated"]
    D --> G["Update order:<br/>status='paid'"]
    E --> G
    F --> H{"Cash + Online = Total?"}
    H -->|Yes| G
    H -->|No| I["Validation error"]
    G --> J{"Total paid ≥ Net bill?"}
    J -->|Yes| K["Status → paid"]
    J -->|Partial| L["Status → partially_paid<br/>due_amount updated"]
```

---

### 5. Menu Management (CRUD)

From the dashboard, admins can:
- **Add** new menu items (name, category, price, availability, "special" flag)
- **Edit** existing items via modal (update name, category, price, availability, special)
- **Delete** items permanently
- Categories are stored lowercase in the DB and displayed in Title Case

---

### 6. Manual Order Entry (Table Selector)

[table_selector.html](file:///e:/project/Chakra/table_selector.html) provides a grid of preset table buttons (A1–A4, B1–B6, C1–C4, D1–D6) plus a flexible text input for custom table IDs (e.g., "E1", "Counter", "Takeout"). Clicking a table opens the customer menu URL for that table, letting the admin place orders on behalf of walk-in customers.

---

### 7. Real-time Features

| Feature | Mechanism |
|---|---|
| Admin sees new orders instantly | Supabase Realtime channel on `orders` table (INSERT/UPDATE/DELETE) |
| Customer sees status changes | Supabase Realtime subscription filtered to their order ID |
| Browser notifications | `Notification` API — fires on new orders and item additions |
| Kitchen messages to customer | `customer_message` field on order — customer can acknowledge and dismiss |

---

### 8. Data Export

The admin can **export orders to CSV** with columns: ID, Table Number, Date, Time, Status, Net Total, Discount, Cash Paid, Online Paid, Due Amount, Items List, Admin Message — plus a **daily sales summary** appended at the bottom.

---

## Supabase Database Schema (Inferred)

### `orders` table
| Column | Type | Purpose |
|---|---|---|
| `id` | UUID | Primary key |
| `table_number` | text | Alphanumeric table ID (e.g., "A1") |
| `order_items` | JSONB | Array of `{item, qty, price, item_id}` |
| `total_amount` | numeric | Bill total in Rupees |
| `due_amount` | numeric | Remaining unpaid amount |
| `cash_amount` | numeric | Cash received |
| `online_amount` | numeric | Online/card received |
| `discount_amount` | numeric | Discount applied |
| `status` | text | pending / preparing / served / partially_paid / paid / cancelled |
| `served_item_count` | integer | How many items from the array have been served |
| `customer_message` | text | Admin-to-customer notification message |
| `created_at` | timestamp | Order creation time |
| `updated_at` | timestamp | Last modification time |

### `menus` table
| Column | Type | Purpose |
|---|---|---|
| `id` | UUID | Primary key |
| `item_name` | text | Menu item name (unique) |
| `category` | text | Category (stored lowercase) |
| `price` | numeric | Price in Rupees |
| `is_available` | boolean | Whether item shows on customer menu |
| `is_special` | boolean | "Today's Special" flag |

### `profiles` table
| Column | Type | Purpose |
|---|---|---|
| `id` | UUID | References Supabase auth user |
| `role` | text | User role (e.g., "admin") |
