# Current Task

The single in-flight task. When it's done, move a summary to `completed.md`, note user-facing
changes in `changelog.md`, and reset this file to the template below.

---

## Current Feature
**Unit-wise order item cancellation (2026-08-17) — CODE COMPLETE, all 5 migrations applied and
verified on DEV. Production migrations PENDING.**

A guest who ordered `Momo × 3` and wanted one taken off got all three cancelled, or none.

⚠️ **The root cause was not the cancel path — it was that a partial cancellation had no
representation anywhere.** `session_order_items.quantity` is written once at insert and updated by
no code path in the repo; cancellation is a whole-row `cancelled_at` stamp. So every consumer — bill,
stock, COGS, folio, kitchen queue, guest screen, push — asked one binary question and then took the
FULL quantity. "Cancel 1 of 3" could only ever execute as "cancel the line".

**The model: counters on the line + an append-only event log.**
`cancelled_quantity`, `served_quantity`, and `active_quantity` (generated, `quantity −
cancelled_quantity`), plus `session_order_item_cancellations` — one row per cancellation EVENT.
Both are needed and neither alone is enough:
- The COUNTER exists because PostgREST cannot aggregate a child table into an embed; `active_quantity`
  being a real selectable column is what made ~10 reader changes mechanical.
- The EVENT LOG exists because **`stock_report` dates a release by `cancelled_at`, and one timestamp
  cannot date two partial cancels.** Cancel 1 today and 2 tomorrow ⇒ the shelf must gain 1 today and
  2 tomorrow. A single column has to pick one day and be silently wrong about the other.

⚠️ **`cancelled_at` keeps its EXACT old meaning** — stamped only when `cancelled_quantity = quantity`.
That is what let every existing `cancelled_at is null` reader stay correct while readers were
migrated one at a time, and it keeps `trg_release_ticket_numbers_on_item_cancel` releasing the bill
number on the last unit. **Do NOT redefine "fully done" as `cancelled + served = quantity`** or bill
numbers stop being released.

**`item_status` is now derived from `served_quantity`** by a BEFORE UPDATE trigger that syncs in
*whichever direction was written* — the deployed build writes the flag, the new one writes units.
That two-way sync is what made these migrations safe to apply BEFORE the app deploy. A partly-served
line reads `'pending'` and stays cancellable, which is what makes "serve 2 of 3, cancel the last 1"
work at all.

⚠️ **Idempotency stopped being free and had to be rebuilt.** The old model got it structurally
(`where cancelled_at is null` ⇒ a row can only be cancelled once). With per-unit events a retry
cancels MORE. Replaced by **compare-and-swap on the remaining count** (`p_expected_remaining`), chosen
over an idempotency key because it needs no client state and also covers two cashiers cancelling the
same line concurrently — the same idiom `reject_table_activation` already used. `request_id` ships as
belt-and-braces. Over-cancellation is **refused, never clamped**: "cancel 4" and "cancel 3" are
different amounts of money.

⚠️ **`order_item_consumption` was deliberately NOT changed.** Emitting release legs from it looked
obvious and breaks three readers quietly: `stock_report.usage` and `dashboard_stats.cost` have no
cancellation predicate so releases would count as CONSUMPTION, and `product_history`'s sale leg would
fan out N times and corrupt its running `balance`. Releases got their own view, `order_item_release`,
which JOINS the consumption view so the variant-recipe rule is not copied. It carries **both**
timestamps because `stock_report` splits a release three ways on `released_at` AND `item_created_at`.

**Two pre-existing defects closed on the way:**
1. **Cancelling after payment was never blocked**, and `getPaidBill` re-queries items live — so a
   post-payment cancel silently changed a printed bill's lines while `payments.total_amount` stayed
   frozen. Now refused by `assert_session_unpaid`, called by all four cancel paths. (`force_close_session`
   skips the release instead of raising — closing a session is its job and must always work.)
2. **The bulk paths over-restored SERVED food.** `item_status <> 'served'` is a LINE test; under the
   new model a 2-of-5-served line reads `'pending'`, so they now cancel `quantity − cancelled − served`.
3. A cancelled item vanished from its own ticket's reprint. `SessionDetail` gained `allItems`;
   `itemsOfTicket` reads that. **The money guard the removed filter provided is now STRONGER** — totals
   multiply by `active_quantity`, so a cancelled line contributes zero by arithmetic rather than by
   being absent.

**Void tickets** finally use `order_tickets.kind`, reserved since day one for exactly this. A void
ticket is a DELTA naming only the cancelled units (an item belongs to one ticket for life), it burns
an OT number (it is paper), and `void_ticket_id` on the event makes it reprintable. Units cancelled
*before* their KOT went out produce no paper at all.

**Verified on DEV, measured not assumed:** `tsc` clean, `npm run build` clean, `node --test`
**110/110** (12 new in `lib/order-quantities.test.ts`). End-to-end **69/69** across all 12 stated edge
cases with real stock: cancel 1 of 3 restores **exactly 1**, never 3; a cross-day cancel lands in
`added` and contributes **0** to `reversed`; CAS refuses a stale expectation; a replayed `request_id`
is a no-op; over-cancel refused at the RPC and again by the CHECK; a paid session refuses. All test
data removed and **stock, COGS, tracked revenue and sales all back to baseline**. The `20260821000100`
no-op proof passed **215 comparisons, 0 differences** against the pre-event logic. The
`getPendingVoids` PostgREST embed verified against the real API, including that it scopes by session
and excludes unprinted cancellations.

⚠️ **DEV DRIFT FOUND AND FIXED.** DEV's `stock_report` had been hand-replaced with a
partial-cancellation-aware body referencing `cancelled_quantity` **without the column and without a
migration** — so `stock_report` and `dashboard_stats` were raising `42703` on DEV, breaking the Stock
screen, dashboard and analytics. Production was unaffected (byte-matching the repo). This is why
`20260821000100` **drops before creating** `stock_report`: the installed return type differed between
environments (dev had no `reversed`). Re-measure signatures before trusting the repo file.

