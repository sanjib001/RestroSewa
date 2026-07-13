-- The hotel stay lifecycle: check in, run a folio, check out.
--
-- `room_stays` and `room_charges` have existed since the original schema and
-- have never held a single row — nothing in the app read or wrote them. So a
-- room session behaved exactly like a table session: it billed the food and
-- never once charged the guest for the bed. This wires the tables up.
--
-- Both operations are functions rather than a sequence of client calls because
-- each one spans three or four tables and there is no halfway state worth
-- keeping: a check-in that occupied the room but failed to open the stay would
-- leave a room nobody can book and no guest to bill.

-- ─────────────────────────────────────────────────────────────────────────────
-- Future-ready charge types (§5). The enum already carried room_rate, extra_bed,
-- laundry, mini_bar and other; these are the rest of the list, added now so a
-- later feature is a UI change and not a migration on a live billing table.
-- ─────────────────────────────────────────────────────────────────────────────
alter type room_charge_type add value if not exists 'room_service';
alter type room_charge_type add value if not exists 'late_checkout';
alter type room_charge_type add value if not exists 'early_checkin';

-- One guest in a bed at a time. Without this, a double-submitted check-in form
-- opens two stays on one room and the second silently overwrites the first
-- guest's folio. Partial, so the history of checked-out stays is unconstrained.
create unique index if not exists room_stays_one_active_per_room
  on room_stays (room_id) where status = 'active';

-- The folio reads every charge for a stay on every render.
create index if not exists room_charges_stay_idx on room_charges (room_stay_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Check in.
--
-- Opens the stay, occupies the room, and opens the session that F&B will hang
-- off — so room-service orders land on the guest's folio automatically, with no
-- second step for the receptionist to forget.
--
-- The nightly rate is SNAPSHOT onto the stay, not read live from the room type
-- at billing time. An admin raising the Deluxe price on Tuesday must not
-- retroactively re-bill the guest who checked in on Monday.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function check_in_room(
  p_restaurant_id uuid,
  p_room_id       uuid,
  p_guest_name    text,
  p_guest_phone   text,
  p_guest_count   int,
  p_notes         text,
  p_customer_pin  text,
  p_created_by    uuid
)
returns jsonb
language plpgsql
as $$
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
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Check out.
--
-- Settles the folio, ends the stay, closes the session and frees the room — all
-- or nothing. The total is passed in rather than recomputed here: it is produced
-- by lib/room-billing.ts, which is the single source of the folio maths for the
-- screen, the printed bill and the payment alike. Recomputing it in SQL would be
-- a second implementation of the same rule, and the two would drift.
--
-- If the guest leaves something unpaid it delegates to `close_bill_with_credit`,
-- which already writes the payment, the credit and the session close together.
-- Reusing it means a room bill on credit behaves exactly like a table bill on
-- credit, and there is one credit ledger, not two.
-- ─────────────────────────────────────────────────────────────────────────────
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

  -- The room is free the moment the guest walks out. Housekeeping is a status an
  -- admin can set by hand; making it automatic here would block the next
  -- check-in on a step nobody asked for.
  update rooms set status = 'available' where id = v_stay.room_id;

  return jsonb_build_object(
    'stay_id',      p_stay_id,
    'session_id',   v_session.id,
    'check_out_at', v_now,
    'total',        p_total
  );
end;
$$;

-- Reachable over HTTP as RPC. It has to be PUBLIC that is revoked: Postgres
-- grants EXECUTE on every new function to PUBLIC by default, so anon and
-- authenticated inherit it from there and revoking their (non-existent) direct
-- grants would achieve nothing. Granted straight back to service_role only.
revoke all on function check_in_room(uuid, uuid, text, text, int, text, text, uuid) from public;
revoke all on function check_out_room(uuid, uuid, numeric, numeric, numeric, numeric, text, uuid, text, text, text, uuid) from public;

grant execute on function check_in_room(uuid, uuid, text, text, int, text, text, uuid) to service_role;
grant execute on function check_out_room(uuid, uuid, numeric, numeric, numeric, numeric, text, uuid, text, text, text, uuid) to service_role;
