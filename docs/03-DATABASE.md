# 03-DATABASE.md

# RestroSewa Database Design

**Version:** 1.0

**Status:** Locked Before Database Design

---

# 1. Purpose

This document defines the canonical business data model of RestroSewa.

It is intentionally database-agnostic and focuses on **what data exists**, **how entities relate**, and **the business rules governing them**.

It is **not** intended to define:

* SQL syntax
* PostgreSQL column types
* Indexes
* RLS policies
* Migration scripts

Those implementation details will be generated from this document.

---

# 2. Database Philosophy

The database is the single source of truth for the entire platform.

Realtime notifications, UI state, browser state, and local storage are temporary representations of database state.

Whenever conflicts occur, the database always wins.

The schema should prioritize:

* Simplicity
* Data consistency
* Operational accuracy
* Easy reporting
* Easy maintenance

The platform is expected to serve approximately **5–15 restaurants**, so the design should avoid unnecessary enterprise complexity.

---

# 3. Global Design Principles

The following rules apply to every entity.

---

## Restaurant Ownership

Every business entity belongs to exactly one Restaurant.

Examples include:

* Tables
* Sessions
* Orders
* Payments
* Menu
* Notifications
* Activity Logs

No restaurant may ever access another restaurant's data.

---

## Immutable Financial Data

Financial history must never change.

Once created:

* Orders
* Payments
* Discounts
* Additional Charges

must preserve their historical values.

Future menu price changes must never affect historical orders.

---

## Session-Centric Design

The Session is the primary business entity.

Everything related to one customer visit belongs to the Session.

Examples:

* Orders
* Running Total
* Discounts
* Payments
* Notifications
* Activity

Sessions are never shared across tables.

---

## Price Snapshot

Every Order Item stores its own price snapshot.

Historical Orders must remain accurate even if:

* Menu prices change
* Variants change
* Menu items are deleted

---

## Soft Delete vs Hard Delete

Operational data should rarely be deleted.

Where possible:

* deactivate
* archive
* mark inactive

instead of permanently deleting records.

Historical financial records should never be deleted.

---

## Integer Money

All monetary values are stored as integers.

Example:

```
Rs.100

↓

10000 paisa
```

Floating-point values must never be used for financial calculations.

---

# 4. Entity Overview

The system consists of the following business entities.

## Platform

* Restaurants
* Permission Templates
* Platform Capabilities

---

## Restaurant

* Restaurant
* Restaurant Users
* Tables
* Table Groups
* Restaurant Settings

---

## Menu

* Categories
* Menu Items
* Variants
* Add-ons

---

## Operations

* Sessions
* Orders
* Order Items

---

## Financial

* Payments
* Discounts
* Additional Charges

---

## Communication

* Notifications
* Help Requests
* Bill Requests

---

## Audit

* Activity Logs

---

## Storage

* Menu Images
* Restaurant Logo
* QR Codes

---

# 5. Core Entities

---

# Restaurant

## Purpose

Represents a restaurant using the RestroSewa platform.

Every operational record belongs to exactly one Restaurant.

---

## Relationships

Restaurant owns:

* Restaurant Users
* Tables
* Table Groups
* Menu
* Sessions
* Payments
* Notifications
* Reports
* Settings

---

## Important Information

Restaurant stores:

* Name
* Slug
* Contact Details
* Logo
* Subscription Status
* Enabled Capabilities

---

## Business Rules

Restaurants are completely isolated.

Restaurant deletion is not supported.

Restaurants are instead:

* Active
* Suspended
* Archived

---

# Restaurant User

## Purpose

Represents an authenticated user inside a Restaurant.

Includes:

* Restaurant Admin
* Restaurant Employees

The Super Admin exists outside Restaurant scope.

---

## Important Information

Restaurant User stores:

* Name
* Display Title
* Employee ID (unique within the Restaurant)
* PIN
* Assigned Permission Template
* Active Status

---

## Business Rules

Restaurant Users are created only by the Super Admin.

Restaurant Users belong to exactly one Restaurant.

Restaurant Users authenticate using Employee ID and PIN. No email address is required for Restaurant User authentication.

