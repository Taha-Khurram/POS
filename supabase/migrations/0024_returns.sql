-- =============================================================================
-- 0024_returns — the books learn about the shopping that came back
--
-- Apply manually after 0023_discounts.sql.
--
-- `role_permissions.can_refund` has been stored and editable since 0009 and
-- implemented by nothing. Every shop takes returns; today the answer is "open
-- the drawer and hand the money back", and the books never learn. The takings
-- are over by the refund, the shelf is under by whatever came back, and the
-- item's margin for the month is a fiction.
--
-- Three decisions carry this migration.
--
-- **A refund is a sale with a minus in front of it.** Not a second table, not a
-- flag on the original. `public.sales` gains a row with `status = 'refund'`, a
-- negative subtotal and total, negative line quantities and a negative tender,
-- pointing at the bill it reverses. Every reader in the console already sums
-- those columns — the day's takings, the dashboard, all five report tabs, the
-- history's own totals — so a refund nets out of every one of them by
-- arithmetic rather than by each of them remembering to subtract it. The
-- alternative, a `sale_returns` table with positive amounts, needs every sum in
-- the product to grow a second half, and the one that gets forgotten is the one
-- that quietly overstates what the shop earned.
--
-- **The original bill is never edited.** It keeps its status, its total and its
-- lines exactly as they were rung up. A bill is what happened; a refund is a
-- second thing that happened. Rewriting the first to account for the second is
-- how a receipt in a customer's hand stops matching the shop's own record — and
-- it is also how a total gets subtracted twice, once by editing the original
-- and once by the refund row beside it.
--
-- **The stock comes back only if the shopkeeper says it does.** A sealed packet
-- goes on the shelf; a burst bag of atta does not. Restocking every return
-- would build a count that is wrong in exactly the cases somebody would notice.
-- So it is a question on the return screen, asked once, and its answer is a
-- movement in the ledger 0022 built or no movement at all.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · What a refund row is
--
-- `returned` was in the status list from 0008 and was never written by
-- anything. It is replaced rather than kept beside `refund`, because two words
-- for one state is how the next person writing a query picks the wrong one. The
-- word is `refund` and it means "this row is the money going back", not "this
-- bill was returned" — which is the distinction that keeps the original
-- untouched.
-- -----------------------------------------------------------------------------
alter table public.sales drop constraint if exists sales_status_check;
alter table public.sales add constraint sales_status_check
  check (status in ('completed', 'held', 'refund'));

alter table public.sales
  -- The bill being reversed. `on delete set null` like every other pointer at
  -- a sale, though nothing deletes one: a refund that outlived its original
  -- would still be money that left the drawer.
  add column if not exists refunds_sale_id uuid
    references public.sales (id) on delete set null,
  -- Why it came back, in the shopkeeper's words. "Wrong size", "leaking",
  -- "customer changed their mind" — the sentence that makes a pattern findable
  -- three months later when one supplier's stock keeps coming back.
  add column if not exists note text
    check (note is null or length(btrim(note)) <= 200);

create index if not exists sales_refunds_idx
  on public.sales (refunds_sale_id)
  where refunds_sale_id is not null;

comment on column public.sales.refunds_sale_id is
  'The bill this row reverses. Set only on a status = refund row; the original is never edited, because a bill is what happened.';

-- -----------------------------------------------------------------------------
-- 2 · The money may point downwards
--
-- The `>= 0` checks came in with 0008 when every row was a sale. They are
-- replaced rather than dropped, because "this number may now be negative" is
-- not the same statement as "this number may be anything": a completed sale
-- with a negative total is still a bug, and a refund with a positive one is a
-- refund that adds to the takings.
--
-- So the sign is tied to the status, which is the strongest thing the column
-- can be told. It is also what makes the netting safe: a reader summing
-- `total` across both statuses cannot be handed a refund that points the wrong
-- way.
-- -----------------------------------------------------------------------------
alter table public.sales drop constraint if exists sales_subtotal_check;
alter table public.sales add constraint sales_subtotal_check
  check (case when status = 'refund' then subtotal <= 0 else subtotal >= 0 end);

alter table public.sales drop constraint if exists sales_total_check;
alter table public.sales add constraint sales_total_check
  check (case when status = 'refund' then total <= 0 else total >= 0 end);

