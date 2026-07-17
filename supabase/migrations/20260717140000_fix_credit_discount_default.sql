-- FIX for a regression introduced by 20260716200000.
--
-- That migration replaced close_bill_with_credit's 11-arg signature with a 12-arg one
-- (adding p_discount) and gave p_discount NO default. But `check_out_room`
-- (20260713400000) still calls it POSITIONALLY with 11 arguments, so the call stopped
-- resolving: checking out a hotel guest who still owed money failed with
-- "function close_bill_with_credit(...) does not exist" and the whole checkout rolled back.
--
-- Defaulting p_discount to 0 makes the 11-arg call resolve again. A caller that doesn't
-- know about discounts means "no discount" — exactly right for a room checkout, where the
-- folio has no discount field (discounts are entered at the table/walk-in payment screen).
--
-- The body below is the CURRENT live definition, reproduced verbatim; the ONLY change is
-- `p_discount numeric default 0`. Nothing about the credit logic moves.
create or replace function close_bill_with_credit(
  p_restaurant_id  uuid,
  p_session_id     uuid,
  p_total          numeric,
  p_cash           numeric,
  p_online         numeric,
  p_card           numeric,
  p_customer_id    uuid,
  p_customer_name  text,
  p_customer_phone text,
  p_notes          text,
  p_created_by     uuid,
  p_discount       numeric default 0
)
returns credit_customers
language plpgsql
as $function$
declare
  v_paid    numeric := coalesce(p_cash, 0) + coalesce(p_online, 0) + coalesce(p_card, 0);
  v_owed    numeric;
  v_payment payments;
  v_cust    credit_customers;
  v_seq     int;
begin
  if p_total is null or p_total <= 0 then
    raise exception 'INVALID_TOTAL';
  end if;

  if v_paid < 0 or v_paid >= p_total then
    raise exception 'INVALID_DOWN_PAYMENT';
  end if;
  v_owed := p_total - v_paid;

  perform 1
     from sessions
    where id = p_session_id
      and restaurant_id = p_restaurant_id
      and status <> 'closed'
      for update;
  if not found then
    raise exception 'SESSION_NOT_OPEN';
  end if;

  if p_customer_id is not null then
    select * into v_cust
      from credit_customers
     where id = p_customer_id
       and restaurant_id = p_restaurant_id
       for update;
    if not found then
      raise exception 'CUSTOMER_NOT_FOUND';
    end if;
  else
    v_cust := find_or_create_credit_customer(
      p_restaurant_id, p_customer_name, p_customer_phone, p_created_by
    );
    select * into v_cust from credit_customers where id = v_cust.id for update;
  end if;

  insert into payments (
    restaurant_id, session_id, amount, total_amount, discount_amount,
    cash_amount, online_amount, card_amount,
    payment_method, created_by
  )
  values (
    p_restaurant_id, p_session_id, p_total, p_total, coalesce(p_discount, 0),
    coalesce(p_cash, 0), coalesce(p_online, 0), coalesce(p_card, 0),
    'credit', p_created_by
  )
  returning * into v_payment;

  perform pg_advisory_xact_lock(hashtext('credit_seq:' || p_restaurant_id::text));
  select coalesce(max(seq_no), 0) + 1 into v_seq
    from credits
   where restaurant_id = p_restaurant_id;

  insert into credits (
    restaurant_id, seq_no, session_id, payment_id, customer_id,
    customer_name, customer_phone,
    bill_amount, down_payment, paid_amount,
    status, notes, created_by
  )
  values (
    p_restaurant_id, v_seq, p_session_id, v_payment.id, v_cust.id,
    v_cust.name, v_cust.phone,
    p_total, v_paid, v_paid,
    case when v_paid > 0 then 'partially_paid' else 'pending' end,
    nullif(btrim(coalesce(p_notes, '')), ''), p_created_by
  );

  update credit_customers
     set balance = balance + v_owed,
         is_active = true
   where id = v_cust.id
  returning * into v_cust;

  update sessions
     set status = 'closed', closed_at = now()
   where id = p_session_id;

  return v_cust;
end;
$function$;

notify pgrst, 'reload schema';
