-- =============================================================================
-- 0032_tenders — a bill settled more than one way
--
-- Apply manually after 0031_variants.sql.
--
-- `sale_tenders` has been one-to-many since 0001 and `record_sale` has always
-- written exactly one row into it. The table was right and the code was not:
-- a customer who puts two thousand on a card and hands over the rest in notes
-- is an ordinary Saturday, and until now the till could only record one of
-- those and be wrong about the other. `history.ts` has carried a `writeTender`
-- that says "Split" and a `summarise` with an `other` bucket the whole time,
-- waiting for this.
--
-- **The sum of the tenders is the bill.** `record_sale` refuses anything else.
-- That is the one invariant worth the refusal: every takings figure, every
-- shift variance and the whole of `/app/sales` is a `sum()` over these rows,
-- and a bill whose parts do not add up to its total is a day that will not
-- reconcile and nobody will know why.
--
-- **The wallets were already allowed and were never offered.** The check
-- constraint has listed raast, easypaisa and jazzcash since the beginning;
-- `TENDERS` in `counter.ts` listed two. This migration does not add an
-- integration and nothing here talks to a wallet or a bank — what it adds is
-- the ability to *record* how the money arrived, typed by the cashier, with the
-- transaction id beside it. That is what a shop already writes in the margin,
-- and it is worth having before any integration exists because it is what makes
-- the day reconcile against a JazzCash statement.
--
-- **Which tenders a counter takes becomes a list.** `accepts_cash` and
-- `accepts_card` were two booleans and would have become six; `accepted_tenders`
-- is one array, backfilled from them, and the booleans are dropped rather than
-- left beside it — the same call `0027` made about `items.supplier`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · One more way money arrives, and where its number goes
--
-- 'bank' joins the list: a distributor's shop taking a transfer straight to its
-- account is a real tender and was the only common one missing.
--
-- `reference` is the transaction id, the approval code off the card slip, or
-- the last four digits — whatever the cashier has in front of them. It is what
-- a shop quotes when a wallet statement and the day's takings disagree, and
-- without it a split bill settled by JazzCash is a figure nobody can trace.
-- -----------------------------------------------------------------------------
alter table public.sale_tenders drop constraint if exists sale_tenders_method_check;
alter table public.sale_tenders add constraint sale_tenders_method_check
  check (method in ('cash', 'card', 'raast', 'easypaisa', 'jazzcash', 'bank'));

alter table public.sale_tenders
  add column if not exists reference text
    check (reference is null or length(btrim(reference)) <= 60);

-- Every tender on a bill must be worth something. A zero row is a tender the
-- cashier selected and did not use, and it would show up as a payment method on
-- every report that groups by one.
alter table public.sale_tenders drop constraint if exists sale_tenders_amount_positive;
alter table public.sale_tenders add constraint sale_tenders_amount_positive
  check (amount <> 0);

comment on column public.sale_tenders.reference is
  'The wallet TID, the card approval code, the transfer reference — whatever the cashier can quote when a statement and the day''s takings disagree. Typed, never fetched: nothing in Flo talks to a wallet.';

-- "How was this bill paid?" is read once per bill on the history screen and
-- grouped by method on every report. One index over both.
create index if not exists sale_tenders_tenant_method_idx
  on public.sale_tenders (tenant_id, method);

-- -----------------------------------------------------------------------------
-- 2 · Which tenders a counter takes
--
-- Two booleans would have become six. An array is one column, reads as a list
-- in the one place that draws it, and does not need a migration the day a
-- seventh arrives.
--
-- Backfilled from the booleans so no counter changes behaviour, then the
-- booleans are dropped — a list and two flags holding the same fact is the
-- drift `0027` complains about, and the first counter switched on for cards in
-- only one of them would offer a tender the till refuses.
-- -----------------------------------------------------------------------------
alter table public.counters
  add column if not exists accepted_tenders text[] not null default array['cash'];

update public.counters
   set accepted_tenders =
     (case when accepts_cash then array['cash'] else array[]::text[] end)
     || (case when accepts_card then array['card'] else array[]::text[] end)
 where accepted_tenders = array['cash'];

-- A counter that takes nothing cannot be charged at. Cash is the floor, and it
-- is what every one of these rows already had.
update public.counters
   set accepted_tenders = array['cash']
 where cardinality(accepted_tenders) = 0;