Employee IDs are unique within each Restaurant. The same Employee ID may exist in different Restaurants without conflict.

Display Titles never determine authorization.

Authorization comes entirely from assigned permissions.

---

# Permission Template

## Purpose

Represents a predefined collection of permissions.

Permission Templates are created and managed only by the Super Admin.

Restaurant Users receive one Permission Template.

---

## Business Rules

Restaurants cannot create or modify Permission Templates.

Templates may have display names such as:

* Waiter
* Counter
* Cashier
* Captain

These names are cosmetic only.

---

# Restaurant Table

## Purpose

Represents a physical table inside a Restaurant.

Every table contains one permanent QR Code.

---

## Relationships

A Table:

* belongs to one Restaurant
* optionally belongs to one Table Group
* has many Sessions over time
* has at most one active Session

---

## Important Information

Restaurant Table stores:

* Display Name
* QR Code
* Current Status
* Table Group
* Current Assigned Restaurant User (optional)

---

## Business Rules

Only one active Session may exist on a Table.

QR Codes are permanent.

Regenerating a QR immediately invalidates the previous one.

Table Status is always one of:

* Available
* Waiting Activation
* Occupied
* Cleaning

Cleaning is optional depending on Restaurant Settings.

---

# Table Group

## Purpose

Logical grouping of Restaurant Tables.

Examples:

* Ground Floor
* Rooftop
* VIP
* Section A

---

## Business Rules

Table Groups exist only for operational organization.

Billing is unaffected.

A Restaurant User may claim responsibility for one or more Table Groups.

---

# Session

## Purpose

Represents one customer group's visit.

The Session is the most important business entity in the system.

---

## Relationships

Session belongs to:

* one Restaurant
* one Table

Session owns:

* Orders
* Payments
* Discounts
* Additional Charges
* Notifications
* Activity Logs

---

## Important Information

Session stores:

* Status
* Running Total
* Start Time
* End Time
* Assigned Restaurant User
* Bill Status

---

## Business Rules

Only one active Session exists per Table.

Session begins only after activation by an authorized Restaurant User.

Session ends only after:

* Payment Complete
* Outstanding Payment
* Force Close

Customers never own Sessions.

Tables own Sessions.

---

# Session Order

## Purpose

Represents one customer submission.

Every submission creates a completely new Order.

Orders are never merged.

---

## Relationships

Order belongs to one Session.

Order owns multiple Order Items.

---

## Business Rules

Order lifecycle:

Pending

↓

Accepted

↓

Preparing

↓

Ready

↓

Served

↓

Completed with Session

Cancelled Orders exit the workflow immediately.

Rejected Orders never reach preparation.

Orders are immutable after submission.

Additional food always creates a new Order.

---

# Session Order Item

## Purpose

Represents one menu item inside an Order.

Serving is tracked at this level.

---

## Important Information

Order Item stores:

* Menu Snapshot
* Variant Snapshot
* Add-on Snapshot
* Unit Price Snapshot
* Quantity
* Notes
* Serving Status

---

## Business Rules

Price is frozen at the moment the Order is submitted. Prices are not frozen when items are added to the cart. If a menu price changes while a customer has items in their cart, the submitted Order reflects the latest published price at submission time.

Serving is tracked per item.

Historical data never changes after order creation.

---
---

# 6. Financial Entities

---

# Session Payment

## Purpose

Represents the financial settlement of a Session.

Payments always belong to the Session rather than individual Orders.

One Session may have multiple payment records when using Mixed Payment.

---

## Relationships

Payment belongs to:

* one Restaurant
* one Session

---

## Important Information

Payment stores:

* Payment Method
* Amount Paid
* Payment Time
* Processed By
* Payment Reference (if applicable)

---

## Supported Payment Methods

* Cash
* Online
* Mixed
* Outstanding

Mixed Payment represents a single bill settlement split across both cash and online payment. It is stored as multiple payment records under the same Session. Mixed Payment does not mean split billing between different customers. Bill splitting is not supported in V1.

---

## Business Rules

A Session is considered paid only when the full payable amount has been settled.

When an Outstanding Payment is recorded, the Session is closed and the Table is immediately released. A new Session may begin on that Table. The outstanding balance remains visible in reports until it is settled. Restaurant operations must never be blocked by an unpaid balance.

