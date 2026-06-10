# 01-PRODUCT-SPECIFICATION.md

# RestroSewa Product Specification

**Version:** 1.0

**Status:** Product Discovery Complete

**Last Updated:** June 2026

---

# 1. Product Overview

## 1.1 What is RestroSewa?

RestroSewa is a **table-centric restaurant operating system** designed for dine-in restaurants.

The platform digitizes the complete dining experience—from the moment customers sit at a table until their bill is paid—while keeping restaurant employees in full operational control.

Every table contains a unique QR code.

Customers scan the QR code to:

* View the restaurant menu
* Join the current table session
* Place food orders
* Track order progress
* Request assistance
* Request the bill

Restaurant employees use RestroSewa to manage:

* Tables
* Sessions
* Orders
* Payments
* Menus
* Daily restaurant operations

Restaurant administrators manage operational configuration, while the platform is centrally managed by the Super Admin.

RestroSewa is designed to reduce manual work without replacing traditional restaurant service.

---

## 1.2 Target Restaurants

RestroSewa is intended for restaurants that primarily serve customers at physical tables.

Examples include:

* Restaurants
* Cafés
* Family Restaurants
* Fast Casual Restaurants
* Food Courts with Table Service
* Bars
* Lounges
* Pubs
* Dessert Cafés

The platform assumes customers are physically seated before ordering.

Restaurants operating purely as delivery kitchens or takeaway-only businesses are outside the primary scope.

---

## 1.3 Primary Problems RestroSewa Solves

Traditional restaurant operations often suffer from:

* Waiters repeatedly walking to tables for simple requests
* Order miscommunication
* Handwritten kitchen tickets
* Lost or forgotten customer requests
* Long payment queues
* Customers waiting to get a waiter's attention
* Lack of operational visibility
* Manual coordination between dining area and counter

RestroSewa digitizes these repetitive operational tasks while preserving the human hospitality experience.

---

## 1.4 What RestroSewa is NOT

RestroSewa is **not**:

* A food delivery platform
* An online ordering marketplace
* A reservation management system
* A customer loyalty platform
* A CRM
* A hotel management system
* A cloud kitchen management system

The platform focuses exclusively on dine-in restaurant operations.

---

# 2. Product Vision & Objectives

## 2.1 Vision

To become a simple, reliable, and modern operating system for dine-in restaurants that reduces operational workload while preserving the hospitality experience.

Technology should assist restaurant employees—not replace them.

Customers should enjoy a faster and more transparent dining experience without needing to install an application or create an account.

---

## 2.2 Product Objectives

RestroSewa is designed around six primary objectives.

### Objective 1 — Reduce Operational Workload

Restaurant employees should spend less time performing repetitive tasks and more time serving customers.

Examples include:

* Taking orders
* Answering bill requests
* Responding to help requests
* Updating order status

---

### Objective 2 — Improve Operational Accuracy

Restaurant data should always remain correct.

The system must minimize:

* Order mistakes
* Duplicate orders
* Billing mistakes
* Payment errors
* Session conflicts

Operational accuracy is always more important than speed.

---

### Objective 3 — Improve Restaurant Visibility

Restaurant users should always know:

* Which tables are occupied
* Which tables need activation
* Which customers require assistance
* Which bills are pending
* Which orders are waiting
* Which menu items are unavailable

No important operational event should be hidden.

---

### Objective 4 — Improve Customer Experience

Customers should always be able to:

* View the menu
* Track orders
* View the running bill
* Request assistance
* Request the bill

Customers should never need to repeatedly search for a waiter.

---

### Objective 5 — Prevent Operational Abuse

The system should prevent situations such as:

* QR photo misuse
* Duplicate order submission
* Multiple active sessions on one table
* Double payment
* Conflicting order updates

Operational safeguards should not make normal restaurant operation difficult.

---

### Objective 6 — Keep the System Simple

RestroSewa is designed for small and medium-sized restaurants.

The platform prioritizes:

* Simplicity
* Maintainability
* Reliability
* Ease of deployment

