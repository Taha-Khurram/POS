-- =============================================================================
-- 0019_dashboard_reads_the_shop — the home screen stops describing a shop and
-- starts describing this one
--
-- Apply manually after 0018_customers.sql.
--
-- `lib/pos/dashboard.ts` has been sample data since it was written: fourteen
-- constants, a mulberry32 seeded off the tenant, and a footnote naming the two
-- things missing before it could be real. This migration supplies both.
--
-- 1 · **A cost on the line.** 0015 gave `items` a `cost_price`, which is enough
--     to show a margin on the Products screen and nothing like enough to show
--     one on a report. Joining last month's sales to today's cost column
--     rewrites last month's margins every time a supplier raises a price — the
--     figure moves and nothing on the screen moved with it. So the cost is
--     stamped onto the line at the moment of sale, beside the price and the
--     name, for the same reason `name_snapshot` is: a bill is what happened.
--
-- 2 · **One aggregate, in SQL.** `takings.ts` totals a day in TypeScript and
--     says why — a few hundred rows in one round trip. The dashboard's windows
--     are months, and a month of a busy kiryana is tens of thousands of lines
--     with no business crossing shop 3G to be added up in a browser runtime.
--     `dashboard_summary` groups them where they live.
--
-- Nothing here changes who may write. `sale_lines` was revoked from `anon` and
-- `authenticated` in 0008; the new column is written only by `record_sale` on
-- the service role, and the new function only reads.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · The cost, as it stood
--
-- Per unit, not per line, so it reads like `unit_price` beside it and a line
-- whose quantity is 84.5 kg multiplies out the same way. Zero is the honest
-- default for a shop that has never filled a cost in: a margin of 100% on an
-- item nobody priced is visibly wrong, where a null would silently drop the
-- line out of the sum and make the shop look more profitable than it is.
-- -----------------------------------------------------------------------------
alter table public.sale_lines
  add column if not exists cost_snapshot numeric(12, 2) not null default 0;

alter table public.sale_lines drop constraint if exists sale_lines_cost_snapshot_check;
alter table public.sale_lines add constraint sale_lines_cost_snapshot_check
  check (cost_snapshot >= 0);

comment on column public.sale_lines.cost_snapshot is
  'What one unit cost the shop when this line was rung up. Stamped by record_sale from items.cost_price and never re-derived, or last month margins move when a supplier does.';

-- Rows written before this column existed get today's cost, which is the best
-- evidence there is and is not the same thing as the truth. It is a one-off:
-- every line from here on carries its own.
update public.sale_lines l
   set cost_snapshot = i.cost_price
  from public.items i
 where i.id = l.item_id
   and i.tenant_id = l.tenant_id
   and l.cost_snapshot = 0
   and i.cost_price > 0;

-- -----------------------------------------------------------------------------
-- 2 · `record_sale` stamps it
--
-- Same signature as 0018's, so this is a replace rather than a drop — and the
-- cost is read here, inside the transaction, rather than taken from `p_lines`.
-- The Server Action already re-prices every line from the catalog and could
-- send the cost too, but the cost is the one number on a bill the customer
-- never sees and nobody would notice being wrong. Reading it where the row is
-- inserted leaves no payload to forge and no second code path to keep in step.
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
  -- Null is a walk-in, which is most bills in most shops.
  p_customer uuid
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
begin
  -- Already recorded. The retry gets the same receipt rather than a second one.
  select receipt_number into v_receipt
  from public.sales
  where id = p_sale_id and tenant_id = p_tenant;

  if found then
    return jsonb_build_object('receipt_number', v_receipt, 'replayed', true);
  end if;

  if p_total < 0 or p_subtotal < 0 or jsonb_array_length(p_lines) = 0 then
    raise exception 'a sale needs at least one line and a total of zero or more'
      using errcode = '22023';
  end if;

  -- A customer id that is not this shop's is a crafted request, not a typo, so
  -- it fails the sale rather than being quietly dropped to null. A sale that
  -- silently loses the customer it was rung up against is a sale the shop
  -- cannot find again.
  if p_customer is not null and not exists (
    select 1 from public.customers c
    where c.id = p_customer and c.tenant_id = p_tenant
  ) then
    raise exception 'customer % is not on this shop''s list', p_customer
      using errcode = 'restrict_violation';
  end if;

  -- Claims the next number and proves the counter belongs to this tenant and is
  -- open, in one statement. The row is locked for the rest of the transaction,
  -- so two tablets on the same counter queue rather than collide.
  --
  -- Note the right-hand side of a SET reads the OLD row: `receipt_day` in the
  -- CASE is the day the last sale was rung, which is how the series restarts
  -- each morning without a separate reset job.
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
    p_business_day, 'completed', p_subtotal, 0, p_total, p_created_by
  );

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    -- `name_snapshot` is what the receipt was printed from, which is why 0008
    -- made it not-null and the item reference nullable: deleting an item leaves
    -- every past roll printing exactly as it was rung up. The cost is the same
    -- idea one column along, and it is read against `p_tenant` so a line can
    -- never be costed from another shop's catalog.
    v_item := nullif(v_line->>'item_id', '')::uuid;

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
      (v_line->>'quantity')::numeric,
      (v_line->>'unit_price')::numeric,
      0,
      (v_line->>'line_total')::numeric,
      coalesce((
        select i.cost_price from public.items i
         where i.id = v_item and i.tenant_id = p_tenant
      ), 0)
    );
  end loop;

  insert into public.sale_tenders (tenant_id, sale_id, method, amount)
  values (p_tenant, p_sale_id, p_tender, p_total);

  return jsonb_build_object('receipt_number', v_receipt, 'replayed', false);