Payment records are immutable once created.

Refunds are handled by creating adjustment records rather than editing existing payments.

---

# Discount

## Purpose

Represents a discount applied to an entire Session.

---

## Relationships

Discount belongs to one Session.

---

## Important Information

Discount stores:

* Type
* Value
* Applied By
* Applied Time

---

## Business Rules

Supported types:

* Fixed Amount
* Percentage

Discounts are applied before payment.

Only one active Session-level discount is supported in V1.

Item-level discounts are out of scope.

---

# Additional Charge

## Purpose

Represents optional charges added to the Session.

---

## Examples

* Service Charge
* Packing Charge
* Custom Charge

---

## Business Rules

Additional Charges belong to the Session.

Multiple charges may exist.

Restaurants decide whether this feature is enabled.

---

# 7. Menu Entities

---

# Menu Category

## Purpose

Groups Menu Items into logical categories.

---

## Examples

* Starters
* Main Course
* Beverages
* Desserts

---

## Business Rules

Categories belong to one Restaurant.

Deleting a Category must not delete historical Orders.

---

# Menu Item

## Purpose

Represents a food or beverage available for ordering.

---

## Relationships

Menu Item belongs to one Category.

Menu Item may have:

* Variants
* Add-ons
* Image

---

## Important Information

Menu Item stores:

* Name
* Description
* Base Price
* Image
* Availability
* Special Status

---

## Business Rules

Menu Items may be:

* Available
* Out of Stock
* Hidden

Hidden items are not visible to customers.

Out-of-stock items remain visible but cannot be ordered.

Deleting a Menu Item must never affect historical Orders.

---

# Variant

## Purpose

Represents different versions of the same Menu Item.

---

## Examples

Coffee

* Small
* Medium
* Large

Pizza

* Regular
* Large

---

## Business Rules

Each Variant may have:

* Name
* Additional Price

Variants inherit the parent Menu Item unless overridden.

Historical Orders store Variant snapshots.

---

# Add-on

## Purpose

Represents optional additions to a Menu Item.

---

## Examples

* Extra Cheese
* Extra Sauce
* Coke Upgrade

---

## Business Rules

Each Add-on may have:

* Name
* Additional Price

Multiple Add-ons may be selected unless restricted by business rules.

Historical Orders preserve Add-on snapshots.

---

# 8. Communication Entities

---

# Notification

## Purpose

Represents a realtime event requiring user attention.

---

## Examples

* New Customer Arrival
* New Order
* Help Request
* Bill Request
* Out of Stock
* Payment Completed
* Outstanding Payment

---

## Relationships

Notification belongs to one Restaurant.

Notification may optionally reference:

* Session
* Order
* Table
* Restaurant User

---

## Business Rules

Notifications are stored in the database.

Realtime delivery is an enhancement.

Failure to deliver realtime notifications must never lose the notification.

Notification lifecycle:

Created

↓

Unread

↓

Read

↓

Dismissed

---

# Help Request

## Purpose

Represents a customer asking for assistance.

---

## Relationships

Help Request belongs to one Session.

---

## Business Rules

Customers may create one active Help Request at a time.

All eligible Restaurant Users receive the notification.

The first Restaurant User to claim the request becomes responsible.

Once resolved, the request is closed.

---

# Bill Request

## Purpose

Represents a customer requesting the bill.

---

## Relationships

Bill Request belongs to one Session.

---

## Business Rules

Only one active Bill Request may exist per Session.

Requesting the bill temporarily locks customer ordering.

An authorized Restaurant User may reopen ordering if the customer wishes to continue.

---

# 9. Operational Entities

---

# Activity Log

## Purpose

Provides an immutable history of important business actions.

---

## Examples

* Session Activated
* Order Accepted
* Order Served
* Discount Applied
* Payment Completed
* Menu Updated
* User Login

---

## Relationships

Activity Log belongs to one Restaurant.

May reference:

* Session
* Order
* Payment
* Restaurant User

---

## Business Rules

Activity Logs are append-only.

Existing records are never modified.

Logs are retained for one year.

---

# Restaurant Settings

## Purpose

