# Finance

# Overview
The money picture: four derived balances, credit, vendor payments, profit, and the daily report.
Everything is DERIVED from source rows — see `decisions.md` → "Four derived balances". This
module covers the on-screen Finance report and the emailed daily report.

# Responsibilities
- Opening/closing balances, cash/online/credit movement, purchases/expenses, profit estimate.
- Customer credit (receivable) and vendor credit (payable) rollups.
- The Daily Finance Report (PDF emailed after close).

# Features
- **Finance report** (`/admin/finance`) — `finance_report(restaurant, from, to)` derives opening,
  sales split, purchases, vendor+customer credit, salaries, and closing. CSV export mirrors it.
- **Opening balance seed** (`finance_openings`) — the one non-derivable number; every later day's
  opening carries forward. **Security PIN-gated** (`set_opening_balance`, 2026-08-26) — setting or
  changing it rewrites every later balance, so it goes through the same reusable authorization
  service as the other sensitive edits. See `modules/security-pin.md`.
- **Business closing time** — periods anchor on the per-restaurant closing hour (see
  `modules/settings.md`, `lib/business-day.ts`).
- **Daily Finance Report** — automatic per-business-day PDF from `lib/reports/*`, emailed via
  HRestroSewa Gmail; recipients + history/retry in Settings. Model adds mixed payments +
  inventory value. See `decisions.md` → "Daily Finance Report design", `modules/settings.md`.

# Business Rules
- **Four balances**: cash, online/bank, credit-to-us (receivable), credit-by-us (payable).
  Closing = opening + in − out; a period's opening = the same sum at its start ⇒ carry-forward
  cannot drift. Credit moves NO cash the day it's created (accrual — the sale counts at billing).
- **A fifth balance: advances held** — room deposits taken but not yet applied to a bill. Guests'
  money sitting in the till. The accrual rule pointed the other way (cash first, sale later), and
  derived exactly like the credit balances, so it carries forward and cannot drift:
  `held(T) = Σ room_advances.amount [< T] − Σ payments.advance_amount [< T]`.
  Refunds need no term — they are negative `room_advances` rows and every sum carries them.
  **Sales are untouched by advances**: the whole bill still books at checkout.
- Card is bank money for balances (own Sales line). Mixed = cash+online in lockstep.
- **Sales is split by SOURCE: restaurant (tables + walk-ins) vs rooms.** `sales_room_*` and
  `sales_table_*` (cash/online/card/credit/total); room + table always equals the plain
  `sales_*` figure. A payment is a room sale when `payments.room_stay_id` is set, or its session
  carries `room_stay_id` / `room_id` / `type = 'room_service'` — three markers, because `room_id`
  survives a session transfer while a type set at creation might not. **The Room block is gated on
  `hasRooms(businessType)`**, the same helper the sidebar and `/admin/rooms` use; a restaurant-only
  client sees one block still headed "Sales". The emailed daily PDF uses the **same** gate —
  `buildDailySummary` reads `restaurants.type` and carries `showRooms`; never gate that report on
  room *activity*, or a hotel's quiet day drops the block and the PDF contradicts the screen.
- **The Sales block must ADD UP**:
  per block — `room: cash + online + card + advance_cash + advance_online + credit = room_total`
  and `restaurant: cash + online + card + credit = table_total` (a table bill can never carry an
  advance). Advances are room-only by construction, so they appear in the Room block and nowhere
  else in Sales. The advance part is
  settled by a deposit taken earlier — not new cash, which was banked under Room advances on the
  day it arrived. Added 2026-08-12 after a fully prepaid room checkout showed a total with **no
  sale beneath it** (measured: total 9,500, rows 3,000, gap 6,500). The credit leg is the remainder
  AFTER the deposit, because `credits.down_payment` includes it — which is what makes it exact.
