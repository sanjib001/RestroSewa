-- Collapse the item lifecycle to: pending → served.
--
-- `ready` sat between them: the kitchen marked an item ready, then someone marked
-- it served. In practice that is one event with two taps, and the middle state
-- was the thing staff forgot to advance. It is being removed from the system
-- entirely — for tables and rooms alike, so the two stay identical.
--
-- The 4 items currently sitting in `ready` become `pending`, NOT `served`.
-- A ready item is cooked but has not reached the guest; calling it served would
-- record a delivery that never happened, and it is the one state the staff still
-- need to act on. Pending keeps it on the board until someone actually hands it
-- over.
--
-- Nothing about money or stock moves here: consumption is dated by created_at and
-- billing by cancelled_at. item_status has never fed either.
update session_order_items
   set item_status = 'pending'
 where item_status = 'ready';

-- The enum value stays (Postgres cannot drop one without rewriting the type, and
-- 49 historical `order_ready` notifications still reference the concept). This
-- constraint is what actually removes it: `ready` can no longer be written, so
-- the state cannot creep back in through a stray code path later.
alter table session_order_items
  drop constraint if exists session_order_items_no_ready;

alter table session_order_items
  add constraint session_order_items_no_ready
  check (item_status <> 'ready');
