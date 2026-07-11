-- =============================================================
-- CUSTOMER CREDIT ACCOUNT FUNCTIONS
--
-- Same shape as the vendor functions: the account carries the running balance,
-- money moves only inside these functions, and `for update` serialises two
-- cashiers acting on the same customer at once.
-- =============================================================

-- ── Find or create the customer's ONE account ─────────────────────────────────
-- Phone is the identifier — it's what a cashier actually has. Falling back to the
-- name only when there is no phone. Returning a customer NEVER gets a second
-- Credit ID.
create or replace function find_or_create_credit_customer(
  p_restaurant_id uuid,
  p_name          text,
  p_phone         text,
  p_created_by    uuid
) returns credit_customers
language plpgsql
as $$
declare
  v_name  text := btrim(coalesce(p_name, ''));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_seq   int;
  v_cust  credit_customers;
begin
  if v_name = '' then
    raise exception 'CUSTOMER_NAME_REQUIRED';
  end if;

  -- Existing account? Match on phone first, then on name when no phone is given.
  if v_phone is not null then
    select * into v_cust
      from credit_customers
     where restaurant_id = p_restaurant_id
       and btrim(phone) = v_phone
     limit 1;
  else
    select * into v_cust
      from credit_customers
     where restaurant_id = p_restaurant_id
       and phone is null
       and lower(btrim(name)) = lower(v_name)
     limit 1;
  end if;

  if found then
    -- Reuse it. Keep the latest spelling of the name, and fill in a phone if we
    -- didn't have one before.
    update credit_customers
       set name      = v_name,
           phone     = coalesce(v_phone, phone),
           is_active = true
     where id = v_cust.id
    returning * into v_cust;
    return v_cust;
  end if;

  -- New customer. Serialise numbering per restaurant; released at commit.
  perform pg_advisory_xact_lock(hashtext('credit_customer_seq:' || p_restaurant_id::text));
  select coalesce(max(seq_no), 0) + 1 into v_seq
    from credit_customers
   where restaurant_id = p_restaurant_id;

  insert into credit_customers (restaurant_id, seq_no, name, phone, balance, created_by)
  values (p_restaurant_id, v_seq, v_name, v_phone, 0, p_created_by)
  returning * into v_cust;

  return v_cust;
end;
$$;

revoke all on function find_or_create_credit_customer(uuid, text, text, uuid) from public;
grant execute on function find_or_create_credit_customer(uuid, text, text, uuid) to service_role;

-- ── Close a bill onto a customer's credit account ─────────────────────────────
-- Writes ONE payments row for the full bill (sales still see the whole bill; no
-- duplicate bill is ever created), records what was actually tendered, opens the
-- credit BILL against the customer's account, raises the account balance, and
-- closes the session — all in one transaction.
-- Old signature (no customer account), and the new one so this file is re-runnable.
drop function if exists close_bill_with_credit(uuid, uuid, numeric, numeric, numeric, numeric, text, text, text, uuid);
drop function if exists close_bill_with_credit(uuid, uuid, numeric, numeric, numeric, numeric, uuid, text, text, text, uuid);

create function close_bill_with_credit(
  p_restaurant_id  uuid,
  p_session_id     uuid,
  p_total          numeric,
  p_cash           numeric,
  p_online         numeric,
  p_card           numeric,
  -- Either an existing account…
  p_customer_id    uuid,
  -- …or the details to find/create one.
  p_customer_name  text,
  p_customer_phone text,
  p_notes          text,
  p_created_by     uuid
) returns credit_customers
language plpgsql
as $$
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

  -- A credit only exists when something is left unpaid.
  if v_paid < 0 or v_paid >= p_total then
    raise exception 'INVALID_DOWN_PAYMENT';
  end if;
  v_owed := p_total - v_paid;

  -- The session must still be open. `for update` stops a double-submit billing
  -- the same table twice.
  perform 1
     from sessions
    where id = p_session_id
      and restaurant_id = p_restaurant_id
      and status <> 'closed'
      for update;
  if not found then
    raise exception 'SESSION_NOT_OPEN';
  end if;

  -- Resolve the account. An existing one is REUSED — never duplicated.
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
    -- Lock it now that we know which one it is.
    select * into v_cust from credit_customers where id = v_cust.id for update;
  end if;

  insert into payments (
    restaurant_id, session_id, amount, total_amount,
    cash_amount, online_amount, card_amount,
    payment_method, created_by
  )
  values (
    p_restaurant_id, p_session_id, p_total, p_total,
    coalesce(p_cash, 0), coalesce(p_online, 0), coalesce(p_card, 0),
    'credit', p_created_by
  )
  returning * into v_payment;

  -- The credit BILL. Still numbered CR-xxxxx (it is a bill, not the account) and
  -- now attached to the customer's one account.
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

  -- The unpaid part is added to what this customer already owes.
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
$$;

