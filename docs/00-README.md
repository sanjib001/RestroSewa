# RestroSewa

A table-centric restaurant management SaaS built for small and medium dine-in restaurants.

RestroSewa digitizes restaurant operations from table activation to payment while keeping restaurant employees in full operational control.

The platform is intentionally designed for **5–15 managed restaurants**, prioritizing simplicity, maintainability, and operational accuracy over enterprise-scale complexity.

---

# Project Goal

RestroSewa is designed to:

- Reduce waiter workload
- Minimize ordering mistakes
- Improve restaurant operational visibility
- Speed up table service
- Simplify payment handling
- Provide customers with a modern QR-based ordering experience

This is **not**:

- A food delivery platform
- A reservation system
- A cloud kitchen platform
- A customer loyalty system

The product focuses exclusively on **dine-in restaurant operations**.

---

# Documentation

The entire system is defined by three canonical documents.

## 01-PRODUCT.md

Defines the business.

Contains:

- Product vision
- Product objectives
- Core concepts
- Product principles
- Business rules
- Locked product decisions
- Capabilities

This document defines **what the system must do**.

---

## 02-ARCHITECTURE.md

Defines how the system is organized.

Contains:

- System architecture
- Business modules
- Application surfaces
- Authentication model
- Multi-tenancy
- Realtime architecture
- Technology stack

This document defines **how the system is structured**.

---

## 03-DATABASE.md

Defines the business data model.

Contains:

- Database philosophy
- Core entities
- Entity relationships
- Financial model
- Session model
- Data lifecycle
- Storage strategy
- Database rules

This document defines **what data exists and how it relates**.

---

# Technology Stack

| Layer | Technology |
|--------|------------|
| Frontend | Next.js (App Router + TypeScript) |
| Styling | Tailwind CSS |
| Backend | Supabase |
| Database | PostgreSQL |
| Authentication | Supabase Auth |
| Realtime | Supabase Realtime |
| Storage | Supabase Storage |
| Server Functions | Supabase Edge Functions + Next.js Server Actions |
| Deployment | Vercel |

---

# Core Engineering Principles

- Database is the single source of truth.
- Sessions own restaurant operations.
- Tables own Sessions.
- Every customer submission creates a new Order.
- Authorization is permission-driven.
- Financial data is immutable.
- Realtime improves responsiveness but never replaces persistent state.
- Simplicity is preferred over unnecessary abstraction.

---

# Scale

RestroSewa is intentionally optimized for approximately **5–15 restaurants**.

Engineering decisions should prioritize:

- Simplicity
- Readability
- Reliability
- Operational correctness

Do not introduce enterprise patterns unless they solve a real business problem.

---

# AI Implementation Instructions

Before implementing any feature:

1. Read **01-PRODUCT.md** completely.
2. Read **02-ARCHITECTURE.md** completely.
3. Read **03-DATABASE.md** completely.
4. Do not make assumptions about business behavior.
5. If any requirement is unclear or conflicting, ask for clarification before writing code.
6. Preserve all business rules defined in the documentation.
7. Prefer simple, maintainable solutions over unnecessary complexity.
8. Never change business rules during implementation.

The documentation is the source of truth.

If implementation conflicts with documentation, ask for more clarification instead of assumption