# Project — RestroSewa

> **How to use this Memory Bank** (read before working)
> 1. At the start of a session read, in order: `project.md` → `architecture.md` →
>    `decisions.md` → `current-task.md`. Read `database.md` only if the task touches data,
>    `roadmap.md` only when planning, `bugs.md` only when debugging.
>    For a specific feature, load its **`modules/<feature>.md`** — that file is the feature's
>    single source of truth. Load only what the task needs (typically 2–4 small files), not the
>    whole bank. Modules: admin, staff, customer, finance, stock, rooms, printing, notifications,
>    pwa, auth, permissions, realtime, qr, tables, walkins, settings, security-pin, custom-items,
>    mock-bill.
> 2. Use this bank before analysing code — it is the source of truth for project knowledge.
> 3. When a task finishes: **append/edit only the affected files** (never rewrite whole files).
>    Move the finished task from `current-task.md` → `completed.md`; log user-facing changes in
>    `changelog.md`; record any real architectural choice in `decisions.md`.
> 4. **Never duplicate** across files: architecture → `architecture.md`, rules/why →
>    `decisions.md`, tables → `database.md`, active work → `current-task.md`.
> 5. Keep files under their caps (project <300, architecture <400, database <600, rest <250).
> 6. Never overwrite historical decisions — only append or refine.

---

## Project name
**RestroSewa** — a multi-tenant restaurant & hotel POS. **HRestroSewa** is the platform/brand
(e.g. the sender of automated reports); "RestroSewa" is the product wordmark. Package name
`restrosewa`.

## Goal
A fast, offline-tolerant POS for **Nepal** (currency **NPR**) that a small restaurant/hotel can
run end-to-end: QR customer ordering, table & room service, kitchen tickets/printing, billing
(cash/online/mixed/credit), inventory, purchasing, daily finance, payroll, and staff
permissions — all realtime, installable as a PWA. Must "feel instantaneous".

## Tech stack
- **Next.js** (App Router; Server Components + Server Actions) 16.x, **React** 19.x, **TypeScript**.
- **Supabase**: Postgres (RLS + `service_role`), Auth, Storage. Two projects: **dev**
  (`lnhionnsqbcfiigbsokg`) and **prod** (`qsccnzgrhrnjggyymefr`).
- **Tailwind CSS v4**, `radix-ui`, `lucide-react`.
- **web-push** (VAPID) for notifications; **SSE** for realtime; **nodemailer** (Gmail SMTP) +
  **pdf-lib** for the daily report; `qrcode.react`; `pg` for the migration runner.
- Hosted on **Vercel**. Playwright for E2E; ad-hoc Node scripts for DB/verify.

## Main features
QR ordering · tables & table-groups · rooms & room-types (check-in/out, folios) · sessions
(one open per table/room) · orders with **Order-Ticket (OT) batching** & thermal printing ·
billing (mixed payments, PIN-gated discounts, **customer credit / unpaid bills**, sequential
bill numbers) · **derived** stock & inventory · purchases & vendors (payables) · **Daily
Finance Report** (four balances, PDF emailed) · payroll · staff & granular permissions ·
walk-ins · table/room **shifting** (session transfer) · **cleaning** status · push
notifications · realtime dashboards · PWA/offline.

## User roles
- **super_admin** — platform operator (`/superadmin/*`); authority for staff CRUD.
- **restaurant_admin** — owner; **bypasses every permission check** (`hasPermission` returns
  true). Owns Settings, Finance.
- **restaurant_employee** — permission-gated (see `lib/permissions.ts`); nav & routes derived
  from permissions.
- **customer** — no account; orders via QR.
Admins/staff authenticate with a **synthetic email + 4-digit PIN** (see `auth-pin-model`).

## Restaurant modes (`restaurants.qr_mode`)
Per-restaurant customer ordering mode: **With PIN** / **Without PIN** / **Menu Only**. The PIN
is a **client-only** gate (convenience, not security).

## PWA
Installable; a service worker + manifest; an **OfflineGate** that refuses WRITES while offline
(the floor and admin both) rather than queueing stale mutations.

## Realtime
**Server-Sent Events** via `/api/realtime` + the `useRealtime(channels, onEvent)` hook. The
staff dashboard is SSE-bound (so `networkidle` never fires — use content waits in tests).

## Printing
Per-**workstation** Order Tickets with a dynamic `ticket_code` (KOT/BOT/COT…). Thermal 58/80mm
layout via `settings.print_paper_width`; the print modal portals to `document.body`; gated on
billing permissions. See **OT batching** in `decisions.md`.

## Notifications
web-push. A **new order** rings the relevant workstations **and** the table-group's assigned
staff (disjoint sets, no duplicates). Payment/close pushes were removed. In-app panel vs push
are a deliberate split.

## Current architecture (one-liner)
Server Components/Actions over Supabase; **latency-bound, not query-bound** (every query <1ms;
~130ms per round trip) so we remove round trips, never add indexes. Auth is **local JWT
verification**. `tenantCache` is the only cross-request cache. All money/stock figures are
**derived**, never stored. Full detail in `architecture.md`.

## Coding standards
- Prefer **Server Actions** in `app/actions/*`; they self-auth via `getRestaurantUser()` /
  guards and **re-check permissions server-side** (client gating is convenience only).
- Every mutation is **tenant-scoped** by `restaurant_id`; integrity/money operations run in a
  **Postgres RPC** (one transaction), granted to `service_role` only.
- **Never store derived data** (stock levels, balances) — compute from source rows.
- Business-day/date maths lives **only** in `lib/business-day.ts` (Nepal UTC+05:45).
- Sync helpers must **not** be exported from a `"use server"` module (it 500s at runtime) —
  keep them in plain modules and import them in.
- Match surrounding code style; keep comments at the altitude of *why*.
- **Do not commit** unless the user asks — the user drives all git.