Unnecessary enterprise complexity should be avoided unless it provides clear operational value.

---

# 3. Glossary & Terminology

This section defines the official vocabulary used throughout the project.

Every future document must use these terms consistently.

---

## Platform

The complete RestroSewa SaaS product.

The Platform contains multiple Restaurants and is managed by the Super Admin.

---

## Restaurant

An independent business operating on the RestroSewa Platform.

Each Restaurant owns its own operational data and is completely isolated from every other Restaurant.

---

## Super Admin

The Super Admin is the platform administrator responsible for onboarding, configuring, and managing every Restaurant on the RestroSewa platform.

The Super Admin is the only authority responsible for creating and managing user accounts and permission assignments.

Responsibilities include:

* Creating new Restaurants
* Configuring Restaurant subscriptions
* Enabling or disabling platform capabilities
* Creating and maintaining Permission Templates
* Managing platform-wide configuration
* Creating Restaurant Admin accounts
* Creating Restaurant Employee accounts
* Assigning Permission Templates to every Restaurant user
* Providing login credentials (Employee ID and PIN) to Restaurant Admins and Restaurant Employees
* Managing subscription limits and available features
* Suspending or reactivating Restaurants when necessary

The Super Admin never participates in the daily operation of a Restaurant.

Once a Restaurant is onboarded, operational activities such as managing tables, menus, sessions, orders, and payments are handled by the Restaurant Admin and authorized Restaurant Employees.

No Restaurant user can create another user or modify permission assignments.

All user provisioning and permission management is performed exclusively by the Super Admin.


## Restaurant Admin

A Restaurant Admin manages the daily operation of a specific Restaurant.

The Restaurant Admin can perform all operational and administrative actions within the Restaurant.

Operational responsibilities include:

* Activating Sessions
* Accepting and Rejecting Orders
* Processing Payments
* Applying Discounts
* Managing Tables and Table Groups
* Generating QR Codes

Administrative responsibilities include:

* Managing Menus
* Managing Restaurant Operational Settings
* Viewing Reports
* Monitoring Restaurant Activity

The Restaurant Admin cannot:

* Create user accounts
* Delete user accounts
* Assign or modify Permission Templates
* Create or modify Permissions
* Change Platform Capabilities
* Manage platform configuration
* Create other Restaurants

If additional Restaurant Employees are required, the Restaurant Admin requests the Super Admin to create the accounts and provide credentials.

---

## Restaurant Employee

A Restaurant Employee is an operational user working inside a Restaurant.

Examples of display titles include:

* Waiter
* Counter
* Cashier
* Captain
* Reception
* Floor Manager
* Bar Counter

These are **display titles only**.

Authorization is determined entirely by assigned permissions.

Business logic must never depend on display titles.

---

## Customer

A guest dining at the Restaurant.

Customers do not require accounts.

Customers join a Session by scanning the QR code attached to a physical Table.

When no active Session exists on a Table, customers may browse the Restaurant Menu but cannot place Orders. A notification is automatically sent to eligible Restaurant Employees requesting Table activation. Ordering becomes available only after a Restaurant Employee activates the Session.

Customers only interact with the currently active Session.

---

## Table

A physical seating location inside a Restaurant.

Each Table contains a permanent QR code and can have at most one active Session.

---

## Table Group

A logical grouping of Tables used for operational organization.

Table Groups simplify restaurant management but do not affect billing.

---

## Session

A Session represents one customer group's visit to a Table.

Session Activation Flow:

1. Customer scans the Table QR code.
2. No active Session exists — the customer can browse the menu but cannot place Orders.
3. A notification is automatically sent to eligible Restaurant Employees.
4. A Restaurant Employee with the Activate Session permission verifies the customer's arrival at the Table.
5. The Restaurant Employee activates the Session.
6. Ordering becomes available to the customer immediately.

Customers never request Session activation manually. Scanning the QR code is sufficient to trigger the notification.

A Session ends only after payment or an approved operational exception.