end;
$fn$;

revoke execute on function public.record_sale(uuid, uuid, uuid, date, uuid, numeric, numeric, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.record_sale(uuid, uuid, uuid, date, uuid, numeric, numeric, text, jsonb, uuid)
  to service_role;

comment on function public.record_sale(uuid, uuid, uuid, date, uuid, numeric, numeric, text, jsonb, uuid) is
  'Records one register sale and claims its counter receipt number atomically, stamping each line with what the item cost at that moment. Replays safely on a repeated sale id.';

-- -----------------------------------------------------------------------------
-- 3 · Everything the dashboard draws, in one read
--
-- `security invoker`, which is the whole point: it runs under the caller's own
-- JWT and every table it touches is behind an RLS policy scoped to the
-- `tenant_id` claim. `p_tenant` is therefore a filter and not a permission — a
-- caller who names another shop gets that shop's rows refused by the policy,
-- not returned by the function. It is also the reason this is granted to
-- `authenticated` rather than kept for the service role: running the dashboard
-- through RLS is what proves the policies still work.
--
-- The window is `sales.business_day`, never a timestamp, for the reason
-- `takings.ts` and `bills.ts` use it: the register stamped it once from the
-- shop's own `day_ends_at`, so a dhaba that shuts at 1 am gets its last hour on
-- the day it opened and no report re-derives that. It runs straight down
-- `sales_tenant_day_idx`.
--
-- Both windows are read in one pass. The comparison period is the same shape
-- as the current one and asking for it separately would be a second round trip
-- to add up rows the first scan already had in hand.
--
-- What comes back is jsonb rather than a rowset because it is seven differently
-- shaped answers, and seven `returns table` functions would be seven round
-- trips. Profit and margin are not in it: they are `sales - cost`, and a figure
-- computed in two places is a figure that will disagree with itself.
-- -----------------------------------------------------------------------------
create or replace function public.dashboard_summary(
  p_tenant uuid,
  p_from date,
  p_to date,
  p_prev_from date,
  p_prev_to date,
  -- The shop's own timezone, not the server's and not the tablet's. Only the
  -- hourly buckets need it; a business day is already a date.
  p_timezone text
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $fn$
  with scoped as (
    select s.id,
           s.business_day,
           s.created_at,
           s.total,
           case when s.business_day between p_from and p_to then 'now' else 'prev' end as span
      from public.sales s
     where s.tenant_id = p_tenant
       and s.status = 'completed'
       and (s.business_day between p_from and p_to
         or s.business_day between p_prev_from and p_prev_to)
  ),
  -- One pass over the lines of both windows, folded to one row per bill. Every
  -- total below hangs off this, so the cost of goods and the item counts are
  -- added up once rather than once per widget.
  per_bill as (
    select l.sale_id,
           sum(l.cost_snapshot * l.quantity) as cost,
           count(*) as lines
      from public.sale_lines l
      join scoped s on s.id = l.sale_id
     where l.tenant_id = p_tenant
     group by l.sale_id
  ),
  totals as (
    select s.span,
           sum(s.total) as sales,
           coalesce(sum(b.cost), 0) as cost,
           count(*) as bills
      from scoped s
      left join per_bill b on b.sale_id = s.id
     group by s.span
  ),
  by_day as (
    select s.business_day as at,
           sum(s.total) as sales,
           coalesce(sum(b.cost), 0) as cost
      from scoped s
      left join per_bill b on b.sale_id = s.id
     where s.span = 'now'
     group by s.business_day
  ),
  -- Only for a one-day window, where a daily axis would be a single point.
  -- Asking for it on a month would group thirty thousand rows nobody looks at.
  by_hour as (
    select extract(hour from (s.created_at at time zone p_timezone))::int as at,
           sum(s.total) as sales,
           coalesce(sum(b.cost), 0) as cost
      from scoped s
      left join per_bill b on b.sale_id = s.id
     where s.span = 'now'
       and p_from = p_to
     group by 1
  ),
  -- The department is read off `items`, which means an item since deleted has
  -- no department to read — `sale_lines` keeps the name it was sold under and
  -- not where it was filed. That money is still the shop's, so it is grouped
  -- rather than dropped, and the screen says what it is.
  by_department as (
    -- Blank rather than a word: the screen decides what an unfiled rupee is
    -- called, the same way it decides what a deleted counter is called.
    select coalesce(btrim(i.department), '') as name,
           sum(l.line_total) as sales
      from public.sale_lines l
      join scoped s on s.id = l.sale_id and s.span = 'now'
      left join public.items i on i.id = l.item_id and i.tenant_id = p_tenant
     where l.tenant_id = p_tenant
     group by 1
  ),
  -- Grouped by the catalog row where there is one, and by the printed name
  -- where the item has since been deleted — two deleted items that shared a
  -- name were the same thing on the shelf. The name and unit are the most
  -- recent ones, because an item renamed mid-window should rank under what it
  -- is called now.
  by_product as (
    select coalesce(l.item_id::text, 'name:' || l.name_snapshot) as key,
           (array_agg(l.name_snapshot order by l.created_at desc))[1] as name,
           (array_agg(l.unit order by l.created_at desc))[1] as unit,
           sum(l.quantity) as quantity,
           sum(l.line_total) as sales
      from public.sale_lines l
      join scoped s on s.id = l.sale_id and s.span = 'now'
     where l.tenant_id = p_tenant
     group by 1
     order by 5 desc
     limit 6
  ),
  -- Read straight off `sales` rather than out of `scoped`, so a held or
  -- returned bill appears here the day either becomes possible. The totals
  -- above deliberately cannot see them: takings are what the shop sold.
  recent as (
    select s.id,
           s.receipt_number,
           s.created_at,
           s.total,
           s.status,
           (select count(*) from public.sale_lines l
             where l.sale_id = s.id and l.tenant_id = p_tenant) as items,
           -- A split bill has no single method. The largest half is the honest
           -- one-word answer, and `split` beside it says there was another.
           (select t.method from public.sale_tenders t
             where t.sale_id = s.id and t.tenant_id = p_tenant
             order by t.amount desc, t.method limit 1) as method,
           (select count(*) > 1 from public.sale_tenders t
             where t.sale_id = s.id and t.tenant_id = p_tenant) as split
      from public.sales s
     where s.tenant_id = p_tenant
       and s.business_day between p_from and p_to
     order by s.created_at desc
     limit 8
  )
  select jsonb_build_object(
    'totals', coalesce((
      select jsonb_build_object('sales', t.sales, 'cost', t.cost, 'bills', t.bills)
        from totals t where t.span = 'now'), '{}'::jsonb),
    'previous', coalesce((
      select jsonb_build_object('sales', t.sales, 'cost', t.cost, 'bills', t.bills)
        from totals t where t.span = 'prev'), '{}'::jsonb),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('at', d.at, 'sales', d.sales, 'cost', d.cost)
             order by d.at)
        from by_day d), '[]'::jsonb),
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object('at', h.at, 'sales', h.sales, 'cost', h.cost)
             order by h.at)
        from by_hour h), '[]'::jsonb),
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object('name', d.name, 'sales', d.sales)
             order by d.sales desc)
        from by_department d), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', p.name, 'unit', p.unit,
               'quantity', p.quantity, 'sales', p.sales)
             order by p.sales desc)
        from by_product p), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'receipt', r.receipt_number, 'at', r.created_at,
               'items', r.items, 'method', r.method, 'split', r.split,
               'total', r.total, 'status', r.status)
             order by r.created_at desc)
        from recent r), '[]'::jsonb)
  );
$fn$;

revoke execute on function public.dashboard_summary(uuid, date, date, date, date, text)
  from public, anon;
grant execute on function public.dashboard_summary(uuid, date, date, date, date, text)
  to authenticated, service_role;

comment on function public.dashboard_summary(uuid, date, date, date, date, text) is
  'Every figure on /app for one window of trading days and the window before it. Runs as the caller, so RLS is the tenant gate and p_tenant is only a filter.';
