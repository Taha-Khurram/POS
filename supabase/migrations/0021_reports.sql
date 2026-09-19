-- =============================================================================
-- 0021_reports — the numbers you take to your accountant
--
-- Apply manually after 0020_plans_tell_the_truth.sql.
--
-- `/app/reports` has been a placeholder promising three things. Two of them are
-- now buildable and this migration supplies the read behind them: daily and
-- monthly sales, and profit by item and by department. The third — a sales-tax
-- summary — is deliberately **not** here, and is not coming until a line
-- carries the rate it was taxed at. `sale_lines` stores the price and not the
-- rate behind it, so every tax figure a report could print today would be
-- reverse-engineered from `items.tax_rate` as it stands now, which is the same
-- mistake costing a sale from today's `cost_price` would be. The reprint on
-- `/app/sales` already refuses to guess it; so does this.
--
-- Nothing here changes who may write, and nothing here writes. One function,
-- one grant, no new columns.
--
-- Why a second aggregate rather than more fields on `dashboard_summary`: the
-- two screens ask different questions of the same rows. The dashboard asks
-- "how is today going" and is drawn on every page load, so it reads eight
-- bills and six products and stops. Reports asks "where did the year go" and
-- is opened on purpose, so it reads every trading day in the window, every
-- item sold in it, both levels of the tree, every tender, every counter and
-- every cashier. Folding that into the home screen would make the home screen
-- pay for it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Everything /app/reports draws, in one read
--
-- `security invoker`, like `dashboard_summary` and for the same reason: it runs
-- under the caller's own JWT and every table it touches is behind an RLS policy
-- scoped to the `tenant_id` claim, so `p_tenant` is a filter and not a
-- permission. A caller who names another shop gets that shop's rows refused by
-- the policy rather than returned by the function, and `rls.test.sql` proves it
-- rather than this comment asserting it.
--
-- The window is `sales.business_day`, never a timestamp — the register stamped
-- it once from the shop's own `day_ends_at`, so a dhaba that shuts at 1 am gets
-- its last hour on the day it opened and no report re-derives that window. It
-- runs straight down `sales_tenant_day_idx`.
--
-- Both windows are read in one pass, like the dashboard's: the comparison
-- period is the same shape as the current one, and asking for it separately
-- would be a second scan of rows the first already had in hand.
--
-- Profit and margin are not in what comes back. They are `sales - cost`, and a
-- figure computed in two places is a figure that will eventually disagree with
-- itself — `lib/pos/report.ts` derives both, once, for the screen and for the
-- CSV.
-- -----------------------------------------------------------------------------
create or replace function public.reports_summary(
  p_tenant uuid,
  p_from date,
  p_to date,
  p_prev_from date,
  p_prev_to date,
  -- The shop's own timezone, not the server's and not the tablet's. Only the
  -- hour-of-day buckets need it; a business day is already a date.
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
       and s.status = 'completed'
       and (s.business_day between p_from and p_to
         or s.business_day between p_prev_from and p_prev_to)
  ),
  -- One pass over the lines of both windows, folded to one row per bill. Every
  -- total below hangs off this, so the cost of goods and the line counts are
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
           coalesce(sum(b.lines), 0) as lines,
           sum(s.discount_total) as discount,
           count(*) as bills
      from scoped s
      left join per_bill b on b.sale_id = s.id
     group by s.span
  ),
  -- Every trading day that took money. The screen fills the gaps, because a
  -- day the shop was shut is a row worth seeing as a zero and not a row worth
  -- storing.
  by_day as (
    select s.business_day as at,
           sum(s.total) as sales,
           coalesce(sum(b.cost), 0) as cost,
           coalesce(sum(b.lines), 0) as lines,
           count(*) as bills
      from scoped s
      left join per_bill b on b.sale_id = s.id
     where s.span = 'now'
     group by s.business_day
  ),
  -- Hour of day across the whole window, not just one day of it. This is the
  -- staffing question — "when is the shop actually busy" — and a single day
  -- answers it with whatever happened on that day.
  by_hour as (
    select extract(hour from (s.created_at at time zone p_timezone))::int as at,
           sum(s.total) as sales,
           count(*) as bills
      from scoped s
     where s.span = 'now'
     group by 1
  ),
  -- Grouped by the catalog row where there is one, and by the printed name
  -- where the item has since been deleted — two deleted items that shared a
  -- name were the same thing on the shelf. The name, unit and department are
  -- the most recent ones, because an item renamed mid-window should rank under
  -- what it is called now.
  by_product as (
    select coalesce(l.item_id::text, 'name:' || l.name_snapshot) as key,
           (array_agg(l.name_snapshot order by l.created_at desc))[1] as name,
           (array_agg(l.unit order by l.created_at desc))[1] as unit,
           (array_agg(coalesce(btrim(i.department), '') order by l.created_at desc))[1] as department,
           sum(l.quantity) as quantity,
           sum(l.line_total) as sales,
           sum(l.cost_snapshot * l.quantity) as cost,
           count(distinct l.sale_id) as bills
      from public.sale_lines l
      join scoped s on s.id = l.sale_id and s.span = 'now'
      left join public.items i on i.id = l.item_id and i.tenant_id = p_tenant
     where l.tenant_id = p_tenant
     group by 1
  ),
  -- Both levels of the shop's own tree, read off `items` — which means an item
  -- since deleted has no department to read, because `sale_lines` keeps the
  -- name it was sold under and not where it was filed. That money is still the
  -- shop's, so it is grouped under a blank name rather than dropped, and the
  -- screen decides what a blank one is called.
  by_department as (
    select coalesce(btrim(i.department), '') as name,
           sum(l.line_total) as sales,
           sum(l.cost_snapshot * l.quantity) as cost,
           count(*) as lines
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
           count(*) as lines
      from public.sale_lines l
      join scoped s on s.id = l.sale_id and s.span = 'now'
      left join public.items i on i.id = l.item_id and i.tenant_id = p_tenant
     where l.tenant_id = p_tenant
     group by 1, 2
  ),
  -- What was actually settled, by method. Off `sale_tenders` rather than off
  -- `sales.total`, because a split bill is two rows there and one here — the
  -- day the payment sheet can settle one, this is the figure that keeps adding
  -- up.
  by_tender as (
    select t.method,
           sum(t.amount) as amount,
           count(distinct t.sale_id) as bills
      from public.sale_tenders t
      join scoped s on s.id = t.sale_id and s.span = 'now'
     where t.tenant_id = p_tenant
     group by t.method
  ),
  -- Ids, not names. A counter or a cashier since deleted keeps its takings and
  -- loses its label, and the screen is where a missing label becomes words —
  -- the same call `bills.ts` makes for the history.
  by_counter as (
    select s.counter_id as id,
           sum(s.total) as sales,
           coalesce(sum(b.cost), 0) as cost,
           count(*) as bills
      from scoped s
      left join per_bill b on b.sale_id = s.id
     where s.span = 'now'
     group by s.counter_id
  ),
  by_cashier as (
    select s.created_by as id,
           sum(s.total) as sales,
           coalesce(sum(b.cost), 0) as cost,
           count(*) as bills
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
    -- The whole tail is counted even though only the head is sent, so the
    -- screen can say "the top 500 of 1,342 items sold" rather than quietly
    -- showing a truncated list as if it were the list.
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
  'Every figure on /app/reports for one window of trading days and the window before it: the day-by-day takings, profit by item and by department, the tender mix, and what each counter and cashier took. Runs as the caller, so RLS is the tenant gate and p_tenant is only a filter.';

-- -----------------------------------------------------------------------------
-- The plan flag that was waiting on this
--
-- `0020` flipped `advanced_reports` to false on Premium for one stated reason:
-- "/app/reports is a placeholder screen". It is not one any more, so the flag
-- goes back to what `0002_seed_plans.sql` seeded — the rule `0020` wrote down
-- was to flip each one back in the same migration that lands the feature, and
-- this is that migration.
--
-- Only Premium is touched. Standard was seeded false in `0002` and stays false
-- here, which is worth being honest about rather than quiet: **nothing gates
-- this module by plan.** Reports is reached through `can_view_reports` on
-- `role_permissions`, the same switch an owner sets per access level, and a
-- Standard shop that switches it on gets the whole screen. So Standard's flag
-- now understates what a Standard shop actually gets. That is the safe
-- direction for a promise to be wrong in, and it is a pricing decision rather
-- than a truthfulness one — either gate the module or raise the flag, but do it
-- deliberately and not as a side effect of shipping the screen.
-- -----------------------------------------------------------------------------
update public.plans
   set features = features || jsonb_build_object('advanced_reports', true)
 where code = 'premium';
