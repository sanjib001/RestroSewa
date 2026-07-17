-- Cleaning status for tables and rooms.
--
-- A table or room does not become free the instant the bill is paid — it needs wiping /
-- making up first. Closing a session now parks the table in CLEANING until a staff member
-- taps "Mark as Clean"; checking a guest out does the same for the room.
--
-- TABLES keep their DERIVED status: "Active" is (and stays) "a session is open on it", so
-- there is exactly one source of truth for occupancy. Cleaning is the only new fact, so it
-- is the only thing stored — a nullable timestamp, which also records how long the table has
-- been waiting.
--
--   session open           -> active
--   else cleaning_since    -> cleaning
--   else                   -> available
--
-- ROOMS already have a `status` enum that includes 'cleaning' (initial schema), so nothing
-- is added there — checkout simply parks the room in the state the enum always had.

alter table restaurant_tables add column if not exists cleaning_since timestamptz;

comment on column restaurant_tables.cleaning_since is
  'When the table was left needing cleaning (set when its session closed). NULL = not awaiting cleaning. Status is derived: open session = active, else this = cleaning, else available.';

-- Only tables actually awaiting cleaning are ever looked up by this, so the index skips the
-- (overwhelming) majority of rows where it is null.
create index if not exists restaurant_tables_cleaning_since_idx
  on restaurant_tables (cleaning_since)
  where cleaning_since is not null;

-- ── Tables: closing a session parks the table in Cleaning ────────────────────────────────
-- A trigger, not app code, because a session closes through FOUR different paths —
-- closeSessionWithPayment, close_bill_with_credit, force_close_session and check_out_room —
-- and every one of them must leave the table dirty. One trigger covers all of them and
-- cannot be forgotten by a future fifth path.
--
-- Only tables: a walk-in has no table, and a room-service session closing does NOT free the
-- room (the guest is still in it — only checkout ends a stay).
--
-- Firing this UPDATE also fires rs_ev_tables, so every dashboard repaints in real time for
-- free — no extra notify needed.
create or replace function park_table_for_cleaning() returns trigger
language plpgsql as $$
begin
  if new.table_id is not null then
    update restaurant_tables
       set cleaning_since = now()
     where id = new.table_id
       and cleaning_since is null;   -- idempotent: don't reset the clock on a re-close
  end if;
  return null;
end $$;

drop trigger if exists trg_park_table_for_cleaning on sessions;
create trigger trg_park_table_for_cleaning
  after update on sessions
  for each row
  when (old.status is distinct from new.status and new.status = 'closed')
  execute function park_table_for_cleaning();

-- ── Tables: a dirty table cannot be seated ───────────────────────────────────────────────
-- The hard guarantee, for the same reason as the trigger above: a session can be opened from
-- THREE places today (staff openTableSession + two customer-QR paths) and nothing stops a
-- fourth appearing. The app checks first and shows a friendly message; this is the backstop
-- that makes the rule true even if a caller forgets.
create or replace function refuse_session_on_dirty_table() returns trigger
language plpgsql as $$
begin
  if new.table_id is not null
     and exists (select 1 from restaurant_tables
                  where id = new.table_id and cleaning_since is not null) then
    raise exception 'TABLE_NEEDS_CLEANING';
  end if;
  return new;
end $$;

drop trigger if exists trg_refuse_session_on_dirty_table on sessions;
create trigger trg_refuse_session_on_dirty_table
  before insert on sessions
  for each row execute function refuse_session_on_dirty_table();

-- ── Rooms: a room being cleaned cannot be checked into ───────────────────────────────────
-- check_in_room previously refused only 'maintenance', so without this a room parked in
-- 'cleaning' would still accept the next arrival — defeating the point of the workflow.
-- A distinct error code (not ROOM_UNAVAILABLE) so reception is told the room is being made
-- up, not that it's broken. Body is the current live definition verbatim; the ONLY change is
-- the added status check.
create or replace function check_in_room(
  p_restaurant_id uuid,
  p_room_id       uuid,
  p_guest_name    text,
  p_guest_phone   text,
  p_guest_count   integer,
  p_notes         text,
  p_customer_pin  text,
  p_created_by    uuid
)
returns jsonb
language plpgsql
as $function$
declare
  v_room    rooms;
  v_rate    numeric;
  v_stay    room_stays;
  v_session sessions;