alter table public.sales drop constraint if exists sales_discount_total_check;
alter table public.sales add constraint sales_discount_total_check
  check (case when status = 'refund' then discount_total <= 0 else discount_total >= 0 end);

-- `sale_lines` has no status of its own and does not need one: the sign of the
-- quantity is the statement, and everything else on the line has to agree with
-- it. A line of −2 that came to +Rs 300 would net the wrong way in every sum
-- in the product.
--
-- `unit_price` stays positive through all of it. It is a rate, not an amount —
-- what one of them costs on the shelf — and a refund does not make the shelf
-- price negative. The receipt prints it that way too, so a customer can read
-- "2 × Rs 150" on the refund exactly as they read it on the sale.
alter table public.sale_lines drop constraint if exists sale_lines_quantity_check;
alter table public.sale_lines add constraint sale_lines_quantity_check
  check (quantity <> 0);

alter table public.sale_lines drop constraint if exists sale_lines_line_total_check;
alter table public.sale_lines add constraint sale_lines_line_total_check
  check (
    case when quantity > 0 then line_total >= 0 and discount >= 0
         else line_total <= 0 and discount <= 0 end
  );

alter table public.sale_lines drop constraint if exists sale_lines_discount_check;

alter table public.sale_lines
  -- Which line of the original bill this reverses. Exact, rather than matching
  -- on `item_id`: an item deleted since the sale has a null there, and two
  -- lines of the same item on one bill — the shopkeeper who rang up 2 and then
  -- 1 more — would be indistinguishable. It is what "how much of this line is
  -- still returnable" is counted from.
  add column if not exists refunds_line_id uuid
    references public.sale_lines (id) on delete set null;

create index if not exists sale_lines_refunds_idx
  on public.sale_lines (refunds_line_id)
  where refunds_line_id is not null;

comment on column public.sale_lines.refunds_line_id is
  'The line of the original bill this one reverses. How much of a line is still returnable is counted from this and nothing else.';

-- The tender follows the money. A refund in cash is cash leaving the drawer,
-- which is exactly what the day-end count has to see.
alter table public.sale_tenders drop constraint if exists sale_tenders_amount_check;

comment on column public.sale_tenders.amount is
  'What crossed the counter. Negative on a refund, because the day-end drawer count has to see the notes leaving.';

