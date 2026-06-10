# 02-ARCHITECTURE.md

# RestroSewa Architecture

**Version:** 1.0

**Status:** Architecture Locked Before Engineering

---

# 1. Architecture Overview

RestroSewa is a multi-tenant Software-as-a-Service (SaaS) platform designed for dine-in restaurants.

The system follows a **single application, multi-tenant architecture** where multiple restaurants operate independently while sharing the same application and infrastructure.

Every restaurant has isolated operational data, while the platform is centrally managed by the Super Admin.

The architecture is designed around **business capabilities** rather than user interfaces.

---

# 2. Architectural Principles

The architecture follows these principles.

## 2.1 Single Platform

Only one application exists.

There are not separate applications for customers, restaurant users, and platform administrators.

Every actor uses the same platform with different interfaces and permissions.

---

## 2.2 Multi-Tenant

Every Restaurant operates as an isolated tenant.

Restaurants never share:

* Tables
* Sessions
* Orders
* Payments
* Menus
* Employees
* Reports

Complete data isolation is mandatory.

---

## 2.3 Session-Centric

The Session is the primary operational entity.

Business data belongs to the Session.

Examples include:

* Orders
* Payments
* Notifications
* Activity Logs
* Discounts
* Additional Charges

---

## 2.4 Permission-Driven

The system never grants access based on display titles.

Business capabilities are controlled exclusively through permissions.

Display titles such as:

* Waiter
* Counter
* Cashier
* Captain

exist only for identification.

---

## 2.5 Realtime First

Restaurant operations require immediate visibility.

Operational events should be delivered in real time whenever possible.

Realtime enhances the experience but never becomes the source of truth.

The database always remains authoritative.

---

# 3. Business Modules

The platform is divided into independent business modules.

## Restaurant Module

Responsible for:

* Restaurant Information
* Operational Settings
* Table Management
* Table Groups

---

## Session Module

Responsible for:

* Session Activation
* Session Lifecycle
* Table Occupancy
* Session Closure

---

## Menu Module

Responsible for:

* Categories
* Menu Items
* Variants
* Add-ons
* Specials
* Availability

---

## Ordering Module

Responsible for:

* Cart
* Orders
* Order Items
* Notes
* Order Status
* Partial Serving

---

## Payment Module

Responsible for:

* Running Bill
* Discounts
* Additional Charges
* Payment Processing
* Outstanding Payments

---

## Notification Module

Responsible for:

* Help Requests
* Bill Requests
* New Orders
* New Customer Arrival
* Out-of-Stock Notifications
* Sound Notifications

---

## Reporting Module

Responsible for:

* Sales
* Orders
* Employee Performance
* Table Utilization
* Business Analytics

---

## Platform Module

Responsible for:

* Restaurants
* Subscriptions
* Permission Templates
* Platform Capabilities
* Platform Configuration

---

# 4. System Actors

The architecture recognizes four actor types.

## Super Admin

Platform management.

No involvement in restaurant operations.

---

## Restaurant Admin

Full access to both operational and administrative surfaces within their Restaurant.

Can perform all restaurant operations: Session activation, Order management, Payment processing, Discount application.

Can perform all restaurant administration: Menu management, Table management, Reports, Settings.

Cannot create users, modify Permission Templates, or access platform-level controls.

---

## Restaurant Employee

Operational users inside a Restaurant.

Capabilities are determined entirely by permissions.

Display titles never affect authorization.

---

## Customer

Anonymous guest.

When no active Session exists, customers may browse the Restaurant Menu but cannot place Orders.

When an active Session exists, customers interact with that Session to browse, order, track progress, request assistance, and request the bill.

Never accesses management features.

---

# 5. Application Surfaces

Although the platform is a single application, it provides four independent user experiences.

## Customer Surface

Optimized for mobile devices.

Accessed through QR codes.

Focused on ordering.

---

## Restaurant Operations Surface

Used by Restaurant Employees and Restaurant Admins.

Restaurant Admins have full access to both the Operations Surface and the Administration Surface. Restaurant Employees access only the Operations Surface, limited by their assigned Permission Template.

Supports:

* Session Management
* Orders
* Payments
* Notifications

---

## Restaurant Administration Surface

Used by Restaurant Admins.

Supports:

* Menu Management
* Table Management
* Reports
* Operational Settings

---

## Platform Administration Surface

Used only by the Super Admin.

Supports:

* Restaurant Onboarding
* User Provisioning
* Permission Assignment
* Subscription Management
* Platform Configuration

---

# 6. Realtime Architecture

Realtime communication is used for operational awareness.

Examples include:

* New Customer Arrival
* New Orders
* Help Requests
* Bill Requests
* Order Status Changes
* Payment Completion

Realtime notifications improve responsiveness but never replace persistent business data.

If realtime delivery fails, users always recover the latest state from the database.

The database is the single source of truth.

---

# 7. Authentication Architecture

The platform supports two authentication models.

## Authenticated Users

Includes:

* Super Admin
* Restaurant Admin
* Restaurant Employees

Authentication mechanisms differ by actor type.

### Super Admin

The Super Admin authenticates using email and password through Supabase Auth.

The Super Admin holds a platform-level role in the JWT and operates outside Restaurant scope.

### Restaurant Admin and Restaurant Employees

Restaurant Users authenticate using Employee ID and PIN.

This is a POS-style authentication model. No email address is required.

Employee IDs are unique within each Restaurant. The same Employee ID may exist in different Restaurants without conflict.

Authorization for all Restaurant Users is determined exclusively by their assigned Permission Template. Display Titles never affect authorization.

---

## Anonymous Users

Customers do not authenticate.

Customer access is limited to the active Session associated with a scanned Table.

When no active Session exists on a Table, customers may view the Restaurant Menu but cannot place Orders. The system automatically notifies eligible Restaurant Employees to activate the Session.

No customer account is required.

---

# 8. Multi-Tenant Architecture

Every Restaurant operates independently.

Tenant isolation applies to:

* Business Data
* Storage
* Realtime Events
* Permissions
* Reports

Restaurants cannot access each other's information under any circumstance.

---

# 9. Technology Stack

| Layer            | Technology                                       |
| ---------------- | ------------------------------------------------ |
| Frontend         | Next.js (App Router, TypeScript)                 |
| Styling          | Tailwind CSS                                     |
| Backend          | Supabase                                         |
| Database         | PostgreSQL                                       |
| Authentication   | Supabase Auth                                    |
| Realtime         | Supabase Realtime                                |
| Storage          | Supabase Storage                                 |
| Server Functions | Next.js Server Actions + Supabase Edge Functions |
| Deployment       | Vercel                                           |

---

# 10. Architectural Constraints

The following constraints are mandatory.

* One active Session per Table.
* One Platform serving multiple Restaurants.
* Anonymous customer access only.
* Permission-based authorization.
* Session-level billing.
* Every customer submission creates a new Order.
* Realtime enhances but never replaces persistent state.
* Financial calculations use integer currency values.
* Restaurant operations always take priority over software convenience.