Stores configurable operational behaviour for a Restaurant.

---

## Examples

* Restaurant Logo
* Printer Settings
* Cleaning Required
* Default Service Charge
* Sound Notifications

---

## Business Rules

Settings control operational behaviour.

Settings cannot enable features that are disabled by the Restaurant's subscription capabilities.

---

# 10. Storage

Supabase Storage is used for static assets.

Supported assets include:

* Restaurant Logo
* Menu Images
* QR Codes

Future assets may include:

* Promotional Images
* Digital Receipts

Storage files belong to exactly one Restaurant.

Deleting a Restaurant asset must never invalidate historical Orders.

---

# 11. Entity Relationships

The overall business relationship is:

Restaurant

→ Restaurant Users

→ Restaurant Tables

→ Table Groups

→ Menu Categories

→ Menu Items

→ Variants

→ Add-ons

→ Sessions

→ Session Orders

→ Session Order Items

→ Session Payments

→ Notifications

→ Help Requests

→ Bill Requests

→ Activity Logs

---

# 12. Database Rules

The following rules apply to every entity.

## Multi-Tenant

Every entity belongs to exactly one Restaurant.

---

## Historical Integrity

Historical Orders and Payments must never change after creation.

---

## Realtime

Realtime reflects database changes.

Realtime is never the source of truth.

---

## Auditability

Important operational actions must generate Activity Logs.

---

## Data Ownership

Each entity has exactly one owner.

Relationships should never create circular dependencies.

---

## Simplicity

The schema should remain easy to understand.

Avoid unnecessary abstraction.

The database is expected to support approximately 5–15 Restaurants, so readability and maintainability are preferred over enterprise-scale optimization.

---

# 13. Notes for Implementation

This document intentionally avoids defining:

* SQL data types
* PostgreSQL constraints
* Indexes
* Row-Level Security policies
* Database migrations

These implementation details should be derived from this document while preserving all business rules defined here.

No implementation should introduce additional business entities without updating this document first.
---

# 14. Data Lifecycle

This section defines how data changes throughout its lifetime.

---

## Restaurant

Restaurant records are never physically deleted.

Supported states:

* Active
* Suspended
* Archived

Historical restaurant data must always remain available.

---

## Restaurant Users

Restaurant Users are never permanently deleted.

Instead they become:

* Active
* Disabled

Disabling a user immediately prevents future logins.

Historical activities remain associated with that user.

---

## Restaurant Tables

Restaurant Tables are rarely deleted.

If a table is removed:

* Previous Sessions remain intact.
* Historical Orders remain intact.
* Activity Logs remain intact.

The table simply becomes unavailable for future Sessions.

---

## Sessions

Sessions are immutable after completion.

Completed Sessions are never modified except through explicitly supported operational workflows.

Examples:

* Outstanding Payment Settlement
* Refund Adjustment

---

## Orders

Submitted Orders are never deleted.

Cancelled Orders remain part of the historical record.

Rejected Orders remain visible for reporting.

---

## Menu

Menu Items may become:

* Hidden
* Out of Stock

Historical Orders always preserve Menu snapshots.

Deleting Menu Items must never affect historical Orders.

---

## Notifications

Notifications automatically progress through their lifecycle.

Old notifications may be archived.

Archiving never removes Activity Log history.

---

# 15. Realtime Strategy

Realtime exists to improve operational awareness.

It is never the source of truth.

---

## Database First

Every business action follows this order:

Database Updated

↓

Transaction Completed

↓

Realtime Event Broadcast

↓

UI Refresh

If realtime delivery fails:

* Database remains correct.
* Clients synchronize during their next refresh or reconnection.

---

## Realtime Events

Examples include:

Restaurant

* Restaurant Suspended

Session

* Session Activated
* Session Closed

Orders

* New Order
* Order Accepted
* Order Ready
* Order Served

Payments

* Bill Requested
* Payment Completed
* Outstanding Recorded

Customer

* Help Requested
* Out of Stock Notification

Administration

* Menu Updated
* User Disabled

---

# 16. Concurrency Rules

The system must safely handle simultaneous actions.

---

## Session Activation

Only one Session may be created for a Table.