-- -----------------------------------------------------------------------------
-- 3 · Recording one
--
-- One security-definer function, one transaction, for the reason `record_sale`
-- is one: the refund row, its lines, its tender and the stock going back are
-- either all true or none of them are. It claims a number out of the counter's
-- own series in the same statement, so a refund handed to a customer always has
-- a receipt the shop can find.
--
-- Same series, not a separate one. The counter's receipt book is one book — a
-- second numbering beside it is a second thing to reconcile at day end, and the
-- roll says REFUND across the top where anybody would look for it.
--
-- `p_return_id` is minted in the browser, like `p_sale_id`, so a retry after a
-- dropped connection replays instead of refunding the customer twice. That
-- matters more here than on a sale: a second sale is at least a second lot of
-- shopping, and a second refund is money out of the drawer for nothing.
-- -----------------------------------------------------------------------------
create or replace function public.record_return(
  p_tenant uuid,
  p_counter uuid,
  -- The refund's own id, minted on the tablet.
  p_return_id uuid,
  p_business_day date,
  p_created_by uuid,
  -- The bill being reversed.
  p_sale_id uuid,
  -- [{ line_id, quantity }] — what is coming back, by the original's own lines.
  p_lines jsonb,
  -- How the money goes back. Cash out of the drawer, or a reversal on the
  -- shop's own card machine that Flo never sees.
  p_tender text,
  -- Whether what came back goes on the shelf again.
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
begin
  -- Already refunded. The retry gets the same receipt back rather than handing
  -- the customer their money a second time.
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

  -- The original, locked for the rest of the transaction. The lock is what
  -- stops two tablets refunding the last unsold unit of the same line at the
  -- same moment: the second waits, re-counts what is left, and refuses.
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

  v_receipt := v_prefix || '-' || to_char(p_business_day, 'YYMMDD') || '-' || lpad(v_serial::text, 4, '0');

  -- The header goes in first with zeroes, because the lines have to reference
  -- it and the totals are not known until they have all been priced. It is
  -- updated at the foot of this function, inside the same transaction, so no
  -- reader ever sees the zeroes.
  insert into public.sales (
    id, tenant_id, branch_id, counter_id, customer_id, receipt_number,
    business_day, status, subtotal, discount_total, total, created_by,
    refunds_sale_id, note
  )
  values (
    p_return_id, p_tenant, v_branch, p_counter,
    -- The same customer the original was rung up against. A refund that loses
    -- them leaves that person's record showing a purchase they gave back.
    v_sale.customer_id, v_receipt,
    p_business_day, 'refund', 0, 0, 0, p_created_by,
    p_sale_id, nullif(btrim(coalesce(p_note, '')), '')
  );

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    -- Located by the original's own line id and re-checked against both the
    -- bill and the tenant, so a crafted request cannot refund a line off
    -- somebody else's receipt.
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

    -- What has already gone back against this line, counted off the refund
    -- lines themselves rather than off a running column on the original. A
    -- counter nobody maintains is a counter that drifts; a sum over rows that
    -- are the evidence cannot.
    select coalesce(-sum(l.quantity), 0) into v_done
      from public.sale_lines l
     where l.refunds_line_id = v_original.id
       and l.tenant_id = p_tenant;

    if v_want > v_original.quantity - v_done then
      raise exception 'only % of % are still returnable on that line',
        v_original.quantity - v_done, v_original.quantity
        using errcode = 'restrict_violation';
    end if;

    -- What the customer actually paid for one of them, which after a discount
    -- is not the shelf price. Refunding `unit_price` on a haggled bill hands
    -- back more than was taken, and on a busy Saturday that is a leak nobody
    -- would find.
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
      -- Positive: it is the shelf rate, not an amount, and the roll prints
      -- "2 × Rs 150" on a refund exactly as it did on the sale.
      v_original.unit_price,
      -v_discount,
      -v_amount,
      -- The cost as it stood when the item was SOLD, copied off the original
      -- line rather than re-read from `items`. Reversing a sale at today's
      -- cost is the same mistake `cost_snapshot` exists to prevent, one
      -- direction along: it would leave a margin behind on an item that was
      -- bought and given back.
      v_original.cost_snapshot,
      v_original.id
    );

    v_gross := v_gross + round(v_original.unit_price * v_want, 2);
    v_off := v_off + v_discount;
    v_net := v_net + v_amount;

    -- Back on the shelf, if the shopkeeper said so. A sealed packet goes back;
    -- a burst bag of atta does not, and restocking it would build a count that
    -- is wrong in exactly the cases somebody would notice.
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

  -- Out of the drawer, which is exactly what the day-end count has to see.
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
  'Reverses part or all of one bill: a negative sale against the counter''s own series, the money back out of the drawer, and the stock back on the shelf if the shopkeeper said so. Replays safely on a repeated return id.';