revoke all on function close_bill_with_credit(uuid, uuid, numeric, numeric, numeric, numeric, uuid, text, text, text, uuid) from public;
grant execute on function close_bill_with_credit(uuid, uuid, numeric, numeric, numeric, numeric, uuid, text, text, text, uuid) to service_role;

-- ── Take a payment against the ACCOUNT ────────────────────────────────────────
-- Lowers the customer's balance and allocates the money FIFO across their open
-- bills (oldest first), so each bill keeps an accurate paid_amount and status
-- while the customer still deals with a single Credit ID and a single balance.
drop function if exists record_credit_payment(uuid, uuid, numeric, text, text, uuid);

create function record_credit_payment(
  p_restaurant_id uuid,
  p_customer_id   uuid,
  p_amount        numeric,
  p_method        text,
  p_notes         text,
  p_received_by   uuid
) returns credit_customers
language plpgsql
as $$
declare
  v_cust      credit_customers;
  v_applied   numeric;
  v_remaining numeric;
  v_bill      credits;
  v_take      numeric;
begin
  -- `for update` serialises two cashiers taking money from the same customer.
  select * into v_cust
    from credit_customers
   where id = p_customer_id
     and restaurant_id = p_restaurant_id
     for update;
  if not found then
    raise exception 'CUSTOMER_NOT_FOUND';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if v_cust.balance <= 0 then
    raise exception 'NOTHING_OWED';
  end if;

  -- Never overpay. A hair over settles it exactly (rounding on the cashier's
  -- side); anything more is a mistake.
  if p_amount > v_cust.balance + 0.005 then
    raise exception 'AMOUNT_EXCEEDS_BALANCE';
  end if;
  v_applied := least(p_amount, v_cust.balance);

  -- One ledger row against the account — this is the payment history.
  insert into credit_payments (customer_id, credit_id, restaurant_id, amount, method, notes, received_by)
  values (
    p_customer_id, null, p_restaurant_id, v_applied, p_method::payment_method,
    nullif(btrim(coalesce(p_notes, '')), ''), p_received_by
  );

  -- Allocate it across the open bills, oldest first, so each bill's status stays
  -- true. The account balance remains the single source of what is owed.
  --
  -- `seq_no` breaks ties: two bills raised in the same instant would otherwise
  -- have an arbitrary allocation order, so the same payment could settle a
  -- different bill on a re-read. seq_no is monotonic per restaurant, so FIFO is
  -- deterministic.
  v_remaining := v_applied;
  for v_bill in
    select * from credits
     where customer_id = p_customer_id
       and status <> 'fully_paid'
     order by created_at, seq_no
     for update
  loop
    exit when v_remaining <= 0;

    v_take := least(v_remaining, v_bill.bill_amount - v_bill.paid_amount);
    if v_take <= 0 then
      continue;
    end if;

    update credits
       set paid_amount = paid_amount + v_take,
           status = case when bill_amount - (paid_amount + v_take) <= 0.005
                         then 'fully_paid' else 'partially_paid' end,
           settled_at = case when bill_amount - (paid_amount + v_take) <= 0.005
                             then now() else null end
     where id = v_bill.id;

    v_remaining := v_remaining - v_take;
  end loop;

  update credit_customers
     set balance = balance - v_applied
   where id = p_customer_id
  returning * into v_cust;

  return v_cust;
end;
$$;

revoke all on function record_credit_payment(uuid, uuid, numeric, text, text, uuid) from public;
grant execute on function record_credit_payment(uuid, uuid, numeric, text, text, uuid) to service_role;