- **Every advance figure is reported SPLIT by tender**: `advances_cash`/`advances_online`,
  `refunds_cash`/`refunds_online`, `sales_advance_cash`/`sales_advance_online`. Card rides with
  online (bank money). The balances always carried the split; only the reported figures didn't, so
  a mixed deposit read as one opaque number.
  - The Sales split is keyed on the **payment's** date but reads the **stay's** advance rows
    (`payments → sessions.room_stay_id → room_advances`), which is what makes a deposit taken on
    Monday show against Wednesday's sale.
  - It uses the stay's **net** rows, so a refund is already netted off — the figure is cash
    *retained*, not cash first taken. The online half is derived as `applied − cash` (cash clamped
    to `[0, applied]`) so the two ALWAYS sum to `sales_advance`: the Sales block can never stop
    adding up, which matters more than surfacing a hypothetical inconsistent row.
- **Extra expenses are the fourth kind of money out** (after purchases, vendor repayments and
  salary): the overheads that are neither stock nor people. `extra_expenses` is a plain table with
  a cash/online split and **no credit leg** — the row IS the payment, so there is no status column,
  no payable and no settle-later screen. A bill that has arrived unpaid is simply not an expense
  yet. Reported as `extra_expenses_cash`/`_online`/`_total` plus `extra_expenses_by_category`
  (jsonb, biggest first, empty categories absent — one round trip, because this app is
  latency-bound). The opening legs are **floored at `finance_openings.effective_from`** like
  `pur`/`vp`/`sal`, since the seed already accounts for pre-books movement; the credit legs
  nearby are deliberately unfloored, so do not "make them consistent".
  **Category keys are single words on purpose**: `finance_transactions` labels a ledger row with
  `initcap(category)`, so a label like "Licenses & Taxes" in `lib/expenses.ts` would make the same
  expense read two different ways on two screens.
- **Extra income is the mirror of extra expenses, on the money-IN side** (added 2026-08-25):
  `extra_income` — misc/service/other income received by hand, recorded from `/admin/finance`
  itself (not a separate page, unlike expenses). Same "the row IS the payment" shape, but **Card
  is a real standalone tender** (`cash_amount`/`online_amount`/`card_amount`, method
  `cash|online|card|mixed` — `extra_expenses` never offered Card at all) and **there is no category
  taxonomy**: the requirement asked for free-text "Description / Reason" only, so each entry prints
  as its own PDF/report line keyed by its own description rather than being grouped — grouping
  free text the way `expcat` groups a CHECK-constrained category would silently split "Misc income"
  from "misc income" into two lines. **NEVER a sale** — `sales_total`/`salesCash`/etc. are
  untouched; it never touches `payments`. Reported as `income_cash`/`_online`/`_card`/`_total` on
  `finance_report`, folding Card into the online balance leg like every other tender in this app.
  Correcting or removing an entry is `updateExtraIncome`/`removeExtraIncome` in
  `app/actions/security.ts` — admin-only + Security PIN, audit-logged, same lane as
  `updateExtraExpense`/`updateRoomAdvance`. `estimatedProfit` (daily summary) gained `+ incomeTotal`.
