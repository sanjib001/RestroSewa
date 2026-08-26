# Security PIN (sensitive-edit authorization)

# Overview
An admin-only 4-digit **Security PIN**, independent of the Discount PIN, that gates editing
completed money records — payments (re-tender) and purchases — and is built as a **reusable
authorization service** future sensitive ops (refunds, stock reset, finance reset) plug into
with no new plumbing. Set in Admin → Settings. See `decisions.md` → "Security PIN & sensitive
edits".

# Responsibilities
- Store the PIN safely (bcrypt, in-DB, never leaves the server).
- Verify + authorize a sensitive op, and **audit every attempt** (success / wrong-PIN failure /
  post-auth block).
- Provide the actual edit flows for payments and purchases (which didn't exist before — those
  records were immutable).

# Features
- **Set/change/clear PIN** — `/admin/settings` card. No PIN ⇒ sensitive edits are OFF (same
  "no un-gated path" rule as the Discount PIN).
- **Edit a completed payment's tender** — correct the cash/online/card split of a fully-paid,
  non-credit bill. The **split is the source of truth; `payment_method` is derived** (one tender
  → that method, several → `mixed`). Amount, discount and bill number are frozen. Surfaced on the
  Sales list (`TenderEditButton`) for billing staff (`process_payments`) and the owner, PIN-gated.
- **Edit a purchase** — vendor, method (cash/online/mixed/credit), lines (product/qty/cost),
  notes. Reuses the record-purchase form in edit mode; surfaced in the purchase detail modal.
- **Security activity** — read-only audit list on the Settings page (who / what / when / outcome
  / before→after).
- **Open the Mock Bill screen** (`open_mock_bill`, 2026-08-07) — the first reuse of the service by
  an operation that CHANGES NOTHING. Gated because a mock bill prints indistinguishably from a real
  one, so who produced one is the thing worth recording. Open to `close_bills` holders; success is
  logged explicitly (no RPC to be atomic with), a missing permission logs `blocked`. It needed **no
  migration** — `security_audit_log.operation` is plain `text` with no CHECK constraint, so a new
  operation is a one-line addition to the `SecurityOperation` union. See `modules/mock-bill.md`.
- **Cancel a checked-in stay** (`cancel_room_stay`, 2026-08-13) — ends a stay without billing it
  and settles the deposit. **The only PIN operation gated on a plain PERMISSION rather than on
  `requireRestaurantAdmin`**: `cancel_room_stay` holders may do it themselves, and the owner passes
  because `hasPermission` is true for admins. That split is the point — the permission says who may
  try, the PIN says it is really them. It therefore lives in `app/actions/rooms.ts`, not
  `app/actions/security.ts` (everything in that file is admin-only). The audit `detail` carries
  **held / kept / refunded**: who cancelled, without how much they kept, is not an audit trail.
  Checks run permission → tenancy/assignment → PIN, in that order, so a wrong PIN cannot be used to
  probe which stay ids exist. See `modules/rooms.md`.
- **Set/change the opening balance** (`set_opening_balance`, 2026-08-26) — same shape as
  `cancel_room_stay`: gated on the existing `MANAGE_STOCK` + `VIEW_FINANCE` permission rather than
  `requireRestaurantAdmin`, so a permitted staff member may still attempt it and the PIN says it is
  really them. Unlike the money-edit ops above there is no RPC-level "before" row to diff against on
  a first-ever seed, so the audit `detail.before` is `null` there — the UI (`security-activity-client.tsx`)
  renders that as "not set" rather than skipping the summary. Lives in `app/actions/finance.ts`
  alongside `getOpeningBalance`, not in `security.ts`, matching where `cancel_room_stay` lives in
  `rooms.ts`. See `modules/finance.md`.

# Business Rules
- **PIN-gated always.** The **payment tender** edit (Sales) is open to **billing staff**
  (`process_payments`) as well as the admin — the Security PIN is the real gate (server-verified +
  audited with the actor). The **purchase** edit stays **admin-only** (`requireRestaurantAdmin`).
  Staff without the permission (or with no PIN set) never see the Edit control.
- **In-place edit + audit snapshot** (not reversal/void). Finance & stock RE-DERIVE from the
  edited rows automatically — the audit log IS the immutability guarantee.
- **Any record, any date** — corrections may reach back; a past day just re-derives.
- **Purchase reconciliation blocks on inconsistency**: editing moves the vendor credit from the
  old vendor to the new; if reversing the old debt would push a vendor's `credit_balance` below 0
  (payments already exceed the reduced debt) it raises `VENDOR_BALANCE_NEGATIVE` and rolls back.
  `last_unit_cost` is recomputed to each affected product's latest purchase.
- Failure/block logging lives in the TS layer (a RAISE inside the RPC would roll back an audit
  insert); success is logged INSIDE the edit RPC, atomic with the change.

# Important Components
- DB (`supabase/migrations/20260729100000_security_pin.sql`): `restaurants.security_pin_hash`;
  `set_security_pin` / `verify_security_pin` (bcrypt, mirror the discount PIN); `security_audit_log`
  + `log_security_event`; `edit_payment_tender`; `edit_purchase`. All `service_role`-only.
- `lib/security/authorize.ts` (server-only): `verifySecurityPin` (verify + log failure),
  `logSecurityEvent`, `getSecurityAuditRows`, `SecurityOperation` type — the reusable primitive.
- `app/actions/security.ts`: `getSecurityPinStatus`, `updateSecurityPin`, `getSecurityAuditLog`,
  `getPaymentTender`, `updatePaymentTender`, `updatePurchase` (+ friendly error map).
- `components/security-pin-dialog.tsx`: reusable controlled PIN dialog (extra fields as children).
- Settings: `_components/security-pin-client.tsx`, `security-activity-client.tsx`.
- Purchases: `purchases-client.tsx` `PurchaseForm` now has an `edit` mode; detail modal shows
  "Edit purchase". Sales: `_components/tender-edit.tsx`; `sales-view.tsx` threads `canEditTender`.
- `lib/restaurant-info.ts`: `getRestaurantConfig().securityEnabled` (hash collapsed to boolean).

# Database Relations
`restaurants.security_pin_hash`; `security_audit_log`; edits touch `payments`, `purchases`,
`purchase_items`, `vendors`, `products`. See `database.md`.

# Permissions
The PIN is the authorization; the button visibility is convenience. `canEditTender` (Sales) =
`securityEnabled && hasPermission(process_payments)` (admin passes it too) — threaded from the
employee dashboard; `updatePaymentTender`/`getPaymentTender` re-check `process_payments`.
`canEdit` (Purchases) stays admin = `role === 'restaurant_admin' && securityEnabled`. See
`modules/permissions.md`.

# Known Limitations
- No PIN lockout/rate-limit in v1 (every failed attempt is logged; a lockout can layer on that).
- Editable fields are scoped: NOT bill numbers, payment totals or discounts; purchases are still
  never deleted.
- Audit view is owner-only (no super-admin cross-restaurant view yet).

# Future Improvements
- Lockout after N failures; more gated ops (refunds, stock/finance reset) reusing `verifySecurityPin`;
  super-admin audit view; richer before→after diff rendering.
