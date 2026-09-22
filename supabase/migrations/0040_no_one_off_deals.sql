-- =============================================================================
-- 0040_no_one_off_deals — a switch that switches nothing
--
-- `subscriptions.feature_overrides` has been in the schema since
-- `0001_init.sql` as "the one-off deal" — Premium price, throw in X, without
-- inventing a plan per customer. `getEntitlements` merged it over
-- `plans.features`, and `/admin/clients/[id]` drew a card that wrote it.
--
-- Nothing has ever read the result. `hasFeature` is called from nowhere in the
-- product, no screen in `/app` is gated on a flag, and `/pricing` writes its
-- plan lists out by hand rather than reading the table — so a per-shop override
-- could not reach the marketing site either. The card said so itself, in a
-- warning under its own buttons: "Nothing in the console gates a screen on
-- these yet." A control that ships with a note explaining that it does nothing
-- is worse than no control: an operator promises a shopkeeper a feature on a
-- call, presses the button, and the shop never gets it.
--
-- So it goes out rather than standing unread — the call `0034` made about the
-- restaurant tables, `0018` about the khata and `0016` about
-- `items.subcategory`. And, like `0034`, it costs nothing today: every row's
-- `feature_overrides` is `{}`. There is no data here to export first, and no
-- shopkeeper holding a promise that this column is the record of.
--
-- What stays is the entitlement that actually bites: `subscriptions.max_registers`,
-- which Settings enforces when a shop adds a counter, and which lives on the
-- subscription for exactly the reason this column was meant to — so a haggled
-- "teen counter kar do" is a one-row update and not a release. `plans.features`
-- also stays: it is copy for `/pricing`, it is edited on `/admin/plans`, and
-- `0020`'s rule still governs it — flip a flag in the migration that lands the
-- feature.
--
-- If per-shop flags are ever wanted again, they come back in the migration that
-- lands the first screen gated on one, with a reader attached.
--
-- No policy and no table is created here, so rules 1-5 of `0001_init.sql` are
-- untouched. `platform_clients()` is recreated only to stop selecting the
-- dropped column; every other line of its body is exactly as `0039` left it.
-- =============================================================================

alter table public.subscriptions
  drop column feature_overrides;

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
          -- Thirty days counting today: `- 29`, not `- 30`. See `0039` — the
          -- extra day made a shop that stopped selling a month ago look like
          -- one that had not.
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