alter table public.counters drop constraint if exists counters_tenders_known;
alter table public.counters add constraint counters_tenders_known
  check (
    cardinality(accepted_tenders) between 1 and 6
    and accepted_tenders <@ array['cash', 'card', 'raast', 'easypaisa', 'jazzcash', 'bank']
  );

alter table public.counters drop column if exists accepts_cash;
alter table public.counters drop column if exists accepts_card;

comment on column public.counters.accepted_tenders is
  'What this till may be paid with, in the order the payment sheet offers them. One array rather than a boolean per method, which is what two of them were on the way to becoming.';

-- -----------------------------------------------------------------------------
-- 3 · The register takes more than one
--
-- Dropped and recreated rather than replaced: `p_tender text` becomes
-- `p_tenders jsonb`, which is a new signature, and a default would leave the
-- old one standing beside it as an overload that silently records half a bill.
--
-- **The sum has to be the total, to the paisa.** Not "at least" and not
-- "roughly": every takings figure in the product is a `sum()` over these rows,
-- and the one thing a shopkeeper cannot catch is a day that is out by a rupee
-- for a reason buried in one bill three weeks ago. A cashier who has typed the
-- split wrongly gets a refusal naming both figures, which is a correction they
-- can make in five seconds with the customer still there.
-- -----------------------------------------------------------------------------
drop function if exists public.record_sale(uuid, uuid, uuid, date, uuid, numeric, numeric, text, jsonb, uuid, numeric, numeric);