**Also in this batch — emptied saving pots could never be retired (`20260822000000`).**
Removal was gated on the ENTRY COUNT, not the BALANCE (`expenses-client.tsx` `entryCount === 0`, and
`deleteSavingTitle`'s `count > 0` refusal), so a pot deposited into and then fully withdrawn held
nothing and was stuck on screen forever — with the message "This saving has money in it", false in
exactly the case that reached it. **Reproduced on PRODUCTION**: "Hotel GlasGow In & Restaurant" has a
pot with opening 50,000, entries netting −50,000, balance 0.00, undeletable.
⚠️ **Deleting it is genuinely impossible, not merely blocked.** A saving row IS an `extra_expenses`
row — a dated cash movement Finance has already counted — so removing the rows would rewrite a
settled day's closing cash. So an emptied pot is **CLOSED** (reversible), a pot with no history is
still hard-deleted, and the name index became partial (`where closed_at is null`) so a closed pot's
name is reusable — which in turn means REOPEN can collide and is refused explicitly.
Verified on DEV **14/14**: balance 0 with history, hard delete blocked by the FK (`23503`), close
leaves history untouched, Finance moves by exactly the withdrawal and returns to baseline, name reuse
allowed while two OPEN pots still collide (`23505`), fresh pot still deletes outright.

**Also — the reset never cleared Extra Expenses or Savings (`20260823000000`).**
`reset_restaurant_finance` deletes 15 tables by name and `extra_expenses` was not one of them. Its
only other route is `restaurant_id → restaurants on delete cascade`, and **the reset deliberately
keeps the restaurant row, so that cascade never fires** — the table was added a month after the
function and the delete list was never revisited. Rent, electricity, fuel and every saving movement
survived a reset that claims to clear the books. ⚠️ **Lesson: a table added after this function is
covered by nothing. Check the delete list, not the FK.** `extra_expenses` was the ONLY trading table
with neither an explicit delete nor a covering cascade (`room_advances`, `order_tickets`,
`session_transfers`, `session_order_item_cancellations` are all cascaded from tables the reset does
delete).
**The pots are KEPT and their balances folded onto `opening_amount`** — the function's own pattern for
`products`/`vendors`/`credit_customers`. ⚠️ The fold is clamped with `greatest(…, 0)` because
`saving_titles_opening_amount_check` forbids a negative opening and a pot CAN go negative (the guard
in `security.ts` runs only `if (wasWithdrawal)`, so editing a deposit downward is unchecked) — one
such row would abort the whole reset.
**Second, latent bug fixed in the same file:** `delete_restaurant_cascade` never named
`extra_expenses`/`saving_titles`, and `saving_title_id` is `ON DELETE RESTRICT`, so deleting a
restaurant with savings depended on Postgres's cascade order. It works today only because RI trigger
names sort as strings over constraint OIDs — it would break on a database rebuilt from scratch, which
is what `clone-db.mjs` produces.
Verified on DEV **25/25** on a throwaway restaurant: expenses cleared, **each pot's balance identical
across the reset**, idempotent on a second run, a negative pot clamped rather than fatal, a
savings-holding restaurant deletes cleanly (in a rolled-back transaction), and **no other restaurant
moved**.

**✅ PRODUCTION MIGRATED 2026-08-17 — all 9 applied, 9/9, no failures.**
`20260819000000` (gas→fuel), `20260820000000` (credit discount), `20260821000000`–`20260821000400`
(unit cancellation), `20260822000000` (close saving), `20260823000000` (reset expenses).
Production and DEV are both at **103/103, pending 0**.

**How it was verified (measured, not assumed):**
- **All 21 touched functions and both views are byte-identical to DEV** (`md5(pg_get_functiondef)`).
  The strongest convergence proof available, and it also proves no DEV drift escaped a migration file.
- **Nothing moved.** 8 restaurants × (14 finance figures + 4 dashboard figures + every product's
  closing stock + every pot balance) + 13 table row counts, snapshotted before and after:
  **0 differences.**
- **Ledger reconciles 0.0000** on cash, bank and both credit legs for all 8, before and after.
- **Deploy-window safe**: exactly ONE overload for all 10 RPCs the deployed build calls, and every
  one still binds — notably `record_credit_payment` is now 10 params / 6 required, so the deployed
  build's 8-arg call resolves.
- Backfill correct: **315 cancelled rows → 315 event rows**, 0 rows where
  `cancelled_quantity <> quantity`, 0 where `served_quantity <> quantity`, 0 `'gas'` rows left.
- **PostgREST 200** on all five new relations/columns, so the schema cache picked them up.

⚠️ **DEV was the stale side, not production.** The 7a check initially failed on `finance_report` /
`finance_transactions`: DEV still held the DEFECTIVE `20260820000000` (its `advsold` CTE missing the
period filter) because that file was corrected *after* DEV's ledger row existed, so `migrate up`
skipped it forever. Production received the corrected file and was right all along. DEV was repaired
by applying that one file directly (it is idempotent) and both now match.
**Lesson: a corrected migration whose ledger row already exists will never be re-applied by the
runner. `status` will say "up to date" while the database holds the old body.**

📄 The pre-migration `pg_get_functiondef` capture for all 14 replaced functions is in the session
scratchpad as `prod-functions-before-2026-08-17.sql` — the rollback path if a body needs reverting.
Safe to discard once the app is deployed and exercised.

**Remaining:**
1. **DEPLOY THE APP.** The database is ahead, which is the safe direction, but the new features
   (unit cancellation, void tickets, credit-clearance discount, close-saving, expense reset) are not
   reachable until the build ships.
   DB before app; each is independently applyable and leaves the deployed build correct.
2. **In-app QA on DEV**: cancel 1 of 3 from the session screen and from a room folio; confirm the
   line reads "Ordered 3 · Cancelled 1 · Remaining 2"; print a KOT then cancel and print the void;
   confirm the reprint of the original still shows what the kitchen was handed.
3. **Open, NOT closed by this work:** `session-client.tsx:111-118` computes the payable client-side
   and `closeSessionWithPayment` accepts it verbatim without re-deriving, so a cancel landing between
   render and submit overcharges. The room path already rebuilds server-side; the table path does not.
4. Nothing committed — user drives git.

---

## Previous feature
**Review fixes on the last three commits (2026-08-17) — shipped in `438192b`.**

⚠️ **`finance_report`'s advance split had lost its period filter, and it is only caught because
production has not been migrated yet.** The hand-written rewrite in
`20260820000000_credit_payment_discount.sql` dropped
`filter (where x.paid_at >= p_from and x.paid_at < p_to)` from **both** legs of `advsold`, so
`sales_advance_cash` / `sales_advance_online` returned the **all-time** figure for every period.
Measured on DEV: a 1-day window read `sales_advance = 0` against a split of **3,500**. That breaks
`cash + online + card + advance_cash + advance_online + credit = total` on the Finance Sales block,
the CSV and the emailed daily PDF — the identical defect this file records as fixed on 2026-08-12
("a new way to settle a bill needs a Sales LINE"). ⚠️ **The ledger still reconciles 0.0000 through
it**, because `finance_transactions` was untouched, so the project's usual proof does NOT catch this
class. Verified read-only that **production still has the correct body** — both `20260819000000` and
`20260820000000` are pending there.

**Both finance functions were rebuilt from the PREVIOUS body plus only the deliberate deltas**,
rather than patching the rewrite. The rewrite had also stripped ~25 comment blocks, including the
warning that `finance_transactions`'s room test must stay identical to `finance_report`'s `paysrc`.
Diffing the two revealed the logic was otherwise byte-identical — which is what made a
rebuild-from-old safe and is the technique to reuse next time a 300-line function is "rewritten".

**Other fixes in the same pass:**
- **A live database password was committed** in `scratch/apply_discount_migration.mjs` — and
  `.env.production` uses the **same** password, so it leaked production too. File deleted, `scratch/`
  added to `.gitignore` beside the env-file rule it was routing around. ⚠️ **It is still in git
  history (`007aa80`); the password must be ROTATED on both projects.** That script also bypassed
  the ledger — use `scripts/migrate.mjs`, which writes `supabase_migrations.schema_migrations`.
- **`gas` → `fuel` inverted the DB-before-app rule.** Dropping `'gas'` from the CHECK would have made
  every gas expense insert fail for the deployed build during the window. `'gas'` is now retained as
  a transitional key (nothing writes it; `expenseCategoryLabel` maps it to "Fuel" on read).
- The credit-clearance discount field + PIN were rendered for **everyone**; now gated on
  `apply_discounts` via a `canDiscount` prop off the dashboard, matching the till discount. The
  server always re-checked, so this is UX, not the boundary.
- Removed the no-op `revalidatePath("/admin/credits")` — that route does not exist; corrected the
  `completed.md` claim that said it did.
- `lib/finance.ts`: `salesTotal + discountsTotal` no longer reconstructs gross sales and the doc
  comment said it did. A till discount never entered `salesTotal`; a credit write-off forgives a
  bill booked at FULL value on an earlier day, so adding both back double-counts the credit half.

**Verified:** `tsc` clean, `npm run build` clean, `node --test` **98/98**, and a structural check of
the rebuilt SQL — 60 declared columns == 60 projected, all 65 CTE references resolve, both advance
legs filtered and clamped, and the two credit legs move together across the two functions.

**Remaining:**
1. ⚠️ **DEV still holds the BROKEN `finance_report`** — `20260820000000` is already in its ledger, so
   `migrate up` will skip it. Re-apply that one file directly (it is idempotent:
   `add column if not exists`, `drop … if exists` + create), then re-measure that a narrow window's
   `sales_advance` equals `sales_advance_cash + sales_advance_online`.
2. Then migrate production: `20260819000000` and `20260820000000` are both still pending.
3. **Open design question, not a defect:** a credit write-off never reaches profit. The bill was
   booked as a sale in full when it closed on credit; forgiving it drops the receivable but nothing
   subtracts it from `sales − purchases − salaries − extra expenses`, so estimated profit is
   overstated by every discount given. The balances all reconcile — compare the cancellation design,
   which deliberately recognised a retained deposit as a SALE rather than let a balance reconcile to
   a lie. Decide whether this wants a bad-debt line.
4. Nothing committed — user drives git.

---

## Previous Feature
**Mixed Menu + Customized Items Order Submission Fix (2026-08-16) — CODE COMPLETE & VERIFIED.**
1. **Root Cause Resolved**: Fixed bulk insert key structure mismatch between `resolveOrderItems` and `resolveCustomItems`. `ResolvedOrderItem` in `lib/order-items.ts` now explicitly includes `is_custom: false`.
2. **Single-Submission Ordering**: Staff can add any combination of menu items and customized/manual items to the cart and submit them together in a single order submission without errors.
3. **Pipeline Integrity**: Workstation routing, docket generation, stock deduction, billing, and cancellation remain fully preserved for both item types.
4. **Verification**: `tsc` clean (0 errors), `node --test` 98/98 passing (including `lib/mixed-order.test.ts`).

---

## Earlier feature
**Cancel a checked-in stay (2026-08-13) — CODE COMPLETE on DEV, not yet exercised in a browser.**
A stay could only ever end via `check_out_room`. Now it can be CANCELLED: ended without being
billed, with the deposit settled in the same step.

⚠️ **The whole design is where the KEPT money goes.** A deposit already raised cash AND
`advances_held` on the day it was taken. Keep ₹2,000 of it and, if that is not recognised as
income, it stays booked as a deposit against a stay that no longer exists — **`advances_held` never
returns to zero**. The balances still reconcile; they reconcile to a lie. So a retained deposit is
a **SALE**: one `payments` row, `total = amount = advance_amount = kept`, `cash/online/card = 0`.
No new money moves, the sale is recognised, held clears, and
`left on credit = total − (cash+online+card+advance) = 0` keeps a cancellation out of receivables.
A full refund writes **no payment row at all**. **Neither finance function needed changing** — a
cancellation writes only `payments` and `room_advances`, which both already read.

**A cancelled stay's BILL is the charge, not the nights.** `buildFolio` gained `cancelled` +
`cancellation_charge`: one "Cancellation charge" line, `nights: 0`, no food, no extras, **and no
tax or service** (the RPC records a payment of exactly the charge, so tax on top would print a bill
that cannot reconcile to its own sale). It lives in the calculator, not the printer, because
`getPaidBill` rebuilds paid room bills from the frozen stay.

**Permission + PIN.** `cancel_room_stay` is a FOURTH room lane, outside the
view/check_in/manage ladder in both directions. Owner passes automatically. The Security PIN gates
**everyone including the owner** — the only PIN op not on `requireRestaurantAdmin`, which is why it
lives in `app/actions/rooms.ts` rather than `security.ts`. Checks run permission → tenancy → PIN so
a wrong PIN cannot probe which stay ids exist; the audit detail carries held/kept/refunded.

⚠️ **TWO migrations, and they MUST stay separate.** `20260818000000` adds the enum value;
`20260818000100` uses it. The runner wraps each file in `begin…commit` and Postgres refuses a new
enum value in the transaction that created it. **Proved, not assumed** — the merged shape raises
`55P04 unsafe use of new value`. Merging them looks tidier and fails on first run.

**Verified on DEV, 27/27 end-to-end** with real stays: deposit 5,000 (3,000 cash + 2,000 online),
keep 2,000 → sales **+2,000** (a ROOM sale), cash net **+2,000**, bank net **0**, **advances held
back to ZERO**, **no phantom debt**, payment settled entirely by the advance, stay `cancelled`,
room in `cleaning`. Full refund → no payment row. No deposit → nothing moves. Guards:
`STAY_NOT_ACTIVE`, `INVALID_CHARGE`, `REFUND_MISMATCH`. **Ledger reconciles 0.0000 on both legs.**
All figures back to baseline afterwards; the user's own "sanjib Pandey" stay untouched throughout.
`tsc` clean, build clean, `node --test` **77/77** (10 new).

**Follow-up fix (same day, no migration): the ledger now NAMES a refund.** A refund read
"Room Advance", identical to the deposit it reverses. `txLabel(t, showRooms)` in `lib/finance.ts`
is now the single labeller for the screen AND the CSV (they had drifted to "Room sale" vs
"Room Sale"). Negative `room_advance` → **Room Advance Refund**; negative `extra_expense` →
**Saving Withdrawal** (only the `saving` category may go negative, so the inference is safe).
⚠️ The label reads the row's SIGN, the colour reads the DELTAS — different inputs on purpose, and
`lib/finance.test.ts` asserts they never contradict (refund red −, withdrawal green +).
Measured on the real DEV ledger: **4 of 4** negative rows were mislabelled, all now correct.
`lib/finance.ts` also switched to a relative `./business-day.ts` import so it is node-testable.

**✅ PRODUCTION MIGRATED 2026-08-14.** All three (`20260817000000`, `20260818000000`,
`20260818000100`) applied 3/3. Production and DEV are both at 94/94, `pending: 0`.
Verified: enum now `active, checked_out, cancelled`; **one** `cancel_room_stay` overload whose body
is **byte-identical to DEV** (`06f7526e…`); all 4 cancellation columns, both new CHECKs and the
`service_role` grant present; the opening-amount column defaulting to 0. **Nothing moved** —
8 restaurants × 7 figures identical before/after — and the **ledger reconciles 0.0000** on both
legs for all 8. Prod had **12 active stays** at the time, untouched, and **0 saving pots**, so the
opening column affected no existing row.

📘 **The manual procedure is now written down**: `docs/runbooks/migrating-to-production.md` —
targets and interlocks, `npm run` swallowing flags, what to look for when reading a migration
(drop-before-create, the enum-in-one-transaction rule), the read-only pre-flight, the money
snapshot, apply, then the four verification tiers (function hashes → nothing moved → ledger
reconciles → PostgREST + deploy-window). Point future sessions at it rather than re-deriving.

**Remaining:**
1. **Deploy the app** — the DB is ready and waiting for all three features.
2. **In-app QA**: cancel from Admin → Rooms and from a staff folio; confirm a staffer without the
   permission sees no Cancel control on either; wrong PIN refused and visible as a **failure** in
   Settings → Security activity; the freed room accepts a new check-in once cleaned.
3. **Reprint parity**: a cancelled stay's bill in Sales must show the cancellation charge, not the
   nights it would have cost.
4. Nothing committed — user drives git.

---

## Previous feature
**Staff-dashboard expenses/payroll + add-only permission + pot opening balance (2026-08-13) —
CODE COMPLETE on DEV, not yet exercised in a browser.** Three requests in one pass.

**1. Extra Expenses and Payroll reach the staff dashboard**, after Vendors, as summary cards →
thin `/employee/{expenses,payroll}` pages reusing the admin clients (the Vendors pattern).
⚠️ **Payroll's card and page gate differently on purpose**: the card needs `manage_payroll`, the
page opens on either payroll right. The dashboard is tighter because it puts salaries on a screen
left open at the counter. The card reads `getPayrollSheet`, NOT `getPayrollSummary` — the latter
is gated on `view_finance` and would return zeros for a payroll-only staffer.

**2. `add_expenses` ("Add Expenses & Saving")** — file an expense or a saving, see **today only**,
never a pot's running balance. Enforced SERVER-side in three places, not by hiding UI:
`listExtraExpenses` forces `period="today"` and drops any from/to; `listSavingTitles` filters to
today BEFORE summing and never reads `opening_amount`, so **no running total exists in the
payload**; `withdrawSaving` + all pot CRUD stay on `manage_expenses`. One predicate,
`STOCK_ACCESS.expensesTodayOnly` (`add && !manage && !view_finance`), drives all of it —
never re-derive it at a call site. New `lib/permissions.test.ts` covers the matrix, including that
a wider right CANCELS the restriction (granting both boxes must not strand a manager on today).

**3. `saving_titles.opening_amount`** — what a pot held before the app tracked it.
⚠️ **The obvious implementation (write it as a saving row) is wrong and expensive**: every finance
figure sums those rows, so a ₹50,000 opening would take ₹50,000 out of today's cash, add a ledger
outflow that never happened and cut the month's profit. It lives on the TITLE instead, like
`finance_openings`. Verified on DEV: closing cash, closing online and `extra_expenses_total` all
unchanged after inserting one; no ledger row; negative refused (`23514`).
Consequence: pot balance = `opening + Σ rows`, while the cash/online split covers only the rows —
they do NOT add up and must not, so the UI names the opening figure explicitly. Withdrawals can
draw against it (the money exists), so `withdrawSaving` and the PIN-gated edit in `security.ts`
both include it when measuring "held" — keep those two identical.

**Verified:** `tsc` clean, `npm run build` clean (`/employee/expenses`, `/employee/payroll`
registered), `node --test` **67/67** (10 new permission tests). DB probe 7/7, all test data removed.

**Remaining:**
1. **In-app QA on DEV**: grant only "Add Expenses & Saving" to a test staffer — confirm the
   dashboard card appears, the page shows today only with no period picker, the Saving tab shows
   pots with today's figures and no balances, and there is no Withdraw / New saving / edit control.
   Then grant Manage as well and confirm the full view returns.
2. Create a pot with an opening amount; confirm Finance is unmoved and the pot reads the sum.
3. **Production migration `20260817000000` is PENDING.** DB before app.
4. Nothing committed — user drives git.

---

## Earlier feature
**Room night boundary (2026-08-13) — CODE COMPLETE on DEV, not yet exercised in a browser.**
Room charges used to step up on a rolling 24-hour clock from check-in. They now step up at the
hotel's **checkout hour**, the same wall-clock time for every guest.

**The rule, which is one line and covers both cases the user asked for.** `room_new_day_hour`
(default 6) decides which DAY an arrival belongs to; `room_price_double_hour` (default 12) is when
each following night starts; night *n* ends at the double-hour on `arrival's room-day + n`.
Arriving 8 PM → doubles tomorrow noon. Arriving 3 AM → belongs to *yesterday's* room-day, so it
doubles **today** at noon. Both settings live in `restaurants.settings` jsonb, so they needed **no
migration** — the card is on `/admin/rooms`, gated on `manage_rooms`.

**It reuses `businessDate`'s shift-back trick** rather than a second Nepal-offset implementation:
`roomNights` / `roomNightBoundary` are in `lib/business-day.ts`, which is where day maths lives.
⚠️ `lib/room-billing.ts` therefore imports **relatively**, `from "./business-day.ts"` — the only
production file in the repo that does, because `lib/room-billing.test.ts` runs under `node --test`
which resolves neither `@/` nor an extensionless specifier. Verified it builds. Do not "tidy" it.

**The hours are SNAPSHOTTED at check-in** (`room_stays.new_day_hour`/`double_hour`), the same
guarantee `room_rate` already had — and needed more badly here, because a paid room bill is
REBUILT from the frozen stay on reprint, so without it an admin changing the checkout hour would
silently re-price every historical bill. Null = follow the live setting, which is what let stays
already in progress adopt the rule on ship day (the user's explicit call).

**A per-stay shift** (`price_shift_hours`, 0–12) pushes that stay's boundary later — the front
desk's "keep the room until 3". Applies to every boundary of the stay, not just the next, because
only the departure day is ever affected in practice and one number is honest to display. Gated on
`check_in`, **no PIN** (a PIN at the desk means it stops being recorded), but `price_shift_by` +
`price_shift_at` are stored and shown. Capped at 12 because 24 would step over a boundary and gift
a free night.

⚠️ **The plan said three call sites; there were FIVE.** `buildFolio` has four callers —
`getRoomsOverview`, `loadFolioInputs` (folio *and* checkout), and `getPaidBill` — and
`rooms-grid.tsx` had a **fifth** private implementation, `untilNextNight` doing `elapsed % 24h`,
which would have promised guests hours they did not have. It now counts down to the
server-supplied `folio.nextBoundary`. If nights are ever touched again, audit all five.

**A real bug the tests caught:** `normalizeRoomHour(null)` returned **0**, because `Number(null)`
is 0 and 0 is a valid hour — a null column would have silently moved every boundary to midnight.
Both normalizers now reject empty-ish values before `Number()` sees them.

**Verified on DEV (measured, not assumed):** `npx tsc --noEmit` clean; `npm run build` clean;
`node --test` **57/57** (18 new, incl. both of the user's worked examples, 05:59-vs-06:01, arrival
and departure exactly on a boundary, month/year rollover, and the shift cap). Migration applied,
**one** `check_in_room` overload, and **both the 17-arg (deployed build) and 19-arg calls reach
business logic** — `P0001 ROOM_NOT_FOUND`, not `42883`/`42725`. End-to-end against a real stay,
**12/12**: check-in stamps the snapshot; changing the restaurant setting afterwards does NOT move
the stay; the snapshot rule charges 1 night where the live rule charges 2; a +3h shift pulls it
back to 1; a 24h shift is refused by the DB (`23514`). PostgREST embed for `price_shift_by` → 200.
All test data removed and settings restored byte-for-byte (asserted).

**✅ PRODUCTION MIGRATED 2026-08-13** (`20260816000000`, 1/1). Production and DEV are both at 91/91.
Pre-flight confirmed prod's `check_in_room` was the exact 17-arg signature the `drop` targets —
had it differed, the drop would have silently no-opped and left two overloads for a `42725` at
runtime. After: **one** overload, 19 params / 8 required / 11 defaulted, so the currently deployed
build's 17-arg call still resolves; body **byte-identical to DEV** (`8d1288a2…`); all 5 columns,
3 CHECKs and the `price_shift_by` FK present; all 31 existing stays untouched (shift 0, snapshots
null, so they follow the live setting exactly as designed).

**Deploy impact measured on the real data: ZERO.** All **9 stays currently open on production**
were priced under both rules — every one bills the **same** number of nights, net change **+0**.
Nothing to warn a front desk about. (Measured read-only; the migration itself changes no billing,
since the whole rule is in TypeScript — the re-pricing moment is the APP deploy, not the DB.)

**Remaining:**
1. **Deploy the app** — the DB is ready and waiting.
2. **In-app QA**: set the two hours; check a guest in and confirm the folio names the next boundary
   and the dashboard card counts down to the same instant; grant +3h and watch both move; check out
   either side of the boundary; confirm a `view_rooms`-only user sees the boundary but no
   "Give more time" control.
3. **Reprint parity** (the regression that matters most): check a stay out, note nights and total,
   change *both* admin settings, reprint from Sales — it must be identical.
4. Nothing committed — user drives git.

---

## Earlier feature
**Extra Expenses (2026-08-13) — CODE COMPLETE on DEV, not yet exercised in a browser.**
Overheads that are neither stock nor people: rent, electricity, water, gas, internet, maintenance,
marketing, licenses, transport, other. New page `/admin/expenses` in the Stock & Finance nav group.
Spec: `docs/superpowers/specs/2026-08-13-extra-expenses-design.md`.

**The model is deliberately the thinnest thing that is true.** An expense row IS the payment —
no status column, no payable, no settle-later screen, no RPCs. `extra_expenses` is the shape of
`purchases` minus the credit leg, written by a plain insert with `resolveSplit()` validating and
the CHECK (`cash + online = amount`) as the backstop. A bill that has arrived unpaid is simply not
an expense yet. `credit` is excluded from `payment_method` for the same reason `salary_payments`
excludes it: "we didn't pay" is the absence of a payment, not a kind of one.

**Decisions worth not re-litigating:**
- **No back-dating.** The expense lands on the business day it is recorded. Back-dating would
  silently rewrite a day whose PDF is already sent and marked in `report_deliveries`.
- **Category is a CHECK, and every key is a single word.** `finance_transactions` labels a ledger
  row `initcap(category)`, so a label like "Licenses & Taxes" in `lib/expenses.ts` would make one
  expense read two ways on two screens. Labels equal `initcap(key)` by construction.
- **`canViewExpenses` does NOT pass on a stock right** (unlike Purchases/Vendors) — the overheads
  list is the landlord and the power bill, not the store room. `manage_expenses` OR `view_finance`.
- Edit/delete: admin role + Security PIN, logged with **before/after** figures. These are the first
  PIN ops with no RPC of their own, so they call `logSecurityEvent` for success themselves.

**Savings (same day, second round).** "Saving" is the **eleventh category**, plus a `saving_title_id`
pointing at a new `saving_titles` table (the pots). Because it is just a category, it reached the
period total, the split, the ledger, the CSV, the PDF and the profit subtraction **with zero changes
to either finance function** — which is exactly why it was modelled this way rather than as its own
table. Finance shows ONE "Saving" line and never the per-title detail; the pots live only on
`/admin/expenses`. Savings DO reduce estimated profit (user's explicit call). A pot's total is
ALL-TIME and the period picker is hidden on that tab. Two constraints carry the guarantees:
`(category='saving') = (saving_title_id is not null)` and `on delete restrict` on the FK — a pot
with money in it cannot be deleted (API returns 409, verified).

**Withdrawals (third round, same day).** A withdrawal is a **negative saving row** — the
`room_advances` signed-row trick again, and again it needed **no change to either finance
function**: every figure already SUMS these rows, so pot balance, period total, both cash balances
and the ledger delta come out right from the signs alone. `extra_expenses_total` is therefore NET
for the period. The load-bearing new constraint is `cash_amount * amount >= 0` (and the same for
online): without it a row could be `amount −5000, cash +8000, online −13000`, which satisfies the
split check and would credit the till 8,000 that never existed. Over-withdrawal is refused on both
create and edit (the edit measures the pot excluding the row being replaced). The form is all
positive numbers; the sign is applied once at the server boundary and re-applied from the existing
row on edit, so a deposit cannot be flipped into a withdrawal from the client.
⚠️ Since saving cuts profit, withdrawing RAISES it — accepted, and the mirror of the earlier
choice; it cancels over any period holding both.

**Migrations (DEV only — user migrates prod):** `20260813000000` the table;
`20260813000100` `finance_report` (+4 appended columns incl. `extra_expenses_by_category` jsonb)
and `finance_transactions` (+`extra_expense` kind). Both bodies rebuilt from `pg_get_functiondef`,
never the repo files — the same trap as last time. `20260814000000` `saving_titles` +
`saving_title_id` + the widened category CHECK — **touches no function at all**;
`20260814100000` the signed-amount + sign-agreement constraints — **also touches no function**;
`20260815000000` `finance_report` +`discounts_total`/`discounted_bills` (generated from the live
definition by targeted insertion rather than retyping a 300-line body); `20260815100000`
`finance_transactions` +`source`/`source_label` on the sale branch (generated the same way, with
anchor assertions — 9 branches touched, verified 121 ledger rows before AND after, so the three
new LEFT JOINs cause no fan-out).

**Ledger colouring fixed the same day (no migration).** `TX_TONE` (one colour per KIND) was wrong
for every row that can point both ways; direction now comes from `txFlow = cashDelta + onlineDelta`.
Measured: **15 of 121** real DEV rows were mis-coloured — advance refunds, saving withdrawals,
credit sales, fully-credit purchases, salary advances. `TX_TONE` deleted; do not reintroduce.

⚠️ **The two functions had to move together.** `closing_cash` lives in `finance_report` and the
running balance in `finance_transactions`; a leg in one and not the other breaks
`opening + Σ deltas == closing` with nothing else failing. The opening legs are floored at
`finance_openings.effective_from` like `pur`/`vp`/`sal` (the seed already covers pre-books
movement); the credit legs beside them are unfloored on purpose — do not "make them consistent".

**Estimated profit is now `sales − purchases − salaries − extra expenses`** in the daily PDF. The
dashboard's "Today's profit" tile was left alone: it is `sales − COGS` from `dashboard_stats`, a
different formula, and aligning them is an open decision.

**Verified on DEV (measured, not assumed):** `npx tsc --noEmit` clean; `npm run build` clean
(`/admin/expenses` registered); `node --test` 16/16. With four expenses spanning all three tenders:
split adds to total ✓, categories add to total ✓, each category adds up ✓, two `rent` rows merged
into one 38,000 line ordered biggest-first ✓, closing cash fell by exactly 31,200 and bank by
21,400 with sales/opening/purchases unmoved ✓, **ledger reconciled 0.0000 on both legs** ✓,
carry-forward 0.0000 ✓, a pre-books-dated expense moved neither opening nor closing ✓, and the
PostgREST embed (`restaurant_users!extra_expenses_created_by_fkey`) returns 200 ✓. All test rows
deleted; `finance_report` returns the exact pre-work baseline (22,569.96 / −13,089.84).

**✅ PRODUCTION MIGRATED 2026-08-13.** All **thirteen** pending migrations (`20260811000000` →
`20260815100000`) applied to `qsccnzgrhrnjggyymefr` in one run, 13/13, no failures. The database is
now AHEAD of the deployed app, which is the safe direction — every change is additive (new tables,
appended return columns), so the running build keeps working until the app is deployed.

**How it was verified (measured on production, not assumed):**
- **All six touched functions are byte-identical to DEV** — `md5(pg_get_functiondef())` matches on
  `finance_report`, `finance_transactions`, `check_in_room`, `check_out_room`,
  `record_room_advance`, `close_bill_with_credit`. This is the strongest convergence proof available
  and it also proves no DEV drift escaped the migration files.
- **Nothing moved.** 8 restaurants × 11 figures (opening/closing cash+online, sales, purchases, both
  credit balances, salary, has_opening) snapshotted before and after: **identical**, 0 differences.
- **Ledger reconciles 0.0000** on cash AND bank for all 8 restaurants across **1,316** rows. This is
  also the fan-out proof for `20260815100000`'s three new LEFT JOINs — a duplicated sale row would
  double its deltas and break reconciliation.
- **Every additive identity holds at 0.0000** on all 8: room+table=sales_total, both per-block sales
  identities, advances split, refunds split, sales-advance split, extra-expenses split.
- **1,008 sale rows** all classified and labelled (0 unclassified, 0 unlabelled, 0 `—` fallbacks,
  0 non-sale rows tagged): 861 table / 128 walk-in / 19 room.
- **Discounts now report on real data** — e.g. Shining Crown 94 bills / ₹5,003, Bhairahawa 84 / ₹6,985.
- New tables present with RLS on and `service_role` granted; all 7 `extra_expenses` CHECKs present;
  **PostgREST embeds return 200** (`extra_expenses!extra_expenses_created_by_fkey`, `saving_titles`),
  so the schema cache picked the new relations up without a manual reload.

Pre-flight before applying: confirmed all four `finance_report` rewrites `drop` before `create` (a
return-type change under `create or replace` would have raised `42725`), and that production already
had all 14 columns the new bodies read.

**Remaining:**
1. **Deploy the app** — the DB is ready and waiting.
2. **In-app QA** (now doable on DEV *or* production): add cash / online / mixed expenses; confirm the
   Finance Expenses block and its category lines; correct one and delete one behind the PIN; check
   both appear in Settings → Security activity; confirm a non-admin sees no edit control and a
   `manage_expenses` staffer sees the page but not the pencil.
   Savings: create a pot, file cash/online/mixed into it, rename it, confirm a pot with money
   refuses to delete, and confirm Finance shows one "Saving" line with no pot names.
3. Nothing committed — user drives git.

---

## Earlier feature
**Room advance payments (2026-08-11 → 12) — CODE COMPLETE on DEV, not yet exercised in a browser.**
A deposit taken at check-in (optional section on the check-in form) and again mid-stay from the
folio, deducted from the bill at checkout, refunded if it overshoots, and carried correctly through
cash-in-hand and every report. Spec: `docs/superpowers/specs/2026-08-11-room-advance-payments-design.md`;
plan: `docs/superpowers/plans/2026-08-11-room-advance-payments.md`.

**The money model, which is the whole design.** Cash lands the day the deposit is taken; the SALE
still books in full at checkout. That is the app's existing accrual rule pointed the other way
(credit = sale first, money later; an advance = money first, sale later). Consequence: a **fifth
balance, "advances held"** — guests' money in the till that isn't yours yet — derived exactly like
the two credit balances (`Σ room_advances.amount − Σ payments.advance_amount`, both as-of), so it
carries forward and cannot drift.

**`room_advances.amount` is SIGNED** (positive = taken, negative = refunded). That one decision
removes a refund table, a refund flag, a second code path, and any refund branch in the finance
cash legs — the sums already carry the signs. Held on a stay = `sum(amount)`.

⚠️ **The dangerous change, and the reason it was done in one migration:** `payments.advance_amount`
rewrites the invariant `left on credit = total − (cash+online+card)` into `… + advance_amount`.
Miss one reader and a prepaid bill silently raises debt nobody owes. Moved together:
`finance_transactions` (sale branch + method classifier), `check_out_room` (the credit fork),
`close_bill_with_credit`, `edit_payment_tender` (tender clamped to `total − advance`).
**`credits.down_payment` now INCLUDES the advance** — which is why `finance_report`'s customer-credit
leg (`bill_amount − down_payment`) needed no change at all.

**`dashboard_stats` needed NO change** (it has no cash balance, and `sales_total` still reads the
full bill from one payment row). Stock, purchases, vendors, payroll, bill numbering untouched.

**Migrations (DEV only — user migrates prod):** `20260811000000` table + `payments.advance_amount`;
`20260811000100` `record_/edit_/delete_room_advance` + `check_in_room` (+6 defaulted params);
`20260811000200` `check_out_room` (+`p_refund_cash/online`) + `close_bill_with_credit` (+`p_advance`)
+ `edit_payment_tender`; `20260811000300` `finance_report` (4 new columns, appended) +
`finance_transactions` (new `room_advance` kind); **`20260812000000` `sales_advance`**;
**`20260812100000` the six split columns**. Split into six rather than the spec's one so each
applied and verified on its own.

**Second round of user feedback, 2026-08-12 — the cash/online split.** A mixed deposit reported as
one opaque number: the BALANCES always carried the split (they read `room_advances.cash_amount` /
`online_amount`) but every figure the report *stated* was a bare total. And a refund could only be
all-cash or all-online — even though `check_out_room` has accepted `p_refund_cash` **and**
`p_refund_online` since it was written, so **the mixed refund was a UI-only fix, no migration.**
Now reported split everywhere: `advances_cash`/`_online`, `refunds_cash`/`_online`,
`sales_advance_cash`/`_online`. The Sales identity became
`cash + online + card + advance_cash + advance_online + credit = total`.
The Sales split is keyed on the PAYMENT's date but reads the STAY's rows
(`payments → sessions.room_stay_id → room_advances`), uses the NET rows (so a refund is already
netted — it is cash *retained*, not cash taken), and derives online as `applied − cash` with cash
clamped to `[0, applied]` so the two can never fail to sum to `sales_advance`.
The ledger needed nothing: it already carried per-row cash/online legs and labelled `mixed`.

**Third round, 2026-08-12 — Sales split by source (`20260812200000`).** One "Sales" figure mixed
two businesses. Now `sales_room_*` and `sales_table_*` (cash/online/card/credit/total), room + table
= the plain figure. A payment is a ROOM sale when `payments.room_stay_id` is set **or** its session
carries `room_stay_id` / `room_id` / `type='room_service'` — three markers because `room_id`
survives a session transfer while a creation-time type might not. Measured first: 15 room_service
payments (all with both room columns), 67 table, 1 walk-in, **zero** hanging off
`payments.room_stay_id`. The screen shows **Restaurant sales**, **Room sales** (carrying the
advance lines) and an **All sales** reconciliation block; Room sales and Room advances are gated on
`hasRooms(config.businessType)` via the cached `getRestaurantConfig`, the same gate the sidebar and
`/admin/rooms` use. A restaurant-only client sees one block still headed "Sales".
**The emailed daily PDF splits on the SAME `hasRooms` rule** — `buildDailySummary` now reads
`restaurants.type` inside its existing `Promise.all` (no extra round trip) and carries `showRooms`
on the model. It first gated on room ACTIVITY, which was wrong: a hotel with a quiet day would have
lost its Room block and the emailed report would have disagreed with the screen for the same period.

**Defect found by the user in-app on 2026-08-12, and fixed.** After a checkout the sale did not show
in Admin → Finance → Sales. Cause: the Sales block lists cash/online/card/credit and an advance is
none of those, so a prepaid bill added its full value to `sales_total` while contributing NOTHING to
any row beneath it — **the section silently stopped adding up** (measured on DEV: total 9,500, rows
3,000, gap 6,500). Fixed by `sales_advance` (Σ `payments.advance_amount` in period), which makes the
identity exact: `cash + online + card + advance + credit = total` — exact because
`credits.down_payment` already includes the advance, so the credit leg is the remainder after it.
Verified PASS today and over all history. **Lesson: a new way to settle a bill needs a Sales LINE,
not just a balance leg** — the four checkout-shape tests all passed while this was broken, because
they asserted on `payments` columns rather than on the report the owner actually reads.

**Two traps hit and worth keeping:**
1. `log_security_event`'s `p_target_id` is **uuid**, not text — the plan had `::text`. Checked the
   live signature before writing the call.
2. The live `finance_report`/`finance_transactions` had **already moved on** from migration
   `20260720000000` (mixed-payments replaced `method='cash'` filters with `cash_amount`/
   `online_amount` columns in `crp`/`vp`/`sal`). Both new bodies were built from
   `pg_get_functiondef` dumps, not the repo file — copying the file would have silently reverted
   mixed payments.

**Verified on DEV (measured, not assumed):**
- `npx tsc --noEmit` clean; `npm run build` clean; `node --test` **39/39** (8 new folio-maths tests,
  2 new bill-mapper tests, mock-bill isolation still green).
- Four checkout shapes, **18/18 assertions**: fully prepaid (no credit row), part prepaid, overshoot
  (negative row written, net held = bill), and **credit + deposit** — customer balance moved by
  **2,000**, not 7,000. That last one is the phantom-debt regression.
- Money model: advance day = cash **+5,000** / sales **+0** / held **+5,000**; checkout day = sales
  **+8,000** / cash **+3,000** / held back to **0**.
- **Reconciliation**: `opening + Σ ledger deltas == closing` on cash, bank AND credit, over a period
  containing an advance, a checkout and a refund. This is the only check that catches a movement
  added to one function and not the other.
- Tender-edit clamp: 8,000 on a bill holding a 5,000 advance → `SPLIT_MISMATCH`; 1,000+2,000 accepted.
- **No-advance regression, 7/7**: a room checkout with no deposit writes `advance_amount = 0`, no
  advance rows, and moves cash/sales by exactly the bill.
- **Deploy-window safety**: the deployed app's old 12-name `close_bill_with_credit` and
  `check_out_room` calls still resolve (they reach business logic, not `42883`/`42725`).
- All test data removed; `finance_report` returns the **exact** pre-work baseline
  (closing cash 21,819.96 / sales 86,600 / credit 1,500 / 10,000), advance rows 0.

**Remaining:**
1. **In-app QA on DEV** (needs a login): check in with a deposit; top up from the folio; check out
   above and below the deposit; a credit checkout with a deposit; the printed bill's three lines at
   58mm and 80mm; the folio Advances block on a phone and in the installed PWA.
2. **Access control**: a non-admin sees no remove control; a wrong Security PIN is refused; both
   outcomes visible in Admin → Settings → Security activity.
3. ~~Production migrations pending~~ — **APPLIED 2026-08-13** as part of the thirteen-migration run;
   see the current feature above for the verification. **DB before app** held: the column exists
   before the app that writes it ships.
4. Nothing committed — user drives git.

---

## Earlier feature
**Mock Bill / Demo Bill (2026-08-07) — CODE COMPLETE, not yet exercised in a browser.**
A Security-PIN-gated workspace at `/employee/mock-bill`, reached from a small **M** button on the
staff dashboard, that composes and prints a bill **identical on paper** to a real one while writing
nothing anywhere. For demos, customer previews, training and print-alignment testing.

**The isolation guarantee is structural, not policed** — the reason this design was chosen over the
brief's own suggestion of `mock_bills` / `mock_bill_items` tables. Every figure in this app is
DERIVED from `payments` / `session_order_items` / `purchases` / `stock_adjustments`, so a row that
is never written is invisible to stock, finance, sales, analytics, credits, vendor balances, bill
and OT numbers, push and the daily email — by construction. Mirror tables would instead have
created a permanent "and exclude the mock ones" clause for every future report author. Nothing is
persisted: the draft is React state and dies with the tab.

**The feature's entire server surface is one function that checks a PIN** (`unlockMockBill`). It
constructs no Supabase client, calls no RPC, and imports nothing from
`actions/pos|stock|finance|purchases|credits|notifications|push`. `lib/mock-bill/draft.ts` has zero
runtime imports. `lib/mock-bill/isolation.test.ts` asserts both against the SOURCE (15 tests, all
passing) rather than against behaviour — a write that fires on only one path is what a behavioural
test misses.

**Printing is the SAME component, not a copy.** `BillTicket` + `PrintModal` are purely
presentational, so the mock screen produces props and never renders a ticket line itself. That is
what makes "identical" true by construction and keeps it true when the real bill next changes. The
one distinguishing mark is a trailing **"· M"** on the bill number ("1024 · M"), applied by the
CALLER as a plain string — `BillTicket` never learns mock bills exist. No watermark, no
MOCK/DEMO/TEST anywhere.

**Migration: none.** `security_audit_log.operation` is plain `text` with no CHECK constraint, so
`open_mock_bill` was a one-line addition to the `SecurityOperation` union.

**Files:** `lib/mock-bill/draft.ts`, `lib/mock-bill/isolation.test.ts`, `app/actions/mock-bill.ts`,
`app/(employee)/employee/mock-bill/{page.tsx,_components/mock-bill-client.tsx,_components/mock-bill-editor.tsx}`
(new); `lib/security/authorize.ts` (+1 operation), `_components/bill-ticket.tsx` (+
`grandTotalOverride`, mock-only, undefined for every real caller so real bills are byte-identical),
`dashboard/page.tsx` + `dashboard/_components/staff-dashboard.tsx` (the M button).

**Its own permission: `print_mock_bills`** (group "Mock Billing", label "Print Mock Bills"), ticked
per staff member in the super-admin restaurant detail screen. NOT a rider on `close_bills` — a
receipt indistinguishable from a real one is a distinct act from settling a real table, and a
demo/sales account should be grantable with this and nothing else. **Off every job preset**, like
Payroll. Needed no UI work: `PermissionPicker` renders `PERMISSION_GROUPS` verbatim and
`parsePermissions` validates against `Object.values(PERMISSIONS)`, so `lib/permissions.ts` is the
single source. ⚠️ **Deploy consequence — the gate got NARROWER:** every cashier/receptionist who
could reach mock billing loses the M button until an admin ticks the new box. Owners
(`restaurant_admin`) bypass all checks and are unaffected.

**Six bill states, because "unpaid" is two different documents.** Cash / online / card / mixed /
**unpaid** (the PRE-payment bill, "Status: UNPAID") / **credit** — the latter being an *unpaid bill*
in this app's own vocabulary: closed with money still owed, printing Credit ID, "Credit a/c",
ON CREDIT or PARTIALLY PAID, and BALANCE DUE, with an optional down payment (cash / online /
cash+online). The credit `tendered` is DERIVED from the tender split, exactly as `paid-bill.tsx`
does it, so a mixed down payment can never disagree with the amounts printed beside it; the balance
floors at zero.

**Verified so far:** `npx tsc --noEmit` clean; `npm run build` clean with `/employee/mock-bill`
registered; `node --test lib/mock-bill/isolation.test.ts` 23/23; only the mock editor passes
`grandTotalOverride` (the folio, Sales reprint and session preview pass nothing); an
unauthenticated GET of the route returns `307 → /login`.

**Remaining — in-app QA (needs a login and a Security PIN set on DEV):**
1. **Print parity.** Print a real pre-payment bill to PDF, rebuild it on the mock page, print to
   PDF, diff. The only difference must be the " · M". Repeat at 58mm and 80mm.
2. **Isolation by measurement.** Record `dashboard_stats` / `finance_report` / `stock_report` /
   `restaurants.bill_number_next` / `workstations.ot_next`, run a full mock session with several
   prints, re-read and assert every value is unchanged; check Sales, Credits and the bell.
3. **Access control.** No `print_mock_bills` ⇒ no button and the route redirects; PIN cleared ⇒ same;
   direct URL ⇒ locked shell only; wrong PIN denied; both outcomes visible in Admin → Settings →
   Security activity.
4. **Devices** — phone portrait, tablet, installed PWA: item add/delete/reorder, the print modal
   opening on-screen (not trapped off-viewport), the sticky totals rail.
5. Nothing committed — user drives git.

---

## Parallel track — self-hosted stack (ops, 2026-08-09)
**Outage fixed + made self-healing; cutover gaps partly closed.** The DigitalOcean/Coolify stack
(`lvs0ylfrwhzhnrsinuobbqt8`) served nothing externally while all 14 containers were healthy:
`coolify-proxy` was not attached to the stack's Docker network, so Traefik had a router but no path
to Kong. Root cause was the proxy container being **recreated 2026-08-06 / started 2026-08-07** and
coming back without this network. Full write-up in `decisions.md`.

**Done:** reconciler installed (`/usr/local/bin/coolify-proxy-net-reconcile.sh` +
`coolify-proxy-net.timer`, boot + 5 min, only networks with a `traefik.enable=true` container,
idempotent) — **verified by detaching the proxy and watching it self-heal**, `/pg/query` back to
`200`. Migration `20260806000000` applied (ledger 76/76, RLS on, anon/authenticated zero).
`pg_cron` 1.6 extension installed.

`pg_cron` 1.6 extension installed, and the **daily-summary job is wired and PARKED**: vault secrets
set, `daily-summary-emails` scheduled `*/15 * * * *`, `active = false`, with `app_base_url` deliberately
pointed at `https://REPLACE-AT-CUTOVER.invalid`. Two interlocks on purpose — the droplet's
`report_deliveries` dedupe is per-database, so a job aimed at the live app would **re-send daily
reports real owners already had**. At cutover: set the real URL, then `cron.alter_job(…, active := true)`
(a plain `update cron.job` is permission-denied as `postgres`).

**Structure parity is 100% clean** against production — 46 tables, 452 columns, 65 enum labels, 57
functions, 223 constraints, 158 indexes, 33 triggers, 322 grants. The 18 parity failures are purely
DATA (stale snapshot), so a re-clone is sufficient; `clone-db --dry-run` resolves 15,139 rows.

**Open before cutover:**
1. ~~NO TLS~~ — **FIXED 2026-08-10.** Let's Encrypt cert via Traefik's file provider
   (`/data/coolify/proxy/dynamic/lvs0-supabase-tls.yaml`), zero downtime, no containers recreated;
   `.env.production001` moved to `https://`. Remaining: pick the **production domain** (sslip.io is
   fine for a migration target, not for production) and optionally add an http→https redirect.
2. ~~Realtime / `SUPABASE_DB_URL` gate~~ — **CLOSED: not an issue.** App and database move to DO
   together, so the Docker-internal hostname resolves and `lib/realtime/bus.ts` works untouched. Only
   a hybrid (Vercel app + DO database) would have broken it.
3. ~~Data re-clone~~ — **DONE 2026-08-10.** 15,139 rows cloned + 4 storage objects with `logo_url`
   repointed; `verify-parity` returns **ALL CHECKS PASSED**, including all 24 derived-value checks
   (6 restaurants × dashboard_stats/finance_report/finance_transactions/stock_report) — the only
   check that catches a mangled relationship. Droplet now reads restaurants 6 / payments 848 /
   users 42, matching production. ⚠️ **Do not run `clone-db --reset` again once the trial customer
   is onboarded — it empties the destination.**
4. **Nightly backups now exist** (`restrosewa-db-backup.timer`, 21:15 UTC = 03:00 Nepal, 14 kept,
   each dump verified with `pg_restore --list` before rotation). Previously the ONLY backup on the
   droplet was Coolify's own database. **Same-disk only** — pair with DigitalOcean snapshots.
5. **Sizing** — user chose to keep 3.9 GB / 2 vCPU despite 3.7 GB swap and load ~5.5. Note this will
   make a trial customer's performance look worse than DO really is (two Supabase stacks + Coolify).
6. **Rotate `GMAIL_APP_PASSWORD`** — exposed in a diff during the TLS work on 2026-08-10.

*Skipped by decision:* the Coolify UI redeploy (1a) — superseded by the reconciler; fold into cutover.

### Restaurant moved self-hosted → hosted production (2026-08-10)
**"Hotel GlasGow In & Restaurant"** (`a8177433-e9ea-45a3-869f-4eb7dbab752a`) was onboarded on the
**DigitalOcean stack**, not on dev and not on production — so the live app could not see it. All
**87 rows** were copied to hosted production (`qsccnzgrhrnjggyymefr`) with every primary key
preserved: 6 `auth.users` + 6 `auth.identities`, the restaurant, 6 staff, 2 table groups, 8 tables,
4 room types, 18 rooms, 24 `restaurant_user_room_types`, 12 `restaurant_user_table_groups`.
It has **no menu items, no products and no workstations** — those still have to be built in the
live app before it can take an order.

Why it was a plain insert and not `clone-db.mjs`: that script is whole-database, and it *refuses*
to write to production by design. This was a scoped, additive, single-transaction copy instead.

Points worth keeping:
- **No `session_replication_role = replica`** — we are not superuser on hosted Supabase. Checked
  first that the only triggers on the destination tables are the `rs_notify_change()` NOTIFY pair,
  which rewrite nothing, so FK insert order was the only thing carrying correctness.
- **`postgres` on hosted Supabase CAN insert into `auth.users` / `auth.identities`.** Copying the
  bcrypt hash means all 6 staff PINs work unchanged and no password was ever seen or reset.
- **The destination being a real `pg` connection bought a whole-run transaction**, which the HTTP
  shim cannot give (each request is its own connection) — worth having against a live database.
- ⚠️ **Both databases now hold this restaurant with the SAME primary keys.** If the customer trades
  on the DO stack *and* on production they diverge silently, and a cutover `clone-db --reset`
  overwrites whichever side is behind. Pick ONE side for this client now.

**Verified:** every one of the 10 relations hashes IDENTICAL to the source (server-side `md5` over
`to_jsonb` per row under UTC, so nothing passes through a JS type); `dashboard_stats` and
`finance_report` execute on production for the new id and return zeros, correct for a restaurant
with no history; 8/8 QR tokens intact; all 6 `emp-<id>@restrosewa.internal` logins present with a
password hash. *Note for next time:* a first pass compared JS values and reported 9 tables as
differing — that was node-postgres parsing `timestamptz` into a millisecond `Date` while the HTTP
shim returned all six digits as a string. **Never diff two databases through JS date values.**

⚠️ **Do not diagnose the next "degraded" from the symptom.** A bare `404 page not found` is
Traefik's default body and matched two completely different causes on 2026-08-03 and 2026-08-09.
Triage order is in `decisions.md`.

---

## Previous feature — shipped
**Workstation reporting: Purchases by station + a new Deduction Report (2026-08-06).**
Shipped to production 2026-08-07 (`d59af56`); full write-up moved to `completed.md`. Nothing left.

---

## Earlier feature — shipped
**Product ↔ Workstation mapping (2026-08-06) — CODE COMPLETE, verified on DEV.**
Products had no station while menu items always have had one, so Stock was a single
undifferentiated list. Added `product_workstations` (M2M, `restaurant_id` carried) +
`set_product_workstations` (whole-set replace, cross-tenant station ids filtered out), a
multi-select on the product form, station-grouped listing and a **client-side** station filter
(zero round trips — `rows` already holds every product).

**The load-bearing claim, and how it was proved:** this is metadata, not mechanism.
`set_product_workstations` is the ONLY DB object referencing the table (checked via `prosrc`), and
`stock_report` returns byte-identical output with stations cleared, set, and reassigned. Nothing in
the deduction path changed.

**Design rule recorded in `modules/stock.md`:** station-level POS consumption was *already*
derivable from `session_order_items.workstation_id`, so this mapping's real value is purchases and
waste (which had no path to a station at all). Usage reports must key on the MENU ITEM's station,
purchases/waste/holding on the PRODUCT's station — they can disagree.

Files: `supabase/migrations/20260806000000_product_workstations.sql` (new), `app/actions/stock.ts`,
`app/(admin)/admin/stock/_components/stock-client.tsx`, both stock pages, `types/database.ts`.

**Verified on DEV in a browser:** legacy products render under Unassigned with unchanged figures;
create with two stations lists under both; edit assigns and clears; the filter fires **0 fetch
calls**; a group split across a page boundary repeats its header on page 2; mobile (375px) and the
employee surface both correct; a `view_stock`-only user sees grouping + filter but no write
controls. DB-level: cross-tenant station id dropped, workstation delete cascades instead of
blocking, `delete_product` still works on a product that has stations. `tsc` and `build` clean.
Dev data was restored afterwards (test product deleted, all assignments cleared).

**Remaining — ops only:** none. `20260806000000` was applied to production on 2026-08-07 (see the
current feature above for the verification). Note for next time: the app shipped BEFORE the
migration for about a day, and it degraded quietly everywhere that only READS the mapping
(`?? []` → everything reads as Unassigned) but not on `updateProduct`, which always calls
`set_product_workstations` and so showed "Saved the product, but its workstations didn't change" on
every product edit. **DB before app** for anything with a write path.

⚠️ `npm run lint` is misleading in this repo: the flat config has no `files` key, so ESLint 10 skips
every `.ts`/`.tsx` file and only lints `.next/` build output (~2000 pre-existing errors). Unrelated
to this change, but don't read it as coverage.

---

## Earlier feature — shipped
**Room billing unification (2026-08-04 → 05) — CODE COMPLETE.** Guest identity at check-in, and the
room bill rendered through the shared `BillTicket` so the document is the same before and after
payment. Full write-up in `completed.md`; design + plan in
`docs/superpowers/{specs,plans}/2026-08-04-room-billing-unification*`.
**Remaining — ops only:**
1. `node scripts/migrate.mjs up --prod --yes` (migrations `20260804000000`, `20260804010000`).
   Additive, every new RPC parameter defaults, so the DB can go **before** the app; rolling the app
   back alone is safe because the old argument lists still resolve.
2. Deploy, then on the live hotel client ("Sanjib") check one guest in with an ID, check them out
   with a small discount, and confirm `payments.discount_amount` and the Sales bill.
**Verified on DEV end to end:** check-in → room-service order → extra charge → unpaid bill →
mixed checkout with a ₹180 discount → the same bill in Sales. Lines 1500 + 300 + 380 = 2180,
less 180 = **2000 = `payments.total_amount`**. A pre-existing stay with null identity columns still
renders (no ID line, no crash) and now shows its room charge for the first time. A paid **table**
bill is unchanged. `tsc`, `lint`, `build`, `node --test` all clean.
Follow-up in the same batch: the folio now prints a **receipt** after checkout (PAID + tender +
cashier, or PARTIALLY PAID + BALANCE DUE on credit) instead of "Status: UNPAID", and its panel
totals include the recorded discount. Verified across cash, mixed and credit; a live stay still
prints BILL / UNPAID. Then: the room discount now requires the **same** discount PIN as a table
(it had only the permission check), the Cash + Online split auto-fills, and the room page reads the
cached `getRestaurantConfig` instead of its own `restaurants` select.

---

## Earlier feature — shipped
**Thermal printing fixes (2026-08-03).** Six reported defects in printed KOT/BOT/bill output reduced
to **three** real causes. Every receipt in the app goes through one `PrintModal`, so the fixes land
on the session bill, station tickets, room folio bill and credit receipt at once.

**A. Short tickets printed SIDEWAYS.** `@page { size: <w> <h> }` takes no orientation keyword — the
larger value decides. `measureAndSetPage` emitted the paper width × *measured content height*, so a
one-item KOT produced `80mm × 62mm`, i.e. **landscape**, and the browser rotated it 90°. A bill
measured `80mm × 93mm` and came out upright **from the same line of code**. Verified by rendering
both tickets in a real browser: KOT 216px→62mm, bill 335px→93mm. Fixed by clamping
`heightMm = Math.max(contentMm, paperWidthMm + 1)`. Cost: a tiny ticket now feeds ~81mm. There is no
way to ask for "portrait, shorter than wide", and `size: 80mm auto` is invalid CSS that is dropped
wholesale (the Letter fallback the old comment describes).

**B. The "duplicate date/time/branding" and the URL + `1/1` are the BROWSER's print header/footer.**
`app/layout.tsx:20` sets `title: "HRestroSewa"`; Chrome prints date+title at the top and URL+page
number at the bottom. **No stylesheet can remove them.** Code-side lever: the `@page` rule (with
`margin: 0`) now lives in a `<style>` created via `document.createElement` in `<head>` instead of a
React-rendered one inside the portal — React can never reconcile it away, and a zero page margin makes
Chrome default Margins to "None". The rest is a one-time dialog setting, now surfaced as an
`rs-no-print` hint beside the Print button.

**C. Wasted height** was partly ours (logo, 8px divider margins, line-height 1.45, and a preview
padding that differed from print padding so preview ≠ print) and partly the printer's paper size.
Ours is fixed: one-item bill 93mm → **85mm**.

Also removed the logo from all printed receipts (thermal heads are one-bit — a logo smears), split
`Date` into `Date` + `Time`, moved `PoweredBy` under a divider as a footer block, and fixed a real
data bug: `getCreditReceipt` ran its own 4-column query and so never read
`settings.print_paper_width`, silently printing credit receipts at 80mm for 58mm restaurants. It now
uses the shared cached `getRestaurantConfig`.

Files: `app/(employee)/employee/_components/bill-ticket.tsx` (engine + bill + credit ticket),
`session/[id]/_components/print-tickets.tsx`, `room/[stayId]/_components/folio-client.tsx`,
`credits/_components/credit-receipt.tsx`, `app/actions/credits.ts`.

**Remaining:** in-app QA on a real thermal printer at both 58mm and 80mm — especially that a
one-item KOT now comes out portrait. `tsc --noEmit` is clean.

---

## Previous task — awaiting cutover
**Migration to self-hosted Supabase on DigitalOcean (Coolify).** Schema, all production data and the
superadmin login now exist on the new stack
(`supabasekong-lvs0ylfrwhzhnrsinuobbqt8.139.59.237.233.sslip.io`, `.env.production001`,
**PostgreSQL 15.8** vs production's 17.6). Schema is built by replaying the repo's 72 migrations
rather than restoring a dump, so the new server's ledger is truthful from day one.
**Nothing is cut over yet** — production is still live and still taking orders.

## Files involved
- `scripts/lib/pg-http.mjs` — NEW. A `pg.Client`-shaped transport over Kong's `/pg/query`
  (postgres-meta, connects as `supabase_admin`/superuser). The self-hosted Postgres has no published
  port and a Docker-internal hostname, so this is how *everything* reaches it — no SSH, no exposed
  database port. Its one constraint: **no bind parameters**.
- `scripts/migrate.mjs` — added `--env <file>`, `--http`, `--no-ssl`. Each migration + its ledger row
  now go in ONE statement string, because under `--http` a transaction cannot span requests.
- `scripts/clone-db.mjs` — NEW. Data copier: FK-topological order, `session_replication_role =
  replica`, rows travel as dollar-quoted JSON through `jsonb_populate_recordset`. `--reset --yes`
  empties the destination for a retry.
- `scripts/copy-storage.mjs` — NEW. Moves Storage *bytes* (copying `storage.objects` rows alone
  yields broken links) and repoints `restaurants.logo_url`.
- `scripts/verify-parity.mjs` — NEW. Structure + row counts + derived values, both sides.
- `supabase/migrations/20260721000001_restaurants_type_check.sql` — NEW (split out of `…000000`).
- `supabase/migrations/20260801000000_service_role_grants.sql` — NEW.
- `supabase/migrations/20260801000001_lock_down_anon_access.sql` — NEW.
- `next.config.ts` — image `protocol` now derived from the URL (the new host is `http://`).
- `lib/realtime/bus.ts` — TLS now comes from the connection string (`?sslmode=disable`) instead of
  being hardcoded on, because the self-hosted Postgres runs with `ssl = off`.
- `.env.example` — documents quoting + `sslmode`.

## Completed
- **Repaired the Coolify stack and REBUILT the database from scratch (2026-08-03).** A redeploy had
  re-initialised the Postgres volume and destroyed the first copy; see Notes for the root cause. The
  stack now runs all 15 containers healthy, and the database was rebuilt and re-verified end to end.
- 73 migrations applied to the new server. `20260801000000` + `20260801000001` also applied to DEV.
- **Verified identical to production**: 45 relations, 445 columns, 65 enum labels, 56 functions,
  218 constraints, 156 indexes, 33 triggers, 315 grants — and all **28 derived-value checks**
  (`dashboard_stats`/`finance_report`/`finance_transactions`/`stock_report` × 7 restaurants) return
  identical output. Derived values are the check that proves relationships survived; row counts
  alone would not.
- 8,935 rows copied (42 `auth.users`, 42 `auth.identities`, 8,851 public across 44 tables) — the
  count grew because production kept trading; it is a fresh snapshot, not the earlier one.
- Superadmin `admin@restrosewa.com` present with the **same user id and a byte-identical bcrypt
  hash** — the existing password works, and it was never seen, typed or reset. All 42 logins carried
  over, so every staff PIN is unchanged too.
- 4 logos copied, `logo_url` repointed, verified served from the new host (200, correct bytes).
- `anon` verified BLOCKED (`42501 permission denied`) where the self-hosted image had given it full
  CRUD on every table.
- `tsc --noEmit` and `eslint` clean.

## Remaining
0. **DO NOT REDEPLOY THE STACK FROM COOLIFY until the `is_directory` flags are fixed.** Ten rows in
   Coolify's own `local_file_volumes` table still say `is_directory = true` for paths that must be
   FILES; a redeploy will try to recreate them as directories and re-break the stack. The one
   statement that fixes it permanently is in Notes.
1. **Delta re-sync at cutover.** Production is LIVE and still trading. The copy is a point-in-time
   snapshot. At cutover: freeze production, re-run
   `clone-db.mjs --env .env.production001 --http --reset --yes`, then `verify-parity.mjs`.
2. **`pg_cron` daily-summary job is NOT recreated on the new server.** Needs `pg_cron` + `pg_net` +
   `supabase_vault`, vault secrets `app_base_url` (new URL) and `cron_secret` (`CRON_SECRET` is
   unchanged between the env files), then the `daily-summary-emails` job — schedule `*/15 * * * *`,
   NOT hourly (pg_cron runs in GMT; see the Daily Finance Report entry in completed.md). Do it only
   once the app is deployed at the new base URL, or it fires into nothing.
3. **`lib/realtime/bus.ts` — SSL fault FIXED, hostname fault REMAINS.** The droplet's Postgres
   reports **`ssl = off`** (measured), and the file used to hardcode
   `ssl: { rejectUnauthorized: false }`, so node-postgres would have thrown *"The server does not
   support SSL connections"*. TLS is now read from the connection string via libpq's `sslmode`:
   default stays ON (hosted Supabase requires it and carries no sslmode), `?sslmode=disable` turns
   it off. Still open: `SUPABASE_DB_URL` is a **Docker-internal hostname**, so the listener only
   resolves if the Next.js app runs inside that same Docker network. Failure mode is SILENT — live
   updates stop, dashboards fall back to slow polls, nothing on screen says so. (The SSE `ready`
   event already carries `listening: false`, but no client consumes it yet.)
4. `.env.production001` now quotes `SUPABASE_DB_URL` and carries `?sslmode=disable`. DONE.
5. Nothing committed this session; user drives git.

## Risks
- **Two live databases.** Until the old project is frozen/decommissioned, writes can land in both.
- The new server is *ahead* of hosted production by two migrations (`20260729100000_security_pin`,
  `20260729200000_custom_items`) which were still pending there. Cut over rather than running both.
- PG 15.8 vs 17.6. No migration uses 16/17-only syntax (checked), and every parity check passes, but
  the version gap is real and worth remembering.

## Notes
- **"Degraded (unhealthy)" was a DATA BUG INSIDE COOLIFY, and no redeploy could ever have fixed it.**
  Ten rows in Coolify's `local_file_volumes` table carried `is_directory = true` for paths that must
  be files (`volumes/api/kong.yml`, the seven `volumes/db/*.sql`, both `volumes/functions/*/index.ts`).
  Coolify therefore created **directories** at those paths — and once a directory occupies a path,
  writing a file there fails forever, so the stack could never self-heal. The sibling stack
  `dv5eg4tzjaj4nhimc315gypj` on the same droplet has the identical rows set to `false`, which is what
  made the diagnosis certain. Consequences chained: `_supabase.sql` never ran → no `_supabase`
  database → Logflare crashed (`3D000 invalid_catalog_name`) → `analytics` never healthy → every
  service gated behind it sat in `Created`; `kong.yml` as a directory → Kong had no routes → the bare
  `404 page not found` on every endpoint; `functions/*/index.ts` as directories → edge functions dead.
  Two more files (`entrypoint.sh`, `volumes/api/kong-entrypoint.sh`) were written without the execute
  bit, which is the `exec: "/entrypoint.sh": permission denied` the user saw.
  **Fixed by** copying the ten templates from the healthy stack (they are pure `$VAR` templates — no
  secrets, no stack-specific values, verified), `chmod +x` on the two scripts, deleting the
  half-initialised DB volume so initdb re-ran properly, and `docker compose up -d`.
  **STILL TO DO — the durable half.** The ten flags are unchanged, so the next Coolify redeploy
  re-breaks it. Run on the droplet:
  ```
  docker exec coolify-db psql -U coolify -d coolify -c "update local_file_volumes set is_directory=false where is_directory and fs_path like '/data/coolify/services/lvs0ylfrwhzhnrsinuobbqt8/%' and fs_path ~ '\.(yml|sql|ts)$'"
  ```
  Post-deploy sanity check, since this failure looks exactly like a health-check flake — any mounted
  path that is a directory but should be a file:
  `find /data/coolify/services/<id> \( -name '*.yml' -o -name '*.sql' -o -name '*.ts' \) -type d`
- `cron.database_name = postgres` and the scheduler is running, but `pg_cron` is **not yet created**
  in that database — so Remaining #2 starts with `create extension pg_cron`.
- **`anon` had full CRUD on every table on the self-hosted stack.** Hosted Supabase grants it
  nothing; the self-hosted image ships `alter default privileges` granting `arwdDxt` to
  anon/authenticated from TWO grantor roles. Three tables also had no RLS. Since the anon key ships
  in the client bundle, that combination was exploitable — closed by `20260801000001`.
- Superadmin passwords were migrated by **copying the bcrypt hash**, which is portable between
  servers. Never ask for or reset a password when the hash can move.
- Previous task (**Assignment-scoped Staff Dashboard**) is code-complete and moved to
  `completed.md`; its outstanding user actions were: deploy, assign the 4 affected staff
  (Shining Crown `Cashier`; siddhatha `bijay`/`shivam`/`shubham`), and in-app QA.
- ~~Still pending USER ops on HOSTED production: **Security PIN** + **Custom items** migrations~~
  **DONE** — verified 2026-08-03: production has 70 of 73 applied; the only 3 pending are
  `20260721000001`, `20260801000000`, `20260801000001`, and all three were measured to be **no-ops
  against production's current state** (constraint present, service_role already on 45/45 relations,
  RLS already on all three tables, anon/authenticated hold no privileges). Superseded line kept for
  history:
  (`node scripts/migrate.mjs up --prod`) — moot if cutover happens first.

---

### Template (reset to this when idle)
```
## Current Feature
(none — idle)
## Files involved
## Completed
## Remaining
## Risks
## Notes
```

---

## Droplet resource audit + duplicate cleanup — 2026-08-19

Full sweep of `139.59.237.233` (4 vCPU / 7.8 GB / 154 GB, 34 containers, 8 Coolify apps).

**No duplicate deployments.** All 8 Coolify apps are distinct (PragyaOS ×4, Gantabya ×3,
Hrestrosewa Web ×1). Disk is a non-issue at 21%.

**RAM is the constraint, and the school's Supabase stack is the hog** — `dv5eg4…` uses
**1448 MiB across 14 containers**, more than half of all container memory, vs 517 MiB for our
whole `hrs` stack. Its optional services alone are ~590 MiB (logflare 268, studio 160,
supavisor 86, minio 75). **33 of 34 containers have no memory limit** and swap is ~1.8 GB and
creeping — that is the real stability risk, not disk.

**Three copies of RestroSewa data existed:**
1. `hrestrosewa` — the correct rebuilt one. Kept.
2. 42 keyless tables in the school's live `postgres` DB — several loaded **literally twice**
   (`menu_items` 1450 = 2×725, `menu_item_variants` 596 = 2×298, `menu_categories` 222 = 2×111,
   `credits` 114 = 2×57). **NOT deleted — still needs the PragyaOS owner's sign-off.**
3. The orphaned `lvs0ylfrwhzhnrsinuobbqt8` Supabase cluster — Coolify had already forgotten the
   service but left 3 volumes, `/data/coolify/services/lvs0…/` and a **stale Traefik router**.
   Its DB was an Aug-10 snapshot proven to be a **strict subset** of `hrestrosewa`. **Deleted**
   after dumping to `/data/backups/lvs0-orphan-cluster-final-20260819.sql.gz` and archiving the
   service dir. `tm_verify_091244` looked like a dupe of `travel_management` but is not — same
   schema, genuinely different data; left alone.

**Reclaimed ~750 MB**: orphan volumes, dead service dir + stale router, a byte-identical duplicate
backup (`…142341` = same md5 as `…142308`), the broken 112-byte storage tar (`./undefined/` — the
pre-fix volume-prefix bug), unused build cache (225 MB), journal 343→180 MB. Six uncompressed
pre-rebuild dumps were gzipped rather than deleted. Verified after: all 34 containers Up, Traefik
healthy, 8 restaurants / 6 storage objects / 60 users unchanged, both sites 200.

**⚠️ Open — Traefik ACME failure loop.** 53 failures in 24h for
`supabase.hrestrosewa.leafclutch.com.np`. `hrs-kong` still carries
`traefik.http.routers.https-hrs-kong.tls.certresolver=letsencrypt`, but the **no-DNS decision**
means that name has no A record → NXDOMAIN forever, burning Let's Encrypt quota on the shared
account. Fix: drop the three `traefik.*` labels from `hrs-kong` and recreate it (free — not cut
over yet), or add the DNS record.

**Also left alone deliberately:** 622 MB of older app images (Coolify's rollback targets); the
journal still has no `SystemMaxUse` cap so it will regrow (setting it needs a journald restart).

### ⚠️ `.env.production001` targets PragyaOS's live DB — 2026-08-19

`SUPABASE_DB_URL` there is `…@supabase-db-dv5eg4tzjaj4nhimc315gypj:5432/postgres`. That database is
**PragyaOS's production database**, not a RestroSewa one — the "PragyaOS api" container runs the
same `DATABASE_URL`, and pg_cron/pg_net/realtime/storage all hold connections. It must never be
dropped. Confirmed with the user 2026-08-19: **the database stays.**

The RestroSewa footprint inside it (42 keyless tables + the `order_item_consumption` view, 1.6 MB)
was verified as a self-contained island — all 42 names exist in `hrestrosewa`, **zero** FKs point
into the set from outside, last write 2026-08-09. Dumped to
`/data/backups/pragyaos-restrosewa-leftovers-20260819.sql.gz`. **Decision: left in place** pending
the PragyaOS owner's sign-off; nothing reads them, so there is no urgency.

Method note: an earlier count of "2 dependent FKs" was a query bug — matching `pg_class.relname`
without the schema caught GoTrue's `auth.refresh_tokens → auth.sessions`. Match dependency queries
on OID/`regclass`.

### DO deployment verified end-to-end — 2026-08-19

Public hostname is live: **`supabase.testhrestrosewa.leafclutch.com.np`**. No DNS record was added —
the zone already had a wildcard `*.testhrestrosewa.leafclutch.com.np` → 139.59.237.233. Switching
`SUPABASE_DOMAIN` in `/data/hrestrosewa/.env` (it drives both Traefik router rules AND GoTrue's
`API_EXTERNAL_URL`) + `docker compose up -d` recreated only hrs-kong and hrs-auth.

Verified after the app rebuild:
- **Logos render.** `/_next/image` returns 200 (`image/png` 6,394 b at w=256; `image/jpeg` 85,718 b
  at w=640). The old failure was Next 16's private-IP guard, not `remotePatterns` — confirmed
  `isPrivateIp("139.59.237.233")` false vs `isPrivateIp("10.0.1.17")` true. No
  `dangerouslyAllowLocalIP` needed. All 6 `logo_url` rows repointed.
- **Realtime bus connects.** SSE `ready` → `{"listening":true}`, and a full round trip works:
  `pg_notify('rs_events', {"r":…,"t":"orders"})` → `event: change {"topic":"orders"}` on the stream.
  Payload keys are **`r`/`t`**, not `restaurant_id`/`topic`.
- **Security from the public internet**: no key 401 · anon on tables 401 · anon `/pg/query` 403 ·
  signup 422 · public logo object 200 · http→https 302.
- **ACME loop is dead** — 0 failures in the last 5 min; the cert is in `acme.json`.
- 34/34 containers up, 8 restaurants / 6 logos / 60 users, memory down to 2.8 GB used.

Still gated on the user: the freeze + `clone-db --reset` (Cloud is ~119 sessions / 229 orders /
108 payments ahead; DO holds 12 test sessions that a reset would wipe).

### Repo cleanup — 2026-08-20

**Removed as dead:**
- `@playwright/test` — no config, no `.spec.ts` anywhere, zero imports.
- `tsx` — in no npm script and never imported. Verified all **110 tests in 10 files pass under
  plain `node --test`**, so nothing needed it.
- `components/ui/card.tsx` — nothing imported it; `stock-finance-overview.tsx:26` and
  `mock-bill-editor.tsx:64` each define their own local `Card`.
- `components/pwa/push-toggle.tsx` — the only reference was its own export.
- `.env.production001` — it pointed at **PragyaOS's live database** (backed up to the session
  scratchpad before deletion).

**Repointed the dangerous references.** `scripts/migrate.mjs`, `clone-db.mjs`, `copy-storage.mjs`,
`verify-parity.mjs`, `docs/menu-import.md` and `docs/runbooks/migrating-to-production.md` all still
named `.env.production001` as the DO target — following them would have run migrations against the
school's production DB. All now say `.env.hrestrosewa`. `copy-storage.mjs`'s "still name the
tunnelled env file" note is also gone: `--http` works end to end now, no SSH tunnel anywhere.

**Added** `npm test` → `node --test "lib/**/*.test.ts"`. The quoted glob matters — Node expands it
internally, so it works on Windows where the shell would not.

Verified after: `npm test` 110/110 pass · `npx tsc --noEmit` clean · `npm run build` exit 0.

**Known and NOT actioned (user's call):**
- ⚠️ `scripts/deep-structure.mjs` (untracked) has the DO Postgres **password hardcoded at line 36**.
  Safe only while it stays untracked — a `git add .` puts it in history permanently.
- 13 dependencies are pinned to `"latest"` (including `next`, `react`, `@supabase/ssr`) — builds are
  not reproducible and a breaking release lands silently on the next install.
- `memory-bank/current-task.md` is ~86 KB; completed sections belong in `completed.md`.

---

## Individual 30-day salary cycles + attendance-ready foundation — 2026-08-20

Payroll was calendar-month only: `staff_salaries.effective_from` and
`salary_payments.salary_month` were CHECK-pinned to the 1st, everyone got a full month's salary the
moment the month ended, and attendance did not exist. Each staff member can now have their own
fixed-length cycle, and salary is payable-days × daily-rate.

**Migration `20260824000000_salary_cycles.sql`.** New tables `salary_cycles` and
`staff_attendance_days`; `staff_payroll` gains `cycle_anchor_date` + `cycle_length_days`;
`salary_payments` gains `cycle_id`; the `staff_salaries_month_start` CHECK is dropped so a revision
can start on any day.

**Why a cycle is STORED when everything else here is derived.** "July 2026" means the same thing
forever, so month-keyed state can be derived safely. A per-staff cycle cannot: move the anchor and
every past boundary moves with it, stranding payments in periods that no longer exist. The *period*
is therefore a stored fact; payable/paid/remaining/status inside it stay derived.

**The attendance seam.** `staff_attendance_days` stores **exceptions only** — a day with no row is
fully present, so ten absences are ten rows. `payable_days = Σ coalesce(day_fraction, 1)`. A future
attendance module writing explicit `present` rows at fraction 1.0 changes no total, which is the
whole forward-compatibility claim. `status` is text-with-a-check, not an enum, so the list can grow.

**finance_report was NOT touched** — deliberately. It calls `payroll_summary()` for
`salary_outstanding` and reads `sp.salary_month` as a ledger label, so keeping `salary_month`
populated and `payroll_summary`'s signature stable meant zero changes there. Only `payroll_summary`'s
`owed` CTE moved: cycles first, plus any calendar month **no cycle covers**, so nothing is
double-counted and an uncycled month still shows as owed.

**`record_salary_payment`'s overpay ceiling now reads the cycle's payable amount**, not the headline
salary — otherwise a cycle with 10 absences would accept a full month's pay and report a negative
remaining. Mixed cash/online split logic is unchanged.

**Neutrality proven on real data.** DO (a full copy of production payroll) before and after:
Bhairahawa owed 22,800.00 / paid 21,200.00, Sanjib owed 30,000.00 / paid 50,000.00 — identical.
Backfill created 8 `calendar_month` cycles at real month lengths (31d for Jul/Aug) and linked
**10 of 10** payments. DEV likewise 80,000.00 → 80,000.00.

**App layer.** `lib/payroll.ts` gained pure cycle maths (`addDays`, `daysBetween`, `cycleFor`,
`cycleContaining`, `payableDays`, `dailyRate`, `payableAmount`, `dayLabel`, `cycleLabel`) — all UTC
epoch arithmetic, never a local `Date`, or a boundary shifts for anyone east of UTC.
`lib/payroll.test.ts` covers it (23 tests; suite now 133). New actions: `getPayrollCycleSheet`,
`getCycleAttendance`, `setAttendanceDay`, `verifyCycleAttendance`, `setCycleAnchor`. New component
`_components/salary-cycle-panel.tsx` (grid + cycle-start form) kept out of the 900-line
payroll-client. **The payroll screen is now keyed to a DAY, not a month** — each person may be on
their own window, so the stepper picks a date and every row shows the cycle running on it.

⚠️ **`dailyRate` is deliberately unrounded**; money is always `round(snapshot × payable ÷ total, 2)`.
Rounding the rate would make a fully-worked ₹25,000 cycle pay ₹24,999.90 forever.

⚠️ **`set_staff_salary` also overwrites `joining_date`** (`on conflict … do update set joining_date`).
Passing a wrong joining date silently changes the liability walk — it cost 25,000 of phantom
liability on DEV during testing before it was spotted and restored.

**Applied to DEV and DO. NOT applied to hosted PRODUCTION** — that is the user's deploy call:
`node scripts/migrate.mjs up --prod --yes`.

---

## 2026-08-21 — Production → DigitalOcean data transfer (the cutover copy)

`prod → hrestrosewa` full data transfer, verified end to end. **`verify-parity.mjs`:
ALL CHECKS PASSED.**

### Two blockers found and fixed before any data moved

**1. `--http` migrations create tables with no grants.** Kong's `/pg/query`
(postgres-meta) connects as `supabase_admin`, but every `pg_default_acl` rule on that
database — including the one `20260801000000_service_role_grants.sql` wrote — is filed
under `postgres`. Default privileges are per-granting-role, so a table created over
`--http` matched no rule and came out with `relacl = NULL`:

    extra_expenses         owner=postgres        service_role=arwd   ← tunnel era
    salary_cycles          owner=supabase_admin  relacl=NULL         ← --http era
    staff_attendance_days  owner=supabase_admin  relacl=NULL         ← --http era

That is the exact failure `20260801000000` exists to prevent, re-entering through a door
that did not exist when it was written. It also left those tables unmaintainable over the
SSH tunnel, which connects as `postgres` — and postgres cannot `ALTER` a relation owned by
supabase_admin.

Fixed by **`20260824100000_service_role_grants_http.sql`**: reassigns every public relation
to `postgres`, re-grants to `service_role`, and files an `alter default privileges` rule
under whichever role applies it, so it self-heals over either route. Verified a no-op on
hosted production (53 relations already postgres-owned, grantees still exactly
`postgres` + `service_role`, liabilities unchanged at 22,800 / 30,000).

**2. PostgREST's schema cache never reloads on the droplet.** Hosted Supabase ships
`pgrst_ddl_watch` / `pgrst_drop_watch`; the droplet has **zero** event triggers. So
`salary_cycles` and `payroll_cycle_sheet` returned `PGRST205 / PGRST202 Could not find …
in the schema cache` from a database where they plainly existed. `scripts/migrate.mjs`
now sends `notify pgrst, 'reload schema'` after a successful `up` — redundant on hosted,
essential on DO.

### The transfer

| step | result |
|---|---|
| `clone-db.mjs --reset --yes` | **29,867 rows** across 51 public tables + auth |
| `copy-storage.mjs` | 6/6 logos, 6 `logo_url` repointed, all fetch 200 at the exact byte counts |
| `verify-parity.mjs` | 8/8 structure · all row counts · **32/32 derived values** |

The derived-value checks are the ones that matter: `finance_report`,
`finance_transactions`, `dashboard_stats` and `stock_report` recomputed independently on
each side for all 8 restaurants and agreed. Row counts alone would pass on a database
whose foreign keys all point at the wrong parents.

Auth carried over intact — `md5` over `(id, encrypted_password, email)` for all 60 users
is **identical** on both sides, 0 blank passwords, 0 unconfirmed, 0 orphaned
`restaurant_users.auth_user_id`.

### Still open (not ours to do)

- **Production was live throughout.** Four tables drifted between the dry run and the copy
  (`products` 349→351, `purchases` 367→369, `purchase_items` 696→700, `vendor_payments`
  13→14). The clone is repeatable and cheap — **freeze writes and re-run it at the actual
  flip**.
- **App redeploy.** The DO build predates commit `ec407c7`, so the salary-cycle UI is not
  yet on it.
- **`pg_cron` daily-summary is not wired on this stack** (extension not installed, no
  `cron.job` rows) while hosted production's job is **active** on `*/15 * * * *`. Left
  alone deliberately: it emails real owners. The clone did bring `report_deliveries`
  across, so DO's dedupe cannot re-send history once it is switched on.

---

## 2026-08-21 — domain cutover: Vercel → Coolify

## ✅ DOMAIN CUTOVER 2026-08-21 — app moved off Vercel, Kong router rebuilt

The production domain `hrestrosewa.leafclutch.com.np` now points **A → 139.59.237.233**
with a valid Let's Encrypt cert, served by Coolify/Traefik. No Vercel headers remain.
Side benefit: it is a plain A record with **no CNAME**, so the WebKit CNAME-cloaking
cookie cap that signed iPhone staff out is gone — see [[ios-pwa-signout]].

**The trap:** deleting the Vercel domain also removed the
`*.testhrestrosewa.leafclutch.com.np` wildcard, but `hrs-kong`'s docker labels still
carried a rule for `supabase.testhrestrosewa.leafclutch.com.np`. The new name
`supabase.hrestrosewa.leafclutch.com.np` resolved to the droplet with **no router**, so
Traefik answered `CN=TRAEFIK DEFAULT CERT` and every browser-side Supabase call, all six
logos, and the `--http` tooling died at once. The app itself kept returning 200 because
its server side reaches Kong over the Docker network — so "the site is up" proved nothing.

**Fixed via the file provider**, not labels (labels mean recreating the container):
`/data/coolify/proxy/dynamic/hrs-kong-prod.yaml` → `http://hrs-kong:8000`, entryPoints
http/https, `certResolver: letsencrypt`. Cert issued within ~30s. Backend addressed by
CONTAINER NAME; proxy and hrs-kong share the `coolify` network.
⚠️ **Two sources of truth** — if the FQDN is ever set in the Coolify UI for hrs-kong,
DELETE that file. The stale label rule for the dead host is harmless (never matches) but
worth cleaning up the same way.

**`copy-storage.mjs` gained a second rewrite pass.** Its host swap only matched the
SOURCE prefix, so rows already repointed at the old DO host could not be fixed by a
re-run — it reported `repointed 0` and listed all six under "still pointing elsewhere".
It now also anchors on `/storage/v1/object/public/` and re-hosts any stale hostname,
which is idempotent for every future rename. All 6 logos verified 200 at their exact byte
counts, and `/_next/image` serves them (200, optimised 403KB → 16KB) while still
refusing an unlisted host (400).


---

## 🚨 CUTOVER IS LIVE — DO IS THE SYSTEM OF RECORD (2026-08-21)

Verified by write timestamps, not assumption:

    production  last payment 2026-08-20 20:39:17Z  (₹250)
    DigitalOcean     session 2026-08-20 22:10:12Z
    DigitalOcean     payment 2026-08-20 22:10:32Z  (₹980)

Production stopped taking writes at **20:39**. Everything after it landed on DO, because
the domain now resolves there. DO leads by +1 session, +1 order, +3 order items,
+1 payment, +3 notifications.

### ⛔ NEVER run `clone-db.mjs --reset` against DO again
The earlier "freeze and re-clone at the final flip" advice is now **DANGEROUS** and
withdrawn. A reset would delete real revenue — a live session and a ₹980 payment already.
If anything still needs pulling across from hosted, it has to be a targeted, additive
backfill of the 20:39→22:10 window, never a wholesale replace.

### The daily-summary emails did NOT stop — the trigger just lives in the wrong database
Earlier note (that owners would silently stop receiving reports) was **wrong**. Hosted
production's pg_cron job resolves `app_base_url = https://hrestrosewa.leafclutch.com.np`,
which now points at the DO app — so the hosted database is driving the DO app's cron
route. Observed working: the 22:00 run reached DO and logged `skipped` for every
restaurant, correctly, because the cloned `report_deliveries` already recorded today as
sent. No duplicate emails.

**The real risk is the reverse of what was assumed:** the *trigger* still lives in hosted
Supabase. Decommission that project and the daily emails stop silently, with nothing on DO
to take over — `pg_cron` is still not installed there. Install it and move the job before
retiring hosted.


---

## 📧 MAIL BROKE AT THE CUTOVER — DigitalOcean blocks all outbound SMTP (2026-08-22)

Every daily-summary report for `2026-08-21` failed: **status `failed`, 90 attempts,
`Connection timeout`**. Days up to 2026-08-20 are all `sent` — those left from Vercel.
The first day that had to send from the droplet failed, so no owner has had a report since.

**Root cause, proven by socket test from the droplet (not inferred):**

    smtp.gmail.com:465        TIMEOUT 8008ms   <- packets dropped
    smtp.gmail.com:587        TIMEOUT 8007ms
    smtp.gmail.com:25         TIMEOUT 8008ms
    smtp.sendgrid.net:587     TIMEOUT 8008ms
    smtp-relay.brevo.com:587  TIMEOUT 8007ms
    api.resend.com:443        OPEN      82ms
    1.1.1.1:443               OPEN       1ms

Every SMTP port to EVERY provider, not just Gmail. Not the droplet's firewall —
`ufw` default outgoing is `allow`. This is DigitalOcean's network-level SMTP block.
**nodemailer can never deliver from this droplet.** Do not debug Gmail credentials.

⚠️ Beware `/dev/tcp` for this: it reported 443 blocked while `curl` got 200 on the same
host. Use a real socket (`python3` socket.connect) or curl, never bash's /dev/tcp.

### Fix: Resend over HTTPS, chosen by the user 2026-08-22
`lib/email/mailer.ts` now has TWO transports and picks on `RESEND_API_KEY`:
Resend (HTTPS 443) when set, Gmail SMTP otherwise. SMTP is deliberately KEPT so a local
machine or any non-blocking host keeps working with no env change.
Request shaping lives in `lib/email/resend-payload.ts` — zero runtime imports so
`node --test` can load it (see [[node-test-alias-limit]]); 13 tests, 146 total.
Uses `fetch`, no new npm dependency.

Two details that matter: `MAIL_FROM` must be on a Resend-VERIFIED domain (a gmail.com
sender is rejected, so GMAIL_USER is not a fallback), and a non-429 4xx fails immediately
rather than retrying — a bad key or unverified domain would otherwise write the same
error three times per run.

Transport path proven from the droplet with a dummy key:
`HTTP 401 in 0.39s → {"statusCode":401,...,"message":"API key is invalid"}` — exactly the
shape `parseResendError` handles.

### Still needed from the user
1. resend.com account, verify a domain, create an API key.
2. Coolify app env: `RESEND_API_KEY` + `MAIL_FROM`.
3. **Redeploy** — the running build predates this code, so a restart is not enough.
4. THEN clear the `failed` rows for 2026-08-21 onward so the scheduler re-sends the
   backlog (user chose to send the missed days). Do NOT clear them before mail works —
   the scheduler retries ~2×/hour and would just inflate `attempts`.


### Backlog decision REVERSED 2026-08-22 — do not send the missed days

User: *"if resending left mail is a issue then ignore left mail and fix other things
for future mailing."* So 2026-08-21 onward is written off; only future reports matter.

Two guards added to `lib/reports/daily-summary-send.ts`, both bypassed by the admin
Retry button (`force`) so a specific day can still be sent deliberately:

1. **`abandoned` is now a TERMINAL status**, alongside `sent`. The scheduler skips it
   forever. ⚠️ A build that predates this treats `abandoned` as unknown, sends, fails, and
   writes `failed` back — so never mark rows abandoned until the new build is running.
2. **Stale-report guard**, `MAX_UNATTENDED_AGE_DAYS = 2`. A report leaves as its business
   day closes, so its normal age is 0–1; 2 is the smallest value that cannot block normal
   operation. Note this does NOT cover the 2026-08-21 backlog — it was only 1 day old.
3. **`REPORT_SEND_FROM=YYYY-MM-DD`** (env, optional) — a hard floor for one-off use after
   an outage, for exactly the case the age guard is too loose for. This is what makes the
   fix race-free in ONE deploy: no DB surgery, no window where the scheduler could fire
   before the rows are marked.

### The remaining future-mailing risk: the trigger is in the WRONG DATABASE
Hosted production's `pg_cron` job is what drives the DO app's cron route — it resolves
`app_base_url = https://hrestrosewa.leafclutch.com.np`, which now points at DO. **Retire
the hosted Supabase project and daily mail stops silently**, with nothing on DO to
take over.

Feasibility checked on the droplet, so this is ready to do when wanted:
- `shared_preload_libraries` already includes **pg_cron AND pg_net** — no Postgres restart
  needed, just `create extension`.
- ⚠️ `cron.database_name = postgres`, but the app's database is `hrestrosewa`. pg_cron only
  runs jobs in the database it is pointed at, so the job must be created in **`postgres`**,
  not in the app DB. That is fine — the job is only an HTTP POST.
- ⚠️ That `postgres` database is SHARED with the sibling PragyaOS stack. Not touched
  without explicit authorization — see [[droplet-resource-map]].