- **A SAVING is an extra expense with a pot** — the eleventh category, `saving`. Because it is just
  a category, it reached the period total, the split, the ledger, the CSV, the PDF and the profit
  subtraction **with no change to either finance function**; a separate `savings` table would have
  needed a new leg in both, which is the pair that must always move together. Finance shows **one
  "Saving" line and never the per-title detail** — that is deliberate, the pots live only on
  `/admin/expenses`. Savings DO reduce estimated profit (the user's explicit call), so a month
  with heavy saving reads as a weaker month.
- **A pot's OPENING AMOUNT is not a payment.** `saving_titles.opening_amount` is what the pot held
  before the app was tracking it. Writing it as a `saving` row — the obvious implementation — would
  be wrong and expensively so: every finance figure sums those rows, so a ₹50,000 opening would
  take ₹50,000 out of cash-in-hand *today*, add a ledger outflow that never happened, and cut
  estimated profit for the month. The money was set aside months ago. So it lives on the TITLE,
  exactly as `finance_openings` carries the one balance the app cannot derive: **no cash leg, no
  ledger row, no effect on either finance function**, verified on DEV (closing cash, closing online
  and `extra_expenses_total` all unchanged after inserting one).
  ⚠️ Consequence: a pot's balance is `opening_amount + Σ rows`, while its cash/online breakdown
  covers **only the rows** — those two do not add up, and must not. The UI names the opening figure
  explicitly for that reason. Withdrawals CAN draw against it (the money physically exists), so
  both `withdrawSaving` and the PIN-gated edit in `security.ts` include it when measuring "held" —
  keep those two identical or an amount accepted on create is refused on edit.
- **A WITHDRAWAL is a negative saving row** — `room_advances`' signed-row trick again, and again it
  meant no change to either finance function: every figure already SUMS these rows, so pot balance,
  period total, both cash balances and the ledger delta all come out right from the signs alone.
  `extra_expenses_total` is therefore **net** for the period. Sign safety rests on
  `cash_amount * amount >= 0` (and the same for online): without it a row could be `amount −5000,
  cash +8000, online −13000`, which satisfies the split check and would credit the till 8,000 that
  never existed. Withdrawing more than a pot holds is refused, on both create and edit.
  ⚠️ Since saving cuts profit, withdrawing RAISES it — a month that empties a pot reads strong.
  That is the mirror of treating saving as an expense and cancels over any period holding both;
  the thing to revisit is whether saving should hit profit at all, not how withdrawals work.
- **Discounts are REPORTED, combining Till & Credit clearance discounts.** `discounts_total` + `discounted_bills` on
  `finance_report` include both till discounts (`payments`) and credit clearance discounts (`credit_payments`).
  Shown in their own block placed immediately BEFORE Closing balance, plus CSV and daily PDF. The net amount IS
  the sale everywhere (no gross/net split). Discounts given on credit clearance are tracked separately as
  `creditDiscountsTotal` and shown in the Customer credits block as `customerCreditDiscounted` (debt written off).
  Redundant "Sales before discount" and "Sales after discount" rows were removed across UI, CSV, and PDF reports.
  The Discounts block presents: "Transactions discounted", "Till / sales discounts", "Credit clearance discounts",
  and "Discount given (Total)". `buildDailySummary` reads the unified figure from `finance_report`.
- **Estimated profit** = sales − purchases − salaries − extra expenses; it's optimistic
  (bought-stock cost, not consumed; unlinked dishes have no cost) and must always be labelled an
  estimate. The dashboard's "Today's profit" tile is deliberately NOT this formula — it is
  `sales − COGS` from `dashboard_stats`, and aligning the two is an open decision.
- **A ledger SALE names its side of the business.** `finance_transactions` carries `source`
  (`room` | `walkin` | `table` | null) and `source_label` ("Room 203", "Table 5", "Walk-in 1"); the
  screen renders "Room sale · Room 203 · Ram Bahadur". **`kind` stays `'sale'` for both** — the
  ledger groups and reconciles by kind, so splitting it would ripple through `FinanceTxKind`,
  `TX_LABEL` and every reader to say what two columns already say. `party` is untouched, so a
  credit sale keeps its customer name. The room test is **copied verbatim from `paysrc`** in
  `finance_report`; keep them identical or the ledger and the Sales block would classify the same
  bill differently. The "Restaurant sale"/"Room sale" wording is gated on `showRooms`, the same
  gate the Sales block uses — a restaurant-only client still reads plain "Sale".
  ⚠️ The sale branch now LEFT JOINs sessions → room_stays → rooms and restaurant_tables. All are
  to primary keys, so no fan-out; row count was 121 before and after, which is the check to
  repeat if that branch is ever touched again.
- **The ledger NAMES by direction too, for the two signed kinds.** `txLabel(t, showRooms)` in
  `lib/finance.ts` is the single labeller — `TX_LABEL[kind]` alone was not enough, because
  `room_advance` and `extra_expense` both carry a SIGNED amount and mean opposite things each way:
  a negative advance is a **Room Advance Refund**, a negative extra expense is a **Saving
  Withdrawal** (the CHECK constraint permits a negative amount for the `saving` category and no
  other, so that inference is safe). Before this, a ₹1,500 refund read "Room Advance" — identical
  to the deposit it reverses, with only the minus sign to tell them apart. Measured on DEV: **4 of
  4** negative rows were mislabelled.
  ⚠️ **The label reads the row's SIGN; the colour reads the DELTAS.** Different inputs on purpose —
  "what is this row" vs "which way did the money go" — and they must not contradict: a refund is
  red − (money out), a withdrawal is green + (money in). Covered by `lib/finance.test.ts`.
  The screen and the CSV both call `txLabel`; they had already drifted to "Room sale" vs
  "Room Sale", which is exactly why there is now one function. The CSV passes `showRooms: true`
  because that file has no business-type gate and its exports have always qualified sales.
  *(Not distinguished: a cancellation refund vs a checkout refund. The note that separates them
  isn't in the ledger payload, so it would need a migration.)*
  ⚠️ `lib/finance.ts` now imports `./business-day.ts` **relatively** so it is reachable under
  `node --test` — the same deliberate choice `lib/room-billing.ts` makes. Do not "tidy" it to `@/`.
- **The ledger colours by DIRECTION, never by kind.** `txFlow(t) = cashDelta + onlineDelta` decides:
  `> 0` green `+`, `< 0` red `−`, `0` amber "no money moved". The old `TX_TONE` map (one fixed
  colour per kind) was wrong for every row that can point both ways, and measured on DEV it
  mis-coloured **15 of 121** real rows: room-advance REFUNDS (green, but money out), saving
  WITHDRAWALS (red, but money in), credit sales and fully-on-credit purchases (coloured as though
  cash moved when none did), and salary advances (amber, but real money out). A kind cannot know
  which way its own row went — only the deltas can. `TX_TONE` is deleted; do not reintroduce it.
  The headline figure is the money that actually moved, with the transaction's own value printed
  beneath it when the two differ ("−₹3,000 / of ₹5,000" for a part-cash part-credit bill), because
  showing −₹5,000 there would claim 5,000 left the till.
- Report exactly-once via `report_deliveries`; failures logged + retryable.

# Important Components
- `app/actions/finance.ts`, `lib/finance.ts`; RPCs `finance_report`, `set_finance_opening`,
  `dashboard_stats`.
- `lib/reports/{daily-summary,daily-summary-pdf,daily-summary-send}.ts`,
  `lib/reports/pdf/report-document.ts`, `lib/email/mailer.ts`, `app/api/cron/daily-summary`.

# Database Relations
`payments`, `credits`/`credit_payments`, `purchases`/`vendor_payments`, `extra_expenses`,
`finance_openings`, `report_deliveries` — see `database.md`. Stock valuation reuses `stock_report` (see `modules/stock.md`).

# Permissions
`view_finance` (separate from stock — it exposes takings, margins, all debt). Opening-balance
write needs `manage_stock` + `view_finance`. Daily-report config is owner-only.
`manage_expenses` gates recording an overhead — its own lane, NOT a rider on `manage_purchases`,
because paying the landlord and recording a supplier bill are different trust levels. Viewing
`/admin/expenses` passes on `manage_expenses`, `view_finance` OR `add_expenses`; a stock right
alone does **not** open it (unlike Purchases/Vendors). Correcting or deleting one is admin-role +
Security PIN. See `modules/permissions.md`.

**`add_expenses` ("Add Expenses & Saving") is the narrow lane**: file an expense or a saving, see
**today's entries only**, and never a pot's running balance. For whoever actually pays the bills,
without showing them the totals. Three rules make it real, and all three are SERVER-side:
`listExtraExpenses` forces `period = "today"` and ignores any `from`/`to` (a crafted call asking
for "year" gets today); `listSavingTitles` filters the saving rows to today **before** summing and
does not read `opening_amount` at all, so **there is no running total in the payload** for a client
bug to leak; and `withdrawSaving` plus all pot CRUD stay on `manage_expenses` — the permission
adds, it does not withdraw or decide what the pots are. `STOCK_ACCESS.expensesTodayOnly` is the
single predicate behind all of it (`has add && !has manage && !has view_finance`) — never
re-derive that expression at a call site, which is how one of them eventually drops the `!`.
Covered by `lib/permissions.test.ts`.

# Known Limitations
- Profit is an estimate (COGS only for product-linked items).
- Daily report is per-restaurant; no weekly/monthly yet.

# Future Improvements
- Weekly/monthly/yearly reports reusing the report service (see `roadmap.md`).
- Verified sending domain for deliverability; charts in the PDF.