create or replace function public.record_sale(
  p_tenant uuid,
  p_counter uuid,
  p_sale_id uuid,
  p_business_day date,
  p_created_by uuid,
  p_subtotal numeric,
  p_total numeric,
  -- `[{"method": "cash", "amount": 500, "reference": null}, …]`. One element on
  -- the overwhelming majority of bills, which is why the till still opens on a
  -- single tender and only offers the split when somebody asks for it.
  p_tenders jsonb,
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
  v_branch uuid; v_prefix text; v_serial integer; v_receipt text; v_line jsonb;
  v_item uuid; v_variant uuid; v_quantity numeric; v_gross numeric;
  v_discount numeric; v_left numeric; v_share numeric; v_index integer := 0;
  v_count integer; v_shift uuid; v_tracked boolean; v_tracking text; v_cost numeric;
  v_tender jsonb; v_paid numeric := 0; v_total numeric; v_allowed text[];
begin
  select receipt_number into v_receipt from public.sales
   where id = p_sale_id and tenant_id = p_tenant;
  if found then
    return jsonb_build_object('receipt_number', v_receipt, 'replayed', true);
  end if;

  v_count := jsonb_array_length(p_lines);

  if p_total < 0 or p_subtotal < 0 or v_count = 0 then
    raise exception 'a sale needs at least one line and a total of zero or more'
      using errcode = '22023';
  end if;

  if p_tenders is null or jsonb_array_length(p_tenders) = 0 then
    raise exception 'a sale has to be paid for somehow' using errcode = '22023';
  end if;

  if jsonb_array_length(p_tenders) > 4 then
    raise exception 'a bill settled four ways is a bill somebody has mistyped'
      using errcode = '22023';
  end if;

  select coalesce(sum((value->>'line_total')::numeric), 0) into v_gross
    from jsonb_array_elements(p_lines);

  v_discount := round(coalesce(p_discount, 0), 2);

  if v_discount < 0 then
    raise exception 'a discount cannot be negative' using errcode = '22023';
  end if;

  if v_discount > v_gross then
    raise exception 'a discount of % is more than the bill of %', v_discount, v_gross
      using errcode = '22023';
  end if;

  if v_discount > 0 and v_discount > ceil(v_gross * coalesce(p_ceiling_pct, 0)) / 100 then
    raise exception 'a discount of % is over this cashier''s ceiling of %%%',
      v_discount, p_ceiling_pct using errcode = 'restrict_violation';
  end if;

  if p_customer is not null and not exists (
    select 1 from public.customers c where c.id = p_customer and c.tenant_id = p_tenant
  ) then
    raise exception 'customer % is not on this shop''s list', p_customer
      using errcode = 'restrict_violation';
  end if;

  update public.counters
     set receipt_serial = case when receipt_day = p_business_day then receipt_serial + 1 else 1 end,
         receipt_day = p_business_day
   where id = p_counter and tenant_id = p_tenant and is_active
  returning branch_id, receipt_prefix, receipt_serial, accepted_tenders
       into v_branch, v_prefix, v_serial, v_allowed;

  if not found then
    raise exception 'counter % is not an open counter for this shop', p_counter
      using errcode = 'restrict_violation';
  end if;

  if v_branch is null then
    raise exception 'counter % has no branch, so a sale has nowhere to land', p_counter
      using errcode = 'restrict_violation';
  end if;

  select id into v_shift from public.shifts
   where tenant_id = p_tenant and counter_id = p_counter and status = 'open';

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
    v_variant := nullif(v_line->>'variant_id', '')::uuid;
    v_quantity := (v_line->>'quantity')::numeric;

    if v_discount = 0 or v_gross = 0 then
      v_share := 0;
    elsif v_index = v_count then
      v_share := v_left;
    else
      v_share := round(v_discount * (v_line->>'line_total')::numeric / v_gross, 2);
    end if;

    v_share := greatest(least(v_share, (v_line->>'line_total')::numeric, v_left), 0);
    v_left := v_left - v_share;

    v_tracked := false;
    v_tracking := 'unit';
    v_cost := 0;

    if v_item is not null then
      select i.tracks_batches, i.tracking, i.cost_price
        into v_tracked, v_tracking, v_cost
        from public.items i where i.id = v_item and i.tenant_id = p_tenant;
    end if;

    if v_variant is not null then
      select coalesce(v.cost_price, v_cost) into v_cost
        from public.item_variants v
       where v.id = v_variant and v.tenant_id = p_tenant and v.item_id = v_item;

      if not found then
        raise exception 'that size or colour is not one of this item''s'
          using errcode = 'restrict_violation';
      end if;
    end if;

    insert into public.sale_lines (
      tenant_id, sale_id, item_id, variant_id, name_snapshot, unit,
      quantity, unit_price, discount, line_total, cost_snapshot
    )
    values (
      p_tenant, p_sale_id, v_item, v_variant, v_line->>'name', v_line->>'unit',
      v_quantity, (v_line->>'unit_price')::numeric, v_share,
      (v_line->>'line_total')::numeric - v_share, coalesce(v_cost, 0)
    );

    if v_variant is not null then
      perform private.move_stock(
        p_tenant, v_item, -v_quantity, 'sale', p_sale_id, null, p_created_by,
        null, null, v_variant
      );
    elsif coalesce(v_tracked, false) then
      perform private.take_from_batches(
        p_tenant, v_item, v_quantity, p_sale_id, p_created_by, p_business_day
      );
    else
      perform private.move_stock(
        p_tenant, v_item, -v_quantity, 'sale', p_sale_id, null, p_created_by
      );
    end if;
  end loop;

  if v_left <> 0 then
    v_discount := v_discount - v_left;

    update public.sales
       set discount_total = v_discount, total = v_gross - v_discount
     where id = p_sale_id;
  end if;

  v_total := v_gross - v_discount;

  -- The tenders, last, so the total they are checked against is the one the
  -- lines actually came to — including the rounding remainder the discount
  -- apportionment may have handed back a few lines above.
  for v_tender in select * from jsonb_array_elements(p_tenders)
  loop
    if not (v_tender->>'method' = any (v_allowed)) then
      raise exception 'this counter does not take %', v_tender->>'method'
        using errcode = 'restrict_violation';
    end if;

    if (v_tender->>'amount')::numeric <= 0 then
      raise exception 'a payment of % is not a payment', v_tender->>'amount'
        using errcode = '22023';
    end if;

    v_paid := v_paid + (v_tender->>'amount')::numeric;

    insert into public.sale_tenders (tenant_id, sale_id, method, amount, reference)
    values (
      p_tenant, p_sale_id, v_tender->>'method',
      (v_tender->>'amount')::numeric,
      nullif(btrim(coalesce(v_tender->>'reference', '')), '')
    );
  end loop;

  -- To the paisa. See the header: a bill whose parts do not add up to its total
  -- is a day that will not reconcile and nobody will know which bill did it.
  if round(v_paid, 2) <> round(v_total, 2) then
    raise exception 'the payments come to % but the bill is %', v_paid, v_total
      using errcode = '22023';
  end if;

  return jsonb_build_object(
    'receipt_number', v_receipt,
    'replayed', false,
    'discount', v_discount,
    'total', v_total,
    'shift_id', v_shift
  );
end;
$fn$;

revoke execute on function public.record_sale(uuid, uuid, uuid, date, uuid, numeric, numeric, jsonb, jsonb, uuid, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.record_sale(uuid, uuid, uuid, date, uuid, numeric, numeric, jsonb, jsonb, uuid, numeric, numeric)
  to service_role;

comment on function public.record_sale(uuid, uuid, uuid, date, uuid, numeric, numeric, jsonb, jsonb, uuid, numeric, numeric) is
  'Records one register sale, claims its counter receipt number, moves every line off the shelf and writes its tenders — atomically. The tenders must sum to the bill exactly.';

-- -----------------------------------------------------------------------------
-- 4 · A shift stops losing the wallets
--
-- `close_shift` split a shift's takings into cash and `method = 'card'`, which
-- was right while cards were the only other tender. From here a till can take
-- Raast and two wallets, and a JazzCash bill counted as neither would have gone
-- missing from both figures on the Shifts tab — the drawer would still balance
-- and the shift would quietly understate what the counter took.
--
-- The cash half is untouched and still filters on `'cash'` alone, which is the
-- whole point: only notes go into a drawer somebody counts, and `expected_cash`
-- has to stay exactly that.
--
-- `shifts.card_total` keeps its name. It is what four screens and every reader
-- already call it, and renaming a column to change a label is a migration
-- across all of them. What it *means* from here is "took, but not into the
-- drawer", and the column comment says so.
-- -----------------------------------------------------------------------------
create or replace function public.close_shift(
  p_tenant uuid, p_shift uuid, p_by uuid, p_counted numeric, p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_shift public.shifts%rowtype;
  v_cash numeric;
  v_other numeric;
  v_bills integer;
  v_expected numeric;
begin
  if p_counted is null or p_counted < 0 or p_counted > 9999999 then
    raise exception 'a counted figure of % is not an amount', p_counted
      using errcode = '22023';
  end if;

  select * into v_shift
    from public.shifts
   where id = p_shift and tenant_id = p_tenant
     for update;

  if not found then
    raise exception 'shift % is not this shop''s', p_shift
      using errcode = 'restrict_violation';
  end if;

  if v_shift.status <> 'open' then
    return jsonb_build_object(
      'closed', false, 'expected', v_shift.expected_cash,
      'counted', v_shift.closing_cash, 'over_short', v_shift.over_short,
      'card', v_shift.card_total, 'bills', v_shift.bills
    );
  end if;

  select
      coalesce(sum(t.amount) filter (where t.method = 'cash'), 0),
      coalesce(sum(t.amount) filter (where t.method <> 'cash'), 0),
      count(distinct s.id) filter (where s.total >= 0)
    into v_cash, v_other, v_bills
    from public.sales s
    left join public.sale_tenders t
      on t.sale_id = s.id and t.tenant_id = p_tenant
   where s.tenant_id = p_tenant and s.shift_id = p_shift;

  v_expected := round(v_shift.opening_float + v_cash, 2);

  update public.shifts
     set status = 'closed',
         closed_by = p_by,
         closed_at = now(),
         closing_cash = round(p_counted, 2),
         expected_cash = v_expected,
         over_short = round(p_counted, 2) - v_expected,
         card_total = v_other,
         bills = v_bills,
         note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note)
   where id = p_shift;

  return jsonb_build_object(
    'closed', true, 'expected', v_expected, 'counted', round(p_counted, 2),
    'over_short', round(p_counted, 2) - v_expected, 'card', v_other,
    'bills', v_bills
  );
end;
$fn$;

revoke execute on function public.close_shift(uuid, uuid, uuid, numeric, text)
  from public, anon, authenticated;
grant execute on function public.close_shift(uuid, uuid, uuid, numeric, text) to service_role;

comment on column public.shifts.card_total is
  'What the shift took that did NOT go into the drawer — card, Raast, wallets, transfers. Named card_total since 0026, when cards were the only one.';
