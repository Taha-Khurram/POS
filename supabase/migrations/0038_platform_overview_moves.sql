-- =============================================================================
-- 0038_platform_overview_moves — the strip gets a previous window and a shape
--
-- `platform_overview()` from `0036` returns eighteen real figures read through
-- the operator's own JWT. Every one of them is a snapshot: what the platform is
-- worth *now*, what sold *this month*. Nothing on `/admin` has ever said
-- whether any of it is going up.
--
-- That showed on the screen. All four cards on the Overview passed
-- `delta={null}` to `KpiCard`, so the console's headline row rendered "No
-- comparison" four times — the figures were real and the page still read like a
-- mock, because a number with nothing behind it is a number nobody can act on.
-- "Rs 21 lakh sold this month" is trivia. "Rs 21 lakh, up 14% on the same
-- twenty-two days of August" is a business.
--
-- Three things are added, and the first is the one with a trap in it.
--
-- **The comparison is the same number of elapsed days, not the whole previous
-- month.** On the 22nd, twenty-two days of September against thirty-one days of
-- August reports a third of the month as a collapse, every month, until the
-- 31st. `v_elapsed` is the whole of that fix and it is why the previous window
-- is built by arithmetic here rather than by `date_trunc` alone. The same
-- like-for-like rule `businessWindow` applies in `lib/pos/dashboard.ts`.
--
-- **Collections are not MRR and the console now shows both.** `mrr` is what the
-- shops are contracted to pay; `collected_month` is what actually landed in the
-- account, off `payments`. They differ by exactly the thing the renewal call
-- list exists to chase, and a console that only ever showed the contracted
-- figure was the one screen that could not tell a good month from a late one.
--
-- **The trend is gap-filled.** `generate_series` over the last thirty days, not
-- a `group by` over the rows that exist — a day with no sales has to draw as
-- zero. A line chart that silently skips Sunday joins Saturday to Monday and
-- draws a slope that never happened, which is the same failure the hand-rolled
-- `TrendChart` refuses a spline for.
--
-- No new table and no policy change: this is one `create or replace` on a
-- `security invoker` function that already carries its `is_platform_admin()`
-- guard, so rules 1-5 of `0001_init.sql` are untouched. RLS is still the gate —
-- every table read below carries `or private.is_platform_admin()` on its read
-- policy, which is what makes this function safe to run as the caller.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The one index this costs
--
-- Every window below scans `sales` across all tenants on `business_day`.
-- `sales_tenant_day_idx` leads on `tenant_id`, so it cannot serve a query with
-- no tenant in it — the platform-wide reads in `0036` have been sequential
-- scans since the day they were written, and the thirty-day trend widens that
-- from one month to two.
--
-- BRIN rather than B-tree, deliberately. `sales` is append-only and
-- `business_day` ascends with insert order, so the correlation BRIN needs is
-- near perfect and the index is a few kilobytes against a B-tree's hundreds.
-- The cost of an index on this table is paid by every shop on every sale, at
-- the counter, to serve one operator's morning screen — so it had better be the
-- cheap one.
-- -----------------------------------------------------------------------------
create index if not exists sales_business_day_brin_idx
  on public.sales using brin (business_day);

comment on index public.sales_business_day_brin_idx is
  'Platform-wide date-range scans for /admin. BRIN because sales is append-only and business_day is correlated with physical order.';

-- -----------------------------------------------------------------------------
-- The strip, with movement under it
-- -----------------------------------------------------------------------------
create or replace function public.platform_overview()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_month_start date := date_trunc('month', current_date)::date;
  -- Days gone in this month, 0 on the 1st. The whole of the like-for-like fix.
  v_elapsed integer := current_date - v_month_start;
  v_prev_start date := (v_month_start - interval '1 month')::date;
  v_prev_end date := (v_month_start - interval '1 month')::date + v_elapsed;
  -- Thirty days including today, so the chart's last point is this morning.
  v_trend_from date := current_date - 29;
