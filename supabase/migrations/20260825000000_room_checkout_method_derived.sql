-- =============================================================
-- ROOM CHECKOUT: DERIVE payment_method, DON'T TRUST THE CLIENT
--
-- THE BUG. `check_out_room`'s non-credit branch stored whatever `p_method` the
-- checkout form happened to be showing, verbatim. The form's tender AMOUNTS
-- (`cash_amount`/`online_amount`/`card_amount` — see CheckOutForm's `amounts`
-- object) are computed FROM the selected method, so the two stay consistent —
-- EXCEPT when `balance` is 0, i.e. the stay is fully covered by an advance taken
-- earlier. There, every tendered amount is 0 regardless of which button is
-- selected, but `method` still defaults to "cash" (its initial React state) and
-- nobody has a reason to touch it, since there's nothing left to type. Result: a
-- guest who paid the whole stay ONLINE as a deposit checks out with a bill
-- reading "Cash" — the advance's own tender never gets a say in the label.
--
-- Every other write path in this app derives payment_method FROM the actual
-- amounts (edit_payment_tender's v_nonzero count; the refund tender inside this
-- same function). check_out_room's direct-insert branch was the one place still
-- trusting a raw client string for a value real money depends on downstream —
-- Sales, the reprinted bill, the dashboard's recent-sales list, and every CSV
-- export just print `payments.payment_method` as fact.
--
-- THE FIX. Compute the label from what actually moved: the cash/online/card
-- tendered AT the desk right now, PLUS however much of the advance APPLIED to
-- this bill was itself cash vs online+card — the same clamp `finance_report`'s
-- `advsold` CTE already uses to split `sales_advance_cash`/`sales_advance_online`
-- (`least(greatest(stay_cash, 0), applied)`). Keep the two identical, or Sales,
-- Finance and the stored method three-way disagree about the same deposit.
--
-- `p_method` is left in the signature (no signature change ⇒ no DROP needed) but
-- is now read ONLY to route the credit/immediate-settle fork below — which was
-- ALREADY decided purely by `v_paid + v_applied` vs `p_total`, never by
-- `p_method`. So this changes no behaviour except which value lands in
-- `payment_method` on a settled (non-credit) bill.
--
-- Body otherwise reproduced verbatim from 20260811000200_room_advance_checkout.sql.
-- =============================================================

