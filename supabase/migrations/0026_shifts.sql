-- =============================================================================
-- 0026_shifts — the drawer gets counted, and by somebody
--
-- Apply manually after 0025_held_bills.sql.
--
-- `public.shifts` has existed since 0008 and nothing has ever written a row.
-- `role_permissions.can_close_shift` has been stored, editable and read by
-- nothing since 0009. So Day close totals a *day*: it can tell an owner what
-- counter 1 took between opening and midnight, and it cannot tell them what
-- should be in the drawer right now, what Bilal's till was short by on Tuesday,
-- or whether the float was ever put in.
--
-- That gap is where a shop actually loses money. A day that is Rs 300 light is
-- invisible against forty thousand; the same Rs 300 against one person's
-- four-hour shift is a conversation. Nothing else in the product creates
-- accountability for cash, because cash is the one thing here that a screen
-- cannot observe.
--
-- Three decisions.
--
-- **A shift belongs to a counter, not to a device.** 0008 keyed it on
-- `register_devices`, a table nothing writes and nothing reads; `counters` is
-- what the console actually has, what the receipt series hangs off and what the
-- drawer physically is. The `device_id` column goes rather than staying as a
-- second answer to the same question.
--
-- **A shift is required before a counter can charge anything.** That gate is
-- enforced in the Server Actions rather than here, for the reason the stock
-- gate is: a refusal at that layer can be a sentence a cashier acts on, where a
-- raise from a function is a failed write. `shift_id` stays nullable all the
-- same, because it has to hold every sale rung up before this migration ran and
-- because a null is still the honest record of a sale that belonged to no
-- drawer. What the gate buys is that no new ones are created: a day half-filled
-- with sales belonging to nobody's count is the paperwork of a shift without
-- any of its accountability.
--
-- **The cashier counts and the permission decides who sees the variance.**
-- Anybody may close their own shift by typing what is in the drawer. Only
-- somebody with `can_close_shift` is shown the over-or-short, which is exactly
-- what that switch's own label on Settings has always promised — "Also shows
-- the over-or-short". A cashier who can see the expected figure before they
-- count is a cashier who can count to it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · The shift belongs to a till
--
-- Written as add-then-backfill-then-drop inside one migration, so no shop
-- spends a moment with neither column. In practice there is nothing to
-- backfill — the table has never had a row — and it is written this way anyway
-- because a migration that is only correct on empty data is a migration nobody
-- can run twice.
-- -----------------------------------------------------------------------------
alter table public.shifts
  add column if not exists counter_id uuid
    references public.counters (id) on delete set null,
  -- What Flo says should be in the drawer, stamped at the moment of closing.
  -- Stored rather than re-derived, for the reason `cost_snapshot` is: it is
  -- worked out from the shift's own sales, and a sale refunded next Tuesday
  -- would otherwise rewrite last Tuesday's over-or-short.
  add column if not exists expected_cash numeric(12, 2),
  -- What the card machine took on this shift. Not part of the drawer count and
  -- recorded beside it, because the first thing anybody asks a short drawer is
  -- whether something was rung up as cash that went on the card.
  add column if not exists card_total numeric(12, 2) not null default 0,
  -- How many bills the shift rang up, refunds excluded. The denominator behind
  -- "Rs 300 short" — short across nine bills and short across two hundred are
  -- different problems.
  add column if not exists bills integer not null default 0,
  add column if not exists note text
    check (note is null or length(btrim(note)) <= 200);

-- One open shift per counter, which is the whole invariant. Two open at once
-- on one drawer is two people each counting the other's takings.
--
-- 0008's index was per device and is dropped rather than left beside this one:
-- `device_id` goes below, and a unique index over a column that no longer
-- exists is not a thing Postgres will keep for us.
drop index if exists public.shifts_one_open_per_device_idx;

create unique index if not exists shifts_one_open_per_counter_idx
  on public.shifts (counter_id)
  where status = 'open' and counter_id is not null;

create index if not exists shifts_counter_opened_idx
  on public.shifts (tenant_id, counter_id, opened_at desc);

alter table public.shifts drop column if exists device_id;