begin
  if not private.is_platform_admin() then
    raise exception 'platform_overview is for the platform console'
      using errcode = 'insufficient_privilege';
  end if;

  return (
    with subs as (
      select s.*,
             private.monthly_value(s.agreed_price, s.billing_cycle) as monthly,
             (s.current_period_end::date - current_date) as days
        from public.subscriptions s
    ),
    pulse as (
      select t.id,
             (select max(x.created_at) from public.sales x where x.tenant_id = t.id)
               as last_sale_at
        from public.tenants t
    ),
    -- Both windows in one pass over the month-and-a-bit that matters, rather
    -- than two scans of the same table. Money nets (a refund carries a negative
    -- total and subtracts itself); counts do not — the shop served that
    -- customer twice and did not un-serve them.
    month as (
      select coalesce(sum(x.total) filter (where x.business_day >= v_month_start), 0)
               as sales_month,
             count(*) filter (where x.business_day >= v_month_start
                                and x.status <> 'refund') as bills_month,
             coalesce(sum(x.total) filter (where x.business_day between v_prev_start and v_prev_end), 0)
               as sales_prev,
             count(*) filter (where x.business_day between v_prev_start and v_prev_end
                                and x.status <> 'refund') as bills_prev
        from public.sales x
       where x.business_day >= v_prev_start
    ),
    -- What actually landed in the account, against the same two windows.
    collected as (
      select coalesce(sum(p.amount) filter (where p.paid_at::date >= v_month_start), 0)
               as collected_month,
             coalesce(sum(p.amount) filter (where p.paid_at::date between v_prev_start and v_prev_end), 0)
               as collected_prev
        from public.payments p
       where p.paid_at::date >= v_prev_start
    ),
    added as (
      select count(*) filter (where t.created_at::date >= v_month_start) as added_month,
             count(*) filter (where t.created_at::date between v_prev_start and v_prev_end)
               as added_prev
        from public.tenants t
       where t.created_at::date >= v_prev_start
    ),
    -- Gap-filled: the series is the spine and the sales join onto it, so a day
    -- nobody sold anything is a zero on the chart and not a missing point.
    trend as (
      select d.day,
             coalesce(sum(x.total), 0) as sales,
             count(x.id) filter (where x.status <> 'refund') as bills
        from generate_series(v_trend_from, current_date, interval '1 day') as d(day)
        left join public.sales x on x.business_day = d.day::date
       group by d.day
       order by d.day
    )
    select jsonb_build_object(
      'clients', (select count(*) from public.tenants),
      'active', (select count(*) from subs where status = 'active'),
      'trialing', (select count(*) from subs where status = 'trialing'),
      'past_due', (select count(*) from subs where status = 'past_due'),
      'suspended', (select count(*) from subs where status = 'suspended'),
      'cancelled', (select count(*) from subs where status = 'cancelled'),
      'mrr', (select coalesce(sum(monthly), 0) from subs
               where status in ('active', 'past_due')),
      'trial_mrr', (select coalesce(sum(monthly), 0) from subs
                     where status = 'trialing'),
      -- Everything still trading whose period runs out inside a week, and
      -- everything already past it. Both are call lists, not warnings.
      'expiring_7', (select count(*) from subs
                      where status in ('trialing', 'active', 'past_due')
                        and days between 0 and 7),
      'expired', (select count(*) from subs
                   where status in ('trialing', 'active', 'past_due')
                     and days < 0),
      'trials_ending_7', (select count(*) from subs
                           where status = 'trialing' and days between 0 and 7),
      'orders_waiting', (select count(*) from public.orders
                          where status = 'awaiting_payment'),
      'orders_to_verify', (select count(*) from public.orders
                            where status = 'proof_submitted'),
      'leads_new', (select count(*) from public.leads where status = 'new'),
      'sales_month', (select sales_month from month),
      'bills_month', (select bills_month from month),
      'sales_prev', (select sales_prev from month),
      'bills_prev', (select bills_prev from month),
      'collected_month', (select collected_month from collected),
      'collected_prev', (select collected_prev from collected),
      'added_month', (select added_month from added),
      'added_prev', (select added_prev from added),
      -- How far into the month the comparison runs. The screen captions it:
      -- an operator who cannot see which days are being compared has no reason
      -- to believe the percentage beside them.
      'elapsed_days', v_elapsed + 1,
      -- The churn early-warning: a paying shop that has not rung anything up
      -- in three days. Counted over shops that are meant to be trading, so a
      -- cancelled account is not reported as a shop that has gone quiet.
      'dormant', (
        select count(*)
          from subs s
          join pulse u on u.id = s.tenant_id
         where s.status in ('trialing', 'active', 'past_due')
           and (u.last_sale_at is null or u.last_sale_at < now() - interval '3 days')
      ),
      'never_sold', (
        select count(*) from pulse u where u.last_sale_at is null
      ),
      'trend', (
        select coalesce(
                 jsonb_agg(jsonb_build_object(
                   'day', t.day::date,
                   'sales', t.sales,
                   'bills', t.bills
                 ) order by t.day),
                 '[]'::jsonb)
          from trend t
      )
    )
  );
end;
$fn$;

comment on function public.platform_overview() is
  'The figures across the top of /admin, each against the same elapsed days of the previous month, plus a thirty-day trend. MRR counts active and past_due only — a trial is not revenue; collected is what actually landed.';