If two users attempt activation simultaneously:

Only one succeeds.

The second request fails safely.

---

## Order Submission

Each submission creates a completely new Order.

Orders are never merged.

Duplicate submissions should be prevented through idempotency.

---

## Payment

A Session cannot be paid twice.

Duplicate payment requests must be safely ignored.

Payment gateways must use idempotency keys.

---

## QR Scanning

Multiple customer devices may join the same active Session.

Each device maintains its own temporary Cart.

Submitted Orders become visible to every connected customer.

---

# 17. Data Integrity Rules

The following constraints must always remain true.

---

Exactly one active Session per Table.

---

Orders always belong to one Session.

---

Order Items always belong to one Order.

---

Payments always belong to one Session.

---

Notifications always belong to one Restaurant.

---

Activity Logs are append-only.

---

Historical prices never change.

---

Historical Menu snapshots never change.

---

Financial history is immutable.

---

# 18. Storage Strategy

Supabase Storage is used for static assets.

Current buckets:

Restaurant Assets

Contains:

* Restaurant Logo

Menu Images

Contains:

* Menu Item Images

QR Codes

Contains:

* Generated Table QR Codes

Future buckets may be added when required.

Storage files always belong to one Restaurant.

---

# 19. Naming Conventions

Entity names should clearly describe ownership.

Preferred naming:

Restaurant

Restaurant User

Restaurant Table

Table Group

Session

Session Order

Session Order Item

Session Payment

Menu Category

Menu Item

Variant

Add-on

Notification

Activity Log

Avoid ambiguous names such as:

* Staff
* User
* Order
* Payment

without context.

Naming should remain consistent across:

* Database
* Backend
* Frontend
* Documentation

---

# 20. Reporting Considerations

The schema should support reporting without requiring major restructuring.

Examples include:

Sales

* Daily Sales
* Weekly Sales
* Monthly Sales

Orders

* Total Orders
* Average Order Value
* Most Ordered Items

Restaurant

* Table Utilization
* Peak Hours
* Payment Methods

Employees

* Orders Handled
* Discounts Given
* Payments Processed

Historical reports must always use snapshot data.

Reports must never depend on current Menu configuration.

---

# 21. Future Expansion

The current schema is intentionally optimized for approximately 5–15 Restaurants.

The following features should be easy to add later without major redesign:

* Multiple Branches
* Loyalty Program
* Reservations
* Kitchen Staff Accounts
* Inventory Management
* Purchase Management
* Suppliers
* Multiple Languages
* Multiple Currencies
* Additional Payment Gateways
* Customer Accounts

Future features should extend the existing schema rather than replacing it.

---

# 22. Engineering Guidelines

The following rules should always be respected when implementing the database.

---

## Simplicity First

Choose the simplest schema that satisfies business requirements.

Avoid unnecessary abstraction.

---

## Business Before Technology

Database design must follow business rules.

Technology should never redefine business behaviour.

---

## Database is the Source of Truth

The database is authoritative.

Local Storage, browser memory, and realtime events are temporary representations only.

---

## Historical Accuracy

Never modify historical financial records.

Always create adjustment records when corrections are required.

---

## Permission Driven

Authorization is always determined by assigned permissions.

Never check display titles such as:

* Waiter
* Counter
* Cashier
* Captain

Display titles are cosmetic only.

---

## Session Ownership

Sessions own operational data.

Customers never own Orders.

Tables own Sessions.

Sessions own Orders.

Orders own Order Items.

Payments belong to Sessions.

---

## AI Implementation Rules

When generating the database schema:

* Do not introduce additional business entities unless required.
* Do not normalize the schema beyond what is necessary for this project.
* Prefer readability over excessive optimization.
* Avoid premature micro-optimizations.
* Assume a deployment of approximately 5–15 Restaurants.
* Keep migrations simple and reversible.
* Preserve all business rules defined in `01-PRODUCT-SPECIFICATION.md`.
* If implementation details are unclear, ask for clarification instead of making assumptions.

---

# End of Document

This document is the canonical database specification for RestroSewa.

All future schema design, migrations, Supabase implementation, backend logic, and reporting should be derived from this document while preserving the business rules defined in the Product Specification.