comment on table public.shifts is
  'One person''s time on one counter, from the float going in to the drawer being counted. Optional: a sale with a null shift_id is a sale rung up outside any shift, and counts everywhere except in somebody''s drawer.';
comment on column public.shifts.expected_cash is
  'What should have been in the drawer, stamped at closing from the shift''s own sales. Never re-derived, or a refund next week would rewrite last week''s over-or-short.';
comment on column public.shifts.over_short is
  'Counted minus expected. Negative is short. Recorded whoever closed the shift; shown only to somebody with can_close_shift.';

-- -----------------------------------------------------------------------------
-- 2 · Opening one
--
-- The float is the only thing asked for, because it is the only thing that is
-- true at the start and unknowable afterwards: a drawer that started with
-- Rs 2,000 in change and a drawer that started empty are Rs 2,000 apart at
-- 11 pm, and nobody remembers which by then.
--
-- The branch comes off the counter rather than from the caller. It is not-null
-- on this table and a shift with the wrong one would be a shift that reports
-- under another shop's branch the day a shop has two.
-- -----------------------------------------------------------------------------
create or replace function public.open_shift(
  p_tenant uuid,
  p_counter uuid,
  p_by uuid,
  p_float numeric,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_branch uuid;
  v_id uuid;
  v_open uuid;
begin
  if p_float is null or p_float < 0 or p_float > 9999999 then
    raise exception 'an opening float of % is not an amount', p_float
      using errcode = '22023';
  end if;

  select branch_id into v_branch
    from public.counters
   where id = p_counter
     and tenant_id = p_tenant
     and is_active;

  if not found or v_branch is null then
    raise exception 'counter % is not an open counter for this shop', p_counter
      using errcode = 'restrict_violation';
  end if;

  -- Already open. Returned rather than raised, because the two tablets pointed
  -- at one counter both opening at 9 am is not an error — it is the second one
  -- finding out it is already in somebody's shift, which is what it needs to
  -- know.
  select id into v_open
    from public.shifts
   where tenant_id = p_tenant
     and counter_id = p_counter
     and status = 'open';

  if found then
    return jsonb_build_object('shift_id', v_open, 'opened', false);
  end if;

  insert into public.shifts (
    tenant_id, branch_id, counter_id, opened_by, opening_float, status, note
  )
  values (
    p_tenant, v_branch, p_counter, p_by, round(p_float, 2), 'open',
    nullif(btrim(coalesce(p_note, '')), '')
  )
  returning id into v_id;

  return jsonb_build_object('shift_id', v_id, 'opened', true);
end;
$fn$;

revoke execute on function public.open_shift(uuid, uuid, uuid, numeric, text)
  from public, anon, authenticated;
grant execute on function public.open_shift(uuid, uuid, uuid, numeric, text)
  to service_role;

comment on function public.open_shift(uuid, uuid, uuid, numeric, text) is
  'Starts a shift on one counter with the float that went into the drawer. Returns the shift already open rather than raising, because two tablets on one till both opening at 9 am is not an error.';

-- -----------------------------------------------------------------------------
-- 3 · Closing one
--
-- The expected figure is worked out here, inside the transaction that closes
-- the shift, from the shift's own sales — and then stored. That is the whole
-- point of `expected_cash` being a column: a sale refunded next Tuesday is a
-- negative tender on *next Tuesday's* shift, and re-deriving this figure
-- afterwards would quietly rewrite what Bilal's drawer was short by last week.
--
-- Cash only. The card machine's takings never went into the drawer, so
-- including them would make every shift look short by the day's card total.
-- They are recorded beside it because the first thing anybody asks a short
-- drawer is whether something rung up as cash actually went on the card.
--
-- Refunds need no special case, which is the benefit of 0024's shape: a refund
-- is a negative sale with a negative cash tender, so the notes that went back
-- out of the drawer come off the expected figure by arithmetic.
-- -----------------------------------------------------------------------------
create or replace function public.close_shift(
  p_tenant uuid,
  p_shift uuid,
  p_by uuid,
  -- What was actually counted out of the drawer.
  p_counted numeric,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_shift public.shifts%rowtype;
  v_cash numeric;
  v_card numeric;
  v_bills integer;
  v_expected numeric;
begin
  if p_counted is null or p_counted < 0 or p_counted > 9999999 then
    raise exception 'a counted figure of % is not an amount', p_counted
      using errcode = '22023';
  end if;

  -- Locked, so two people closing the same drawer at once queue rather than
  -- both writing an over-or-short against the same takings.
  select * into v_shift
    from public.shifts
   where id = p_shift
     and tenant_id = p_tenant
     for update;

  if not found then
    raise exception 'shift % is not this shop''s', p_shift
      using errcode = 'restrict_violation';
  end if;

  -- Already closed. Handed back as it stands rather than raised, so a retry
  -- after a dropped connection shows the cashier the figures that were
  -- recorded instead of an error against a drawer they have already counted.
  if v_shift.status <> 'open' then
    return jsonb_build_object(
      'closed', false,
      'expected', v_shift.expected_cash,
      'counted', v_shift.closing_cash,
      'over_short', v_shift.over_short,
      'card', v_shift.card_total,
      'bills', v_shift.bills
    );
  end if;

  select
      coalesce(sum(t.amount) filter (where t.method = 'cash'), 0),
      coalesce(sum(t.amount) filter (where t.method = 'card'), 0),
      count(distinct s.id) filter (where s.total >= 0)
    into v_cash, v_card, v_bills
    from public.sales s
    left join public.sale_tenders t
      on t.sale_id = s.id and t.tenant_id = p_tenant
   where s.tenant_id = p_tenant
     and s.shift_id = p_shift;

  v_expected := round(v_shift.opening_float + v_cash, 2);

  update public.shifts
     set status = 'closed',
         closed_by = p_by,
         closed_at = now(),
         closing_cash = round(p_counted, 2),
         expected_cash = v_expected,
         over_short = round(p_counted, 2) - v_expected,
         card_total = v_card,
         bills = v_bills,
         note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note)
   where id = p_shift;

  return jsonb_build_object(
    'closed', true,
    'expected', v_expected,
    'counted', round(p_counted, 2),
    'over_short', round(p_counted, 2) - v_expected,
    'card', v_card,
    'bills', v_bills
  );
end;
$fn$;

revoke execute on function public.close_shift(uuid, uuid, uuid, numeric, text)
  from public, anon, authenticated;
grant execute on function public.close_shift(uuid, uuid, uuid, numeric, text)
  to service_role;

comment on function public.close_shift(uuid, uuid, uuid, numeric, text) is
  'Counts one drawer against its own sales and stamps the over-or-short. Cash only: the card machine never went into the drawer. Idempotent — a retry on a closed shift hands back the figures already recorded.';

-- -----------------------------------------------------------------------------
-- 4 · Every sale lands in the open shift
--
-- Looked up here rather than passed in, and that is the point: the browser
-- cannot name a shift, so it cannot put a sale in somebody else's drawer. The
-- counter is already proved to be this shop's two statements below, so the
-- shift found through it is too.
--
-- A null is the ordinary case for a shop that does not use shifts, and it is
-- not an error anywhere. The sale counts in the takings, the dashboard and
-- every report exactly as it does today; it is simply not part of a drawer
-- count, which is the truth about it.
-- -----------------------------------------------------------------------------
create or replace function public.record_sale(
  p_tenant uuid,
  p_counter uuid,
  p_sale_id uuid,
  p_business_day date,
  p_created_by uuid,
  p_subtotal numeric,
  p_total numeric,
  p_tender text,
  p_lines jsonb,
  p_customer uuid,
  p_discount numeric default 0,
  p_ceiling_pct numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_branch uuid;
  v_prefix text;
  v_serial integer;
  v_receipt text;
  v_line jsonb;
  v_item uuid;
  v_quantity numeric;
  v_gross numeric;
  v_discount numeric;
  v_left numeric;
  v_share numeric;
  v_index integer := 0;
  v_count integer;
  v_shift uuid;
begin
  select receipt_number into v_receipt
  from public.sales
  where id = p_sale_id and tenant_id = p_tenant;

  if found then
    return jsonb_build_object('receipt_number', v_receipt, 'replayed', true);
  end if;

  v_count := jsonb_array_length(p_lines);

  if p_total < 0 or p_subtotal < 0 or v_count = 0 then
    raise exception 'a sale needs at least one line and a total of zero or more'
      using errcode = '22023';
  end if;

  select coalesce(sum((value->>'line_total')::numeric), 0)
    into v_gross
    from jsonb_array_elements(p_lines);

  v_discount := round(coalesce(p_discount, 0), 2);

  if v_discount < 0 then
    raise exception 'a discount cannot be negative'
      using errcode = '22023';
  end if;

  if v_discount > v_gross then
    raise exception 'a discount of % is more than the bill of %', v_discount, v_gross
      using errcode = '22023';
  end if;

  if v_discount > 0 and v_discount > ceil(v_gross * coalesce(p_ceiling_pct, 0)) / 100 then
    raise exception 'a discount of % is over this cashier''s ceiling of %%%',
      v_discount, p_ceiling_pct
      using errcode = 'restrict_violation';
  end if;

  if p_customer is not null and not exists (
    select 1 from public.customers c
    where c.id = p_customer and c.tenant_id = p_tenant
  ) then
    raise exception 'customer % is not on this shop''s list', p_customer
      using errcode = 'restrict_violation';
  end if;

  update public.counters
     set receipt_serial = case when receipt_day = p_business_day then receipt_serial + 1 else 1 end,
         receipt_day = p_business_day
   where id = p_counter
     and tenant_id = p_tenant
     and is_active
  returning branch_id, receipt_prefix, receipt_serial
       into v_branch, v_prefix, v_serial;

  if not found then
    raise exception 'counter % is not an open counter for this shop', p_counter
      using errcode = 'restrict_violation';
  end if;

  if v_branch is null then
    raise exception 'counter % has no branch, so a sale has nowhere to land', p_counter
      using errcode = 'restrict_violation';
  end if;

  -- Whichever shift this till is in. The Server Action has already refused a
  -- counter with no open drawer, so in practice this always finds one — the
  -- column stays nullable for the sales that predate the gate.
  select id into v_shift
    from public.shifts
   where tenant_id = p_tenant
     and counter_id = p_counter
     and status = 'open';

  v_receipt := v_prefix || '-' || to_char(p_business_day, 'YYMMDD') || '-' || lpad(v_serial::text, 4, '0');

  insert into public.sales (
    id, tenant_id, branch_id, counter_id, customer_id, receipt_number,
    business_day, status, subtotal, discount_total, total, created_by, shift_id
  )
  values (
    p_sale_id, p_tenant, v_branch, p_counter, p_customer, v_receipt,
    p_business_day, 'completed', v_gross, v_discount, v_gross - v_discount,
    p_created_by, v_shift
  );

  v_left := v_discount;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_index := v_index + 1;
    v_item := nullif(v_line->>'item_id', '')::uuid;
    v_quantity := (v_line->>'quantity')::numeric;

    if v_discount = 0 or v_gross = 0 then
      v_share := 0;
    elsif v_index = v_count then
      v_share := v_left;
    else
      v_share := round(v_discount * (v_line->>'line_total')::numeric / v_gross, 2);
    end if;

    -- Never more than the line is worth, and never more than is left to give
    -- away. Both clamps are for the pathological bill rather than the ordinary
    -- one: two hundred small lines, each rounded, can leave the last one
    -- holding more discount than it is worth — and a line whose total went
    -- negative fails sale_lines_line_total_check and refuses the whole sale
    -- with a customer standing there.
    v_share := greatest(least(v_share, (v_line->>'line_total')::numeric, v_left), 0);

    v_left := v_left - v_share;

    insert into public.sale_lines (
      tenant_id, sale_id, item_id, name_snapshot, unit,
      quantity, unit_price, discount, line_total, cost_snapshot
    )
    values (
      p_tenant,
      p_sale_id,
      v_item,
      v_line->>'name',
      v_line->>'unit',
      v_quantity,
      (v_line->>'unit_price')::numeric,
      v_share,
      (v_line->>'line_total')::numeric - v_share,
      coalesce((
        select i.cost_price from public.items i
         where i.id = v_item and i.tenant_id = p_tenant
      ), 0)
    );

    perform private.move_stock(
      p_tenant, v_item, -v_quantity, 'sale', p_sale_id, null, p_created_by
    );
  end loop;

  -- Whatever the clamps above would not let onto a line. Taken off the discount
  -- rather than left dangling, because `sum(line_total)` has to equal
  -- `sales.total` exactly — every share on every report is worked out over that
  -- sum, and a bill where the two disagree is a bill that makes departments add
  -- up to something other than a hundred. It is paise on the one sale in a
  -- million that reaches here, and the customer is charged what the lines on
  -- the receipt add up to.
  if v_left <> 0 then
    v_discount := v_discount - v_left;

    update public.sales
       set discount_total = v_discount,
           total = v_gross - v_discount
     where id = p_sale_id;
  end if;

  insert into public.sale_tenders (tenant_id, sale_id, method, amount)
  values (p_tenant, p_sale_id, p_tender, v_gross - v_discount);

  return jsonb_build_object(
    'receipt_number', v_receipt,
    'replayed', false,
    'discount', v_discount,
    'total', v_gross - v_discount,
    'shift_id', v_shift
  );
end;
$fn$;

revoke execute on function public.record_sale(uuid, uuid, uuid, date, uuid, numeric, numeric, text, jsonb, uuid, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.record_sale(uuid, uuid, uuid, date, uuid, numeric, numeric, text, jsonb, uuid, numeric, numeric)
  to service_role;

comment on function public.record_sale(uuid, uuid, uuid, date, uuid, numeric, numeric, text, jsonb, uuid, numeric, numeric) is
  'Records one register sale: claims the counter receipt number, apportions any discount across the lines, takes every line off the shelf and lands it in whichever shift the till is in — atomically. Replays safely on a repeated sale id.';

-- -----------------------------------------------------------------------------
-- 5 · And so does every refund
--
-- Into the shift the money actually left, not the shift the original sale was
-- rung up in. A week-old bill refunded this afternoon is this afternoon's
-- drawer that is lighter, and putting it against last week's closed shift would
-- rewrite an over-or-short somebody has already been asked about.
-- -----------------------------------------------------------------------------
create or replace function public.record_return(
  p_tenant uuid,
  p_counter uuid,
  p_return_id uuid,
  p_business_day date,
  p_created_by uuid,
  p_sale_id uuid,
  p_lines jsonb,
  p_tender text,
  p_restock boolean,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_branch uuid;
  v_prefix text;
  v_serial integer;
  v_receipt text;
  v_line jsonb;
  v_original public.sale_lines%rowtype;
  v_want numeric;
  v_done numeric;
  v_unit_net numeric;
  v_unit_discount numeric;
  v_amount numeric;
  v_discount numeric;
  v_gross numeric := 0;
  v_off numeric := 0;
  v_net numeric := 0;
  v_sale public.sales%rowtype;
  v_shift uuid;
begin
  select receipt_number into v_receipt
  from public.sales
  where id = p_return_id and tenant_id = p_tenant;

  if found then
    return jsonb_build_object('receipt_number', v_receipt, 'replayed', true);
  end if;

  if jsonb_array_length(p_lines) = 0 then
    raise exception 'a return needs at least one line'
      using errcode = '22023';
  end if;

  select * into v_sale
    from public.sales
   where id = p_sale_id
     and tenant_id = p_tenant
     for update;

  if not found then
    raise exception 'bill % is not this shop''s', p_sale_id
      using errcode = 'restrict_violation';
  end if;

  if v_sale.status <> 'completed' then
    raise exception 'bill % is not a completed sale, so there is nothing to give back', p_sale_id
      using errcode = 'restrict_violation';
  end if;

  update public.counters
     set receipt_serial = case when receipt_day = p_business_day then receipt_serial + 1 else 1 end,
         receipt_day = p_business_day
   where id = p_counter
     and tenant_id = p_tenant
     and is_active
  returning branch_id, receipt_prefix, receipt_serial
       into v_branch, v_prefix, v_serial;

  if not found then
    raise exception 'counter % is not an open counter for this shop', p_counter
      using errcode = 'restrict_violation';
  end if;

  select id into v_shift
    from public.shifts
   where tenant_id = p_tenant
     and counter_id = p_counter
     and status = 'open';

  v_receipt := v_prefix || '-' || to_char(p_business_day, 'YYMMDD') || '-' || lpad(v_serial::text, 4, '0');

  insert into public.sales (
    id, tenant_id, branch_id, counter_id, customer_id, receipt_number,
    business_day, status, subtotal, discount_total, total, created_by,
    refunds_sale_id, note, shift_id
  )
  values (
    p_return_id, p_tenant, v_branch, p_counter,
    v_sale.customer_id, v_receipt,
    p_business_day, 'refund', 0, 0, 0, p_created_by,
    p_sale_id, nullif(btrim(coalesce(p_note, '')), ''), v_shift
  );

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    select * into v_original
      from public.sale_lines
     where id = (v_line->>'line_id')::uuid
       and sale_id = p_sale_id
       and tenant_id = p_tenant
       for update;

    if not found then
      raise exception 'that line is not on bill %', p_sale_id
        using errcode = 'restrict_violation';
    end if;

    v_want := (v_line->>'quantity')::numeric;

    if v_want is null or v_want <= 0 then
      raise exception 'a return of % is not a quantity', v_want
        using errcode = '22023';
    end if;

    select coalesce(-sum(l.quantity), 0) into v_done
      from public.sale_lines l
     where l.refunds_line_id = v_original.id
       and l.tenant_id = p_tenant;

    if v_want > v_original.quantity - v_done then
      raise exception 'only % of % are still returnable on that line',
        v_original.quantity - v_done, v_original.quantity
        using errcode = 'restrict_violation';
    end if;

    v_unit_net := v_original.line_total / v_original.quantity;
    v_unit_discount := v_original.discount / v_original.quantity;

    v_amount := round(v_unit_net * v_want, 2);
    v_discount := round(v_unit_discount * v_want, 2);

    insert into public.sale_lines (
      tenant_id, sale_id, item_id, name_snapshot, unit,
      quantity, unit_price, discount, line_total, cost_snapshot,
      refunds_line_id
    )
    values (
      p_tenant,
      p_return_id,
      v_original.item_id,
      v_original.name_snapshot,
      v_original.unit,
      -v_want,
      v_original.unit_price,
      -v_discount,
      -v_amount,
      v_original.cost_snapshot,
      v_original.id
    );

    v_gross := v_gross + round(v_original.unit_price * v_want, 2);
    v_off := v_off + v_discount;
    v_net := v_net + v_amount;

    if p_restock then
      perform private.move_stock(
        p_tenant, v_original.item_id, v_want, 'return', p_return_id, null, p_created_by
      );
    end if;
  end loop;

  update public.sales
     set subtotal = -v_gross,
         discount_total = -v_off,
         total = -v_net
   where id = p_return_id;

  insert into public.sale_tenders (tenant_id, sale_id, method, amount)
  values (p_tenant, p_return_id, p_tender, -v_net);

  return jsonb_build_object(
    'receipt_number', v_receipt,
    'replayed', false,
    'total', v_net
  );
end;
$fn$;

revoke execute on function public.record_return(uuid, uuid, uuid, date, uuid, uuid, jsonb, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.record_return(uuid, uuid, uuid, date, uuid, uuid, jsonb, text, boolean, text)
  to service_role;

comment on function public.record_return(uuid, uuid, uuid, date, uuid, uuid, jsonb, text, boolean, text) is
  'Reverses part or all of one bill into whichever shift the till is in now — not the one the original was rung up in, because it is today''s drawer that is lighter. Replays safely on a repeated return id.';

-- -----------------------------------------------------------------------------
-- 6 · The flag stops lying
--
-- 0020's rule again: `shift_close` was flipped false because `shifts` was
-- written by nothing, and it goes back to true in the migration that writes it.
-- Both plans, because a drawer that is never counted is not a tier — a shop on
-- Standard has exactly the same cash and exactly the same problem.
-- -----------------------------------------------------------------------------
update public.plans
   set features = features || jsonb_build_object('shift_close', true)
 where code in ('standard', 'premium');