create or replace function public.check_out_room(
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
  p_created_by     uuid,
  p_discount       numeric default 0,
  p_refund_cash    numeric default 0,
  p_refund_online  numeric default 0
)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_stay    room_stays;
  v_session sessions;
  v_paid    numeric := coalesce(p_cash, 0) + coalesce(p_online, 0) + coalesce(p_card, 0);
  -- Read INSIDE the transaction, never taken from the client. Same principle as
  -- the total itself: the browser says what it thinks is held, we look.
  v_held    numeric;
  v_applied numeric;
  v_refund  numeric := coalesce(p_refund_cash, 0) + coalesce(p_refund_online, 0);
  v_now     timestamptz := now();
  -- How this stay's deposit was itself tendered, and how much of THAT is behind
  -- the amount actually applied to this bill (see the header note above).
  v_adv_cash        numeric;
  v_adv_applied_cash   numeric;
  v_adv_applied_online numeric;
  v_method  payment_method;
  v_nonzero int;
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

  select coalesce(sum(amount), 0) into v_held
    from room_advances
   where stay_id = p_stay_id;

  -- A deposit can only pay off this bill up to the bill. Anything above it is
  -- the guest's money and goes back to them, which is what the refund is.
  v_applied := greatest(least(v_held, p_total), 0);

  if abs(v_refund - greatest(v_held - p_total, 0)) > 0.005 then
    raise exception 'REFUND_MISMATCH';
  end if;

  -- Net cash this stay's deposits actually hold (refunds are negative rows, so
  -- this sum is already net), then the slice of THAT behind the amount applied
  -- to this bill — clamped exactly as `finance_report`'s `advsold` CTE clamps it,
  -- so the two can never disagree about the same stay.
  select coalesce(sum(cash_amount), 0) into v_adv_cash
    from room_advances
   where stay_id = p_stay_id;
  v_adv_applied_cash   := least(greatest(v_adv_cash, 0), v_applied);
  v_adv_applied_online := v_applied - v_adv_applied_cash;

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

  -- The refund goes in BEFORE the stay is closed: record_room_advance refuses to
  -- write against a settled stay, and rightly so.
  if v_refund > 0.005 then
    perform record_room_advance(
      p_restaurant_id => p_restaurant_id,
      p_stay_id       => p_stay_id,
      p_amount        => -v_refund,
      p_cash          => -coalesce(p_refund_cash, 0),
      p_online        => -coalesce(p_refund_online, 0),
      p_card          => 0,
      p_method        => case
                           when coalesce(p_refund_cash,0) > 0.005 and coalesce(p_refund_online,0) > 0.005 then 'mixed'
                           when coalesce(p_refund_online,0) > 0.005 then 'online'
                           else 'cash'
                         end,
      p_note          => 'Refund of unused advance at checkout',
      p_created_by    => p_created_by
    );
  end if;

  -- Close the stay FIRST (after the refund). check_out_at is an input to the
  -- folio, so writing it before the payment is what stops the bill from moving
  -- underneath the amount we are about to charge.
  update room_stays
     set check_out_at = v_now,
         status       = 'checked_out'
   where id = p_stay_id;

  -- THE FORK, now counting the deposit as money received. Without `+ v_applied`
  -- a fully-prepaid stay would be sent down the credit path and open a credit
  -- account for a guest who owes nothing. Decided purely by the amounts —
  -- `p_method` plays no part here and never has.
  if v_paid + v_applied + 0.005 < p_total then
    -- NAMED arguments. This call was positional with 11 arguments, which is
    -- precisely what stopped resolving when p_discount was added and rolled back
    -- every hotel credit checkout (see 20260717140000).
    perform close_bill_with_credit(
      p_restaurant_id  => p_restaurant_id,
      p_session_id     => v_session.id,
      p_total          => p_total,
      p_cash           => coalesce(p_cash, 0),
      p_online         => coalesce(p_online, 0),
      p_card           => coalesce(p_card, 0),
      p_customer_id    => p_customer_id,
      p_customer_name  => p_customer_name,
      p_customer_phone => p_customer_phone,
      p_notes          => p_notes,
      p_created_by     => p_created_by,
      p_discount       => coalesce(p_discount, 0),
      p_advance        => v_applied
    );
  else
    -- DERIVED, not trusted: what actually moved is the tender at the desk right
    -- now PLUS however much of the applied advance was itself cash vs
    -- online+card. A bill fully covered by an online deposit must read
    -- "Online", never whatever the method selector happened to default to.
    v_nonzero := (case when coalesce(p_cash, 0) + v_adv_applied_cash > 0.005 then 1 else 0 end)
               + (case when coalesce(p_online, 0) + v_adv_applied_online > 0.005 then 1 else 0 end)
               + (case when coalesce(p_card, 0) > 0.005 then 1 else 0 end);
    v_method := case
                  when v_nonzero > 1 then 'mixed'
                  when coalesce(p_online, 0) + v_adv_applied_online > 0.005 then 'online'
                  when coalesce(p_card, 0) > 0.005 then 'card'
                  else 'cash'  -- includes a genuinely zero-total bill
                end;

    -- p_total is ALREADY NET of the discount (buildFolio subtracts it before
    -- returning grandTotal). discount_amount records what was given away; it is
    -- never subtracted again here. Net IS the sale — and the advance is a payment
    -- against that sale, not a reduction of it.
    insert into payments (
      restaurant_id, session_id, amount,
      cash_amount, online_amount, card_amount, advance_amount, total_amount,
      payment_method, created_by, discount_amount
    ) values (
      p_restaurant_id, v_session.id, p_total,
      coalesce(p_cash, 0), coalesce(p_online, 0), coalesce(p_card, 0), v_applied, p_total,
      v_method, p_created_by, coalesce(p_discount, 0)
    );

    if v_session.status <> 'closed' then
      update sessions set status = 'closed', closed_at = v_now where id = v_session.id;
    end if;
  end if;

  update rooms set status = 'cleaning' where id = v_stay.room_id;

  return jsonb_build_object(
    'stay_id',      p_stay_id,
    'session_id',   v_session.id,
    'check_out_at', v_now,
    'total',        p_total,
    'advance',      v_applied,
    'refund',       v_refund
  );
end;
$function$;

notify pgrst, 'reload schema';