-- -----------------------------------------------------------------------------
-- 4 · The reports net the money
--
-- Both aggregates filtered on `status = 'completed'` — written when a refund
-- was not a thing that could exist, with a comment on the dashboard's `recent`
-- saying so out loud. They now take both statuses, which is the whole benefit
-- of a refund being a negative sale: the sums net, the profit nets, the best
-- sellers net, and none of it needed a second branch.
--
-- The bill counts do not net, and must not. A refund is not minus one bill —
-- the shop served two customers that day, one of whom brought something back —
-- so "bills" counts the sales and the refunds are visible in the takings that
-- fell. `count(*) filter (where total >= 0)` is the whole change.
-- -----------------------------------------------------------------------------
create or replace function public.dashboard_summary(
  p_tenant uuid,
  p_from date,
  p_to date,
  p_prev_from date,
  p_prev_to date,
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
       and s.status in ('completed', 'refund')
       and (s.business_day between p_from and p_to
         or s.business_day between p_prev_from and p_prev_to)
  ),
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
           count(*) filter (where s.total >= 0) as bills
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
  by_department as (
    select coalesce(btrim(i.department), '') as name,
           sum(l.line_total) as sales
      from public.sale_lines l
      join scoped s on s.id = l.sale_id and s.span = 'now'
      left join public.items i on i.id = l.item_id and i.tenant_id = p_tenant
     where l.tenant_id = p_tenant
     group by 1
  ),
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
  -- Read straight off `sales` rather than out of `scoped`, so a held bill
  -- appears here the day one can exist. A refund appears here too and is meant
  -- to: the last eight things that happened at the counter includes the
  -- shopping that came back, and `status` rides along so the screen can say so.
  recent as (
    select s.id,
           s.receipt_number,
           s.created_at,
           s.total,
           s.status,
           (select count(*) from public.sale_lines l
             where l.sale_id = s.id and l.tenant_id = p_tenant) as items,
           (select t.method from public.sale_tenders t
             where t.sale_id = s.id and t.tenant_id = p_tenant
             order by abs(t.amount) desc, t.method limit 1) as method,
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
  'Every figure on /app for one window of trading days and the window before it, net of refunds. Runs as the caller, so RLS is the tenant gate and p_tenant is only a filter.';

-- -----------------------------------------------------------------------------
-- 5 · The five report tabs net the money too
--
-- The same one-word change to `scoped`, and the same care with every count
-- beside it. Money nets; counts do not. "Bills" is how many customers were
-- served and a refund did not un-serve one, so every count is filtered to the
-- positive rows — and because a refund's lines would otherwise inflate the line
-- counts the same way, so are those.
--
-- Everything that sums — sales, cost, discount, quantity, the tender mix — is
-- left alone, which is the whole point of a refund being a negative sale.
-- `marginOf` in `lib/pos/report.ts` therefore starts telling the truth about a
-- returned item without a line changing on that side.
-- -----------------------------------------------------------------------------
create or replace function public.reports_summary(
  p_tenant uuid,
  p_from date,
  p_to date,
  p_prev_from date,
  p_prev_to date,
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
           s.counter_id,
           s.created_by,
           s.discount_total,
           s.total,
           case when s.business_day between p_from and p_to then 'now' else 'prev' end as span
      from public.sales s
     where s.tenant_id = p_tenant
       and s.status in ('completed', 'refund')
       and (s.business_day between p_from and p_to
         or s.business_day between p_prev_from and p_prev_to)
  ),
  per_bill as (
    select l.sale_id,
           sum(l.cost_snapshot * l.quantity) as cost,
           count(*) filter (where l.quantity > 0) as lines
      from public.sale_lines l
      join scoped s on s.id = l.sale_id
     where l.tenant_id = p_tenant
     group by l.sale_id
  ),
  totals as (
    select s.span,
           sum(s.total) as sales,
           coalesce(sum(b.cost), 0) as cost,
           coalesce(sum(b.lines), 0) as lines,
           sum(s.discount_total) as discount,
           count(*) filter (where s.total >= 0) as bills
      from scoped s
      left join per_bill b on b.sale_id = s.id
     group by s.span
  ),
  by_day as (
    select s.business_day as at,
           sum(s.total) as sales,
           coalesce(sum(b.cost), 0) as cost,
           coalesce(sum(b.lines), 0) as lines,
           count(*) filter (where s.total >= 0) as bills
      from scoped s
      left join per_bill b on b.sale_id = s.id
     where s.span = 'now'
     group by s.business_day
  ),
  by_hour as (
    select extract(hour from (s.created_at at time zone p_timezone))::int as at,
           sum(s.total) as sales,
           count(*) filter (where s.total >= 0) as bills
      from scoped s
     where s.span = 'now'
     group by 1
  ),
  by_product as (
    select coalesce(l.item_id::text, 'name:' || l.name_snapshot) as key,
           (array_agg(l.name_snapshot order by l.created_at desc))[1] as name,
           (array_agg(l.unit order by l.created_at desc))[1] as unit,
           (array_agg(coalesce(btrim(i.department), '') order by l.created_at desc))[1] as department,
           sum(l.quantity) as quantity,
           sum(l.line_total) as sales,
           sum(l.cost_snapshot * l.quantity) as cost,
           count(distinct l.sale_id) filter (where l.quantity > 0) as bills
      from public.sale_lines l
      join scoped s on s.id = l.sale_id and s.span = 'now'
      left join public.items i on i.id = l.item_id and i.tenant_id = p_tenant
     where l.tenant_id = p_tenant
     group by 1
  ),
  by_department as (
    select coalesce(btrim(i.department), '') as name,
           sum(l.line_total) as sales,
           sum(l.cost_snapshot * l.quantity) as cost,
           count(*) filter (where l.quantity > 0) as lines
      from public.sale_lines l
      join scoped s on s.id = l.sale_id and s.span = 'now'
      left join public.items i on i.id = l.item_id and i.tenant_id = p_tenant
     where l.tenant_id = p_tenant
     group by 1
  ),
  by_category as (
    select coalesce(btrim(i.department), '') as department,
           coalesce(btrim(i.category), '') as name,
           sum(l.line_total) as sales,
           sum(l.cost_snapshot * l.quantity) as cost,
           count(*) filter (where l.quantity > 0) as lines
      from public.sale_lines l
      join scoped s on s.id = l.sale_id and s.span = 'now'
      left join public.items i on i.id = l.item_id and i.tenant_id = p_tenant
     where l.tenant_id = p_tenant
     group by 1, 2
  ),
  -- The refund's tender is a negative row here, so "cash" is net of the notes
  -- that went back out of the drawer — which is exactly what the drawer will be
  -- counted against at 11 pm.
  by_tender as (
    select t.method,
           sum(t.amount) as amount,
           count(distinct t.sale_id) filter (where t.amount >= 0) as bills
      from public.sale_tenders t
      join scoped s on s.id = t.sale_id and s.span = 'now'
     where t.tenant_id = p_tenant
     group by t.method
  ),
  by_counter as (
    select s.counter_id as id,
           sum(s.total) as sales,
           coalesce(sum(b.cost), 0) as cost,
           count(*) filter (where s.total >= 0) as bills
      from scoped s
      left join per_bill b on b.sale_id = s.id
     where s.span = 'now'
     group by s.counter_id
  ),
  by_cashier as (
    select s.created_by as id,
           sum(s.total) as sales,
           coalesce(sum(b.cost), 0) as cost,
           count(*) filter (where s.total >= 0) as bills
      from scoped s
      left join per_bill b on b.sale_id = s.id
     where s.span = 'now'
     group by s.created_by
  )
  select jsonb_build_object(
    'totals', coalesce((
      select jsonb_build_object(
               'sales', t.sales, 'cost', t.cost, 'lines', t.lines,
               'discount', t.discount, 'bills', t.bills)
        from totals t where t.span = 'now'), '{}'::jsonb),
    'previous', coalesce((
      select jsonb_build_object(
               'sales', t.sales, 'cost', t.cost, 'lines', t.lines,
               'discount', t.discount, 'bills', t.bills)
        from totals t where t.span = 'prev'), '{}'::jsonb),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
               'at', d.at, 'sales', d.sales, 'cost', d.cost,
               'lines', d.lines, 'bills', d.bills)
             order by d.at)
        from by_day d), '[]'::jsonb),
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object('at', h.at, 'sales', h.sales, 'bills', h.bills)
             order by h.at)
        from by_hour h), '[]'::jsonb),
    'product_count', (select count(*) from by_product),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', p.key, 'name', p.name, 'unit', p.unit,
               'department', p.department, 'quantity', p.quantity,
               'sales', p.sales, 'cost', p.cost, 'bills', p.bills)
             order by p.sales desc)
        from (select * from by_product order by sales desc limit 500) p), '[]'::jsonb),
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', d.name, 'sales', d.sales, 'cost', d.cost, 'lines', d.lines)
             order by d.sales desc)
        from by_department d), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
               'department', c.department, 'name', c.name,
               'sales', c.sales, 'cost', c.cost, 'lines', c.lines)
             order by c.sales desc)
        from (select * from by_category order by sales desc limit 300) c), '[]'::jsonb),
    'tenders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'method', t.method, 'amount', t.amount, 'bills', t.bills)
             order by t.amount desc)
        from by_tender t), '[]'::jsonb),
    'counters', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'sales', c.sales, 'cost', c.cost, 'bills', c.bills)
             order by c.sales desc)
        from by_counter c), '[]'::jsonb),
    'cashiers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'sales', c.sales, 'cost', c.cost, 'bills', c.bills)
             order by c.sales desc)
        from by_cashier c), '[]'::jsonb)
  );
$fn$;

revoke execute on function public.reports_summary(uuid, date, date, date, date, text)
  from public, anon;
grant execute on function public.reports_summary(uuid, date, date, date, date, text)
  to authenticated, service_role;

comment on function public.reports_summary(uuid, date, date, date, date, text) is
  'Every figure on /app/reports for one window of trading days and the window before it, net of refunds: the day-by-day takings, profit by item and by department, the tender mix, and what each counter and cashier took. Runs as the caller, so RLS is the tenant gate and p_tenant is only a filter.';