begin
  if coalesce(btrim(p_guest_name), '') = '' then
    raise exception 'GUEST_NAME_REQUIRED';
  end if;

  -- `for update` serialises two receptionists checking in to the same room.
  select * into v_room
    from rooms
   where id = p_room_id and restaurant_id = p_restaurant_id
   for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  if v_room.status = 'maintenance' then
    raise exception 'ROOM_UNAVAILABLE';
  end if;

  -- The last guest has gone but housekeeping hasn't made the room up yet.
  if v_room.status = 'cleaning' then
    raise exception 'ROOM_NEEDS_CLEANING';
  end if;

  if exists (select 1 from room_stays where room_id = p_room_id and status = 'active') then
    raise exception 'ROOM_OCCUPIED';
  end if;

  -- A room can also carry a live session with NO stay: that is what the old
  -- `openRoomSession` produced before check-in existed. Checking in over the top
  -- of one would leave two open sessions on the room and split the guest's food
  -- across two bills. Make the receptionist settle the old one first.
  if exists (
    select 1 from sessions
     where room_id = p_room_id and status <> 'closed' and room_stay_id is null
  ) then
    raise exception 'ROOM_HAS_OPEN_SESSION';
  end if;

  select base_price into v_rate from room_types where id = v_room.room_type_id;

  insert into room_stays (
    restaurant_id, room_id, guest_name, guest_phone, guest_count, room_rate, notes
  ) values (
    p_restaurant_id, p_room_id, btrim(p_guest_name),
    nullif(btrim(coalesce(p_guest_phone, '')), ''),
    greatest(coalesce(p_guest_count, 1), 1),
    coalesce(v_rate, 0),
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  returning * into v_stay;

  update rooms set status = 'occupied' where id = p_room_id;

  -- The session is what the ordering flow already understands. Tying it to the
  -- stay is what makes a room-service order land on the room bill rather than
  -- becoming a separate ticket someone has to remember to merge.
  insert into sessions (restaurant_id, type, room_id, room_stay_id, customer_pin)
  values (p_restaurant_id, 'room_service', p_room_id, v_stay.id, p_customer_pin)
  returning * into v_session;

  return jsonb_build_object(
    'stay_id',    v_stay.id,
    'session_id', v_session.id,
    'room_rate',  v_stay.room_rate
  );
end;
$function$;

-- ── Rooms: checkout parks the room in Cleaning ───────────────────────────────────────────
-- check_out_room previously set the room straight back to 'available', with a comment saying
-- housekeeping was a manual, admin-only status. That is now the actual workflow, so the room
-- goes to 'cleaning' and housekeeping releases it. Everything else in the function is
-- untouched; only that one UPDATE changes.
create or replace function check_out_room(
  p_restaurant_id  uuid,
  p_stay_id        uuid,
  p_total          numeric,
  p_cash           numeric,
  p_online         numeric,
  p_card           numeric,
  p_method         text,
  p_customer_id    uuid,
  p_customer_name  text,
  p_customer_phone text,
  p_notes          text,
  p_created_by     uuid
)
returns jsonb
language plpgsql
as $$
declare
  v_stay    room_stays;
  v_session sessions;
  v_paid    numeric := coalesce(p_cash, 0) + coalesce(p_online, 0) + coalesce(p_card, 0);
  v_now     timestamptz := now();
begin
  select * into v_stay
    from room_stays
   where id = p_stay_id and restaurant_id = p_restaurant_id
   for update;
  if not found then
    raise exception 'STAY_NOT_FOUND';
  end if;
  if v_stay.status <> 'active' then
    raise exception 'STAY_ALREADY_CLOSED';
  end if;

  if p_total is null or p_total < 0 then
    raise exception 'INVALID_TOTAL';
  end if;

  -- Any status, not just open: a force-closed room session still needs its stay
  -- settled, and the payment still has to hang off something.
  select * into v_session
    from sessions
   where room_stay_id = p_stay_id
   order by opened_at
   limit 1
   for update;

  if v_session.id is null then
    raise exception 'NO_SESSION_FOR_STAY';
  end if;

  -- Close the stay FIRST. check_out_at is an input to the folio, so writing it
  -- before the payment is what stops the bill from moving underneath the amount
  -- we are about to charge.
  update room_stays
     set check_out_at = v_now,
         status       = 'checked_out'
   where id = p_stay_id;

  if v_paid + 0.005 < p_total then
    -- Something is still owed → the shared credit path, which writes the payment,
    -- the credit and the session close together. One credit ledger, not two.
    perform close_bill_with_credit(
      p_restaurant_id, v_session.id, p_total,
      coalesce(p_cash, 0), coalesce(p_online, 0), coalesce(p_card, 0),
      p_customer_id, p_customer_name, p_customer_phone, p_notes, p_created_by
    );
  else
    -- The payment hangs off the SESSION, not the stay.
    --
    -- `payments_source_check` is an XOR — session_id or room_stay_id, never both —
    -- so this is a real fork. Session wins for three reasons: it is what
    -- close_bill_with_credit above already does (so a room bill has ONE shape
    -- whether or not it went on credit); sessions.room_stay_id still reaches the
    -- stay, so nothing is lost; and the sales report already embeds
    -- `sessions → rooms`, so a room bill labels itself "Room 101" with no change.
    insert into payments (
      restaurant_id, session_id, amount,
      cash_amount, online_amount, card_amount, total_amount,
      payment_method, created_by
    ) values (
      p_restaurant_id, v_session.id, p_total,
      coalesce(p_cash, 0), coalesce(p_online, 0), coalesce(p_card, 0), p_total,
      p_method::payment_method, p_created_by
    );

    if v_session.status <> 'closed' then
      update sessions set status = 'closed', closed_at = v_now where id = v_session.id;
    end if;
  end if;

  -- The guest is gone but the room isn't sellable yet — housekeeping has to make it up
  -- first. Parking it in 'cleaning' is what stops reception handing it to the next arrival
  -- with the last guest's towels still in it. "Mark as Clean" releases it to 'available'.
  update rooms set status = 'cleaning' where id = v_stay.room_id;

  return jsonb_build_object(
    'stay_id',      p_stay_id,
    'session_id',   v_session.id,
    'check_out_at', v_now,
    'total',        p_total
  );
end;
$$;

notify pgrst, 'reload schema';