The Session is the primary business entity of RestroSewa.

---

## Order

A customer submission containing one or more menu items.

Each submission creates a new Order.

Orders belong to a Session.

---

## Order Item

A single menu item within an Order.

Serving progress is tracked per Order Item.

---

## Payment

The financial settlement of a Session.

Payments always belong to a Session rather than an individual Order.

---

## Permission

A specific capability granted to a Restaurant Employee.

Examples include:

* Accept Order
* Activate Session
* Process Payment
* Manage Menu

Permissions determine what a user is allowed to do.

---

## Permission Template

A predefined collection of Permissions created and assigned by the Super Admin.

Permission Templates are assigned to Restaurant Users by the Super Admin. Restaurants cannot create, modify, or reassign Permission Templates.

Template display names are cosmetic only and never affect the underlying permissions.

---

## Capability

A platform feature enabled or disabled for a Restaurant by the Super Admin.

Examples include:

* Passive KDS
* Online Payments
* Additional Charges
* Cleaning Workflow

Capabilities determine which features are available to a Restaurant.

In V1, all Capabilities are enabled for every Restaurant by default. The infrastructure for enabling and disabling Capabilities per Restaurant exists, but no subscription gating is applied in the initial release. Future releases may restrict Capabilities based on subscription level.

---

## Operational Setting

A Restaurant-specific configuration that controls how enabled capabilities behave.

Examples include:

* Cleaning required after payment
* Default service charge
* Restaurant logo
* Printer configuration

Operational Settings cannot enable capabilities that are not included in the Restaurant's subscription.

---

## Display Title

A human-readable job title assigned to a Restaurant Employee.

Examples:

* Waiter
* Counter
* Cashier
* Captain

Display Titles exist only for identification within the Restaurant.

They never determine authorization.

Display Titles are editable by the Super Admin. Changing a Display Title never affects the permissions granted by the assigned Permission Template.

Examples of editable Display Titles:

* "Waiter" → "Captain"
* "Counter" → "Billing Counter"
* "Reception" → "Front Desk"


# 4. Product Principles

These principles guide every architectural and engineering decision in RestroSewa.

## 4.1 Table-Centric

The table is the center of the system.

Customers do not own sessions.

Tables own sessions.

Every operational workflow begins from a physical table.

---

## 4.2 Session-Centric

A Session represents one customer group's visit.

Orders, payments, notifications, discounts, activity logs, and operational events belong to a Session.

---

## 4.3 Permission-Driven

Business actions are controlled exclusively through permissions.

Display titles never determine authorization.

---

## 4.4 Human Assisted, Not Human Replaced

The platform assists restaurant operations.

Critical operational decisions always remain under human control.

Examples include:

- Session activation
- Order acceptance
- Payment processing
- Outstanding payment handling

---

## 4.5 Operational Accuracy First

Restaurant operations and financial accuracy always take priority over convenience.

The system must never silently lose, duplicate, or corrupt business data.

---

## 4.6 One Source of Truth

Every business entity has one owner.

Examples:

Restaurant
→ Tables

Table
→ Session

Session
→ Orders

Order
→ Order Items

This ownership hierarchy must never be violated.

---

## 4.7 One Customer Visit = One Session

A Session represents one dining experience.

Multiple Orders may exist within one Session.

One settlement event closes the Session. That settlement may be recorded as a single payment or as multiple payment records in the case of Mixed Payment (cash + online). Outstanding Payment also closes the Session while leaving the financial record open for later resolution.

---

## 4.8 Simplicity Over Complexity

The platform is designed for small and medium restaurants.

Simple solutions should always be preferred unless complexity provides measurable operational value.

---

## 4.9 Operational Recovery

Restaurant operations must never become blocked because of software limitations.

Authorized users must always have a safe operational path for exceptional situations.

---

## 4.10 Platform Before Restaurant

Platform-level decisions belong to the Super Admin.

Restaurant-level operational decisions belong to the Restaurant Admin.

Operational actions belong to authorized Restaurant Employees.



