-- =============================================================================
-- 0023_discounts — the till can take Rs 20 off
--
-- Apply manually after 0022_stock_moves.sql.
--
-- `sales.discount_total` and `sale_lines.discount` have been columns since
-- 0008 and `record_sale` has written a hard-coded zero into both since the day
-- it was written. `role_permissions.can_discount` and `discount_ceiling_pct`
-- are stored, editable on Settings, and read by nothing. So an owner sets a
-- cashier's ceiling at 5%, the cashier is asked for Rs 20 off a Rs 478 bill,
-- and the only thing the register can do is nothing.
--
-- What actually happens then is the point. The cashier takes the twenty out of
-- the drawer, or rings up one item fewer, or hands over the shopping and
-- writes it in a notebook — and the shop's books are wrong in a way no report
-- will ever surface, because the discount that explains the gap was never
-- recorded. Haggling is not an edge case in a Pakistani shop; it is Tuesday.
-- A till that cannot take Rs 20 off is a till the cashier works around, and a
-- till the cashier works around is a till that stops being the record.
--
-- **The discount is apportioned across the lines.** That is the decision worth
-- explaining, because the obvious implementation is to put the whole figure on
-- `sales.discount_total` and leave `sale_lines` alone. Doing that breaks a
-- promise the reports already make: every share on a windowed tab is worked
-- out over the sum of line totals, so departments add up to a hundred and an
-- item's share is comparable with a category's. Leave the discount off the
-- lines and that sum is the bill before haggling while `sales.total` is the
-- bill after it, and the two disagree by exactly the amount nobody can see.
-- Worse, `cost_snapshot` is on the line: an item discounted to cost would go on
-- showing its full margin for ever.
--
-- So the rupees come off the lines, pro rata, and `sales.discount_total` is the
-- sum of what came off. `sum(line_total)` still equals `sales.total`, every
-- report still adds up, and the profit on a discounted bill is the profit the
-- shop actually made.
--
-- The ceiling is enforced here as well as in the Server Action, for the reason
-- every other limit in this schema is: the action is the gate and the function
-- is the floor, and a discount is the one field on a bill where the person
-- typing it benefits from the number being wrong.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · A line can be discounted below nothing, and cannot go below zero
--
-- `sale_lines.discount` was already `>= 0` and `line_total` already `>= 0`.
-- Both still hold — apportioning can only ever take a line down to zero, and
-- the clamp below guarantees it — so there is nothing to relax. What is worth
-- stating is what the columns now mean, because until this migration one of
-- them was a constant.
-- -----------------------------------------------------------------------------
comment on column public.sale_lines.discount is
  'What came off this line, in rupees. The bill-level discount apportioned pro rata by line total, so sum(line_total) still equals sales.total and every report still adds up.';
comment on column public.sale_lines.line_total is
  'What this line came to after its share of the discount. Net, not gross — the reports sum this column and the shop was paid the net.';
comment on column public.sales.discount_total is
  'What came off the whole bill, and the sum of sale_lines.discount. Written by record_sale from a figure the Server Action has already checked against the cashier''s ceiling.';

-- -----------------------------------------------------------------------------
-- 2 · `record_sale` takes the discount
--
-- A new argument, so the old signature is dropped rather than replaced — a
-- shop left with both would have a service role able to call the one that
-- silently ignores the discount it was given.
--
-- `p_discount` is rupees off the whole bill, never a percentage. The screen
-- offers per cent because that is how a ceiling is set and how half the
-- haggling is phrased, and it resolves to rupees before it leaves the browser:
-- a percentage stored on the sale is a figure that has to be re-multiplied by
-- every reader, and two readers rounding differently is two answers to what the
-- shop was paid.
--
-- `p_ceiling_pct` is what this cashier is allowed. The Server Action has
-- already checked it — this is the floor under that check, not a substitute
-- for it, and it raises rather than clamps: a discount over the ceiling is not
-- a rounding problem, it is either a bug or somebody trying it on, and
-- quietly reducing it would record a bill the customer did not agree to.
-- -----------------------------------------------------------------------------
drop function if exists public.record_sale(uuid, uuid, uuid, date, uuid, numeric, numeric, text, jsonb, uuid);

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
  -- Rupees off the whole bill. Zero for the overwhelming majority of sales.
  p_discount numeric default 0,
  -- The most this cashier may take off, as a percentage of the subtotal.
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

  -- The bill before haggling, added up here rather than taken from p_subtotal,
  -- because the apportioning below divides by it and a mismatch between the
  -- two would hand the last line the rounding error for the whole sale.
  select coalesce(sum((value->>'line_total')::numeric), 0)
    into v_gross
    from jsonb_array_elements(p_lines);

  v_discount := round(coalesce(p_discount, 0), 2);

  if v_discount < 0 then
    raise exception 'a discount cannot be negative'
      using errcode = '22023';
  end if;

  -- Never more than the bill. A discount that takes a sale below zero is not a
  -- discount, it is the shop paying the customer.
  if v_discount > v_gross then
    raise exception 'a discount of % is more than the bill of %', v_discount, v_gross
      using errcode = '22023';
  end if;

  -- The floor under the Server Action's check. Rounded up to the paisa in the
  -- shop's favour so a ceiling of 5% on Rs 478 allows Rs 23.90 and not Rs 23.89
  -- — a cashier refused for one paisa would rightly conclude the limit is
  -- broken rather than that it is exact.
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

  v_receipt := v_prefix || '-' || to_char(p_business_day, 'YYMMDD') || '-' || lpad(v_serial::text, 4, '0');

  insert into public.sales (
    id, tenant_id, branch_id, counter_id, customer_id, receipt_number,
    business_day, status, subtotal, discount_total, total, created_by
  )
  values (
    p_sale_id, p_tenant, v_branch, p_counter, p_customer, v_receipt,
    -- `subtotal` is the bill before haggling and `total` is after it, which is
    -- what those two column names have always meant and what the screen prints.
    p_business_day, 'completed', v_gross, v_discount, v_gross - v_discount,
    p_created_by
  );

  -- What is left to give away. Each line takes its share and the last line
  -- takes the remainder, so the parts add to the whole exactly — apportioning
  -- Rs 20 across three lines by rounding each share independently leaves the
  -- shop a paisa out on roughly half of all bills, and a receipt whose lines do
  -- not add to its total is a receipt a customer is right to query.
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
      -- The price on the shelf, unchanged. A discount is not a price cut: the
      -- receipt has to show what the item costs and what came off it, or the
      -- customer cannot check the arithmetic and the shop cannot tell a
      -- haggled sale from a repriced one afterwards.
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

  -- What the customer actually handed over, which after a discount is not
  -- `p_total` as the browser computed it and not `v_gross` either.
  insert into public.sale_tenders (tenant_id, sale_id, method, amount)
  values (p_tenant, p_sale_id, p_tender, v_gross - v_discount);

  return jsonb_build_object(
    'receipt_number', v_receipt,
    'replayed', false,
    'discount', v_discount,
    'total', v_gross - v_discount
  );
end;
$fn$;

revoke execute on function public.record_sale(uuid, uuid, uuid, date, uuid, numeric, numeric, text, jsonb, uuid, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.record_sale(uuid, uuid, uuid, date, uuid, numeric, numeric, text, jsonb, uuid, numeric, numeric)
  to service_role;

comment on function public.record_sale(uuid, uuid, uuid, date, uuid, numeric, numeric, text, jsonb, uuid, numeric, numeric) is
  'Records one register sale, claims its counter receipt number, apportions any discount across the lines and takes every line off the shelf — atomically. Replays safely on a repeated sale id.';
