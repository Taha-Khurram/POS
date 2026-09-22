-- =============================================================================
-- 0039_thirty_days_is_thirty_days — the roster's window is off by a day
--
-- `platform_clients()` windows a shop's recent trading on
-- `business_day >= current_date - 30`. That is thirty-one days, not thirty:
-- on the 22nd of September it starts on 23 August and runs to today inclusive.
--
-- Every screen that quotes it calls it thirty. The client record's figure is
-- headed "Sold in 30 days", the roster's cut is "Gone quiet — paying, no bill
-- in thirty days", and the Overview's own list says the same. A shop that last
-- sold something thirty-one days ago was therefore counted as still selling,
-- which is precisely backwards for a figure whose whole job is to notice that a
-- shop has stopped.
--
-- One day in thirty is small and the direction is not: `bills_30d = 0` is what
-- puts a shop on the "Gone quiet" list, and the churn call that list exists to
-- prompt is the one worth making a day earlier rather than a day later.
--
-- `current_date - 29` is thirty days counting today, the same arithmetic
-- `0038` uses for the Overview's thirty-day trend — which was written correctly
-- and is now the definition both share.
--
-- Read-only function, no policy and no table change, so rules 1-5 of
-- `0001_init.sql` are untouched. Everything else in the body is exactly as
-- `0036` wrote it.
-- =============================================================================
create or replace function public.platform_clients()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
begin
  if not private.is_platform_admin() then
    raise exception 'platform_clients is for the platform console'
      using errcode = 'insufficient_privilege';
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(c)::jsonb order by c.shop_name)
      from (
        select
          t.id                        as tenant_id,
          t.shop_name,
          t.owner_name,
          t.phone,
          t.email,
          t.city,
          t.created_at,
          s.id                        as subscription_id,
          s.plan_id,
          p.code                      as plan_code,
          p.name                      as plan_name,
          s.status,
          s.billing_cycle,
          s.agreed_price,
          s.max_branches,
          s.max_registers,
          s.feature_overrides,
          s.trial_ends_at,
          s.current_period_start,
          s.current_period_end,
          s.grace_days,
          s.suspended_at,
          s.cancelled_at,
          private.monthly_value(s.agreed_price, s.billing_cycle) as monthly_value,
          -- Negative once the period has passed, the same sign convention
          -- `getEntitlements` hands the bell.
          (s.current_period_end::date - current_date)            as days_until_expiry,
          sale.last_sale_at,
          coalesce(sale.sales_30d, 0)                            as sales_30d,
          coalesce(sale.bills_30d, 0)                            as bills_30d,
          coalesce(cat.item_count, 0)                            as item_count,
          coalesce(usr.user_count, 0)                            as user_count,
          coalesce(cnt.counter_count, 0)                         as counter_count,
          coalesce(pay.paid_total, 0)                            as paid_total,
          pay.last_paid_at,
          -- An invite minted and not yet redeemed is a shop that has been sold
          -- and has not signed in — the one state an operator has to chase.
          exists (
            select 1 from public.invites i
             where i.tenant_id = t.id
               and i.used_at is null
               and i.revoked_at is null
               and i.expires_at > now()
          ) as invite_open
        from public.tenants t
        left join public.subscriptions s on s.tenant_id = t.id
        left join public.plans p on p.id = s.plan_id
        left join lateral (
          -- Thirty days counting today: `- 29`, not `- 30`. See this migration's
          -- header — the extra day made a shop that stopped selling a month ago
          -- look like one that had not.
          select max(x.created_at)                                   as last_sale_at,
                 sum(x.total) filter (
                   where x.business_day >= current_date - 29)        as sales_30d,
                 count(*) filter (
                   where x.business_day >= current_date - 29
                     and x.status <> 'refund')                       as bills_30d
            from public.sales x
           where x.tenant_id = t.id
        ) sale on true
        left join lateral (
          select count(*) as item_count
            from public.items i where i.tenant_id = t.id
        ) cat on true
        left join lateral (
          select count(*) as user_count
            from public.profiles pr where pr.tenant_id = t.id
        ) usr on true
        left join lateral (
          select count(*) as counter_count
            from public.counters c where c.tenant_id = t.id and c.is_active
        ) cnt on true
        left join lateral (
          select sum(m.amount) as paid_total, max(m.paid_at) as last_paid_at
            from public.payments m where m.tenant_id = t.id
        ) pay on true
      ) c
  ), '[]'::jsonb);
end;
$fn$;

comment on function public.platform_clients() is
  'One row per shop for /admin/clients — plan, standing, monthly value and whether the shop is actually selling. Recent trading is thirty days counting today. Runs as the caller; the platform-admin guard is on top of RLS, not instead of it.';
