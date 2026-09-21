-- =============================================================================
-- 0036_platform_console — the owner console gets its reads and its two writes
--
-- `0001_init` built the whole platform side of the schema — tenants, plans,
-- subscriptions, orders, payments, invites, leads, audit_log — and every read
-- policy on it already carries `or private.is_platform_admin()`. Nothing has
-- ever called any of it: `/admin` was specified in `Plan.md` and never built,
-- so a shop was activated by hand in the SQL editor. This migration adds the
-- four functions that console needs and nothing else. No new table: the
-- platform side of Flo has had its tables since day one.
--
-- Two shapes, for two different reasons.
--
-- **The reads are grouped in Postgres**, the call `0019` and `0021` made for
-- the dashboard and for Reports. The roster wants one row per shop with its
-- plan, its standing, what it is worth a month and when it last sold anything
-- — which is four aggregates over four tables per tenant, and a round trip
-- each would be the n+1 that makes a hundred clients a five-second page. Both
-- are `security invoker` like `dashboard_summary`, so RLS is the gate and the
-- explicit `is_platform_admin()` guard on top is defence in depth: a tenant
-- user who found the RPC would otherwise get a one-row "platform" of their own
-- shop, which is not a leak but is a screen that lies about what it is.
--
-- **The writes are one transaction each**, for the reason `record_sale` is one
-- transaction. Activation touches four tables — tenant, branch, subscription,
-- invite — and a half-done activation is the worst row in the system: a shop
-- that signs in to a console with no subscription behind it, or a WhatsApp
-- invite link already pasted into a chat pointing at a tenant that has no plan.
-- Recording a payment is the same bargain one table over: the rupees taken and
-- the period they bought have to land together or the shop is either suspended
-- with money in the account or trading on a payment nobody recorded.
--
-- Both writes are granted to `service_role` alone. They are called from a
-- Server Action on the admin client, which is rule 3 from `0001_init.sql` —
-- every platform write has exactly one auditable path — and it is why neither
-- needs `security definer`: the service role already holds the privileges and
-- bypasses RLS, so a definer function would only be a way to lose that gate.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- What a month of a subscription is worth.
--
-- Its own function because three figures quote it — the MRR strip, the roster's
-- "worth a month" column and the client record — and a quarterly deal divided
-- by three in one place and by four in another is a console whose own two
-- screens disagree about revenue. The same call `balanceOf` makes for a
-- supplier: define it once, quote it everywhere.
-- -----------------------------------------------------------------------------
create or replace function private.monthly_value(
  p_price numeric,
  p_cycle text
)
returns numeric
language sql
immutable
set search_path = ''
as $fn$
  select round(
    p_price / case p_cycle
      when 'quarterly' then 3
      when 'yearly' then 12
      else 1
    end, 2);
$fn$;

create or replace function private.cycle_months(p_cycle text)
returns integer
language sql
immutable
set search_path = ''
as $fn$
  select case p_cycle when 'quarterly' then 3 when 'yearly' then 12 else 1 end;
$fn$;

-- `authenticated` has to hold both, because the two readers below are
-- `security invoker` — they run as the admin's own role, and a helper the
-- caller may not execute fails the whole function with a permission error
-- rather than an empty result. `service_role` likewise, for the two writes.
revoke execute on function
    private.monthly_value(numeric, text),
    private.cycle_months(text)
  from public;

grant execute on function
    private.monthly_value(numeric, text),
    private.cycle_months(text)
  to authenticated, service_role;

-- =============================================================================
-- The roster
--
-- One row per shop, with everything the table an operator lives in has to show
-- without opening anything: who they are, what they pay, where their period
-- stands, and whether the shop is actually using Flo. That last one is the
-- column that decides a renewal call, and it is why `last_sale_at` is read
-- live off `sales` rather than from `tenant_health` — that table has existed
-- since `0004` and nothing has ever written a row into it, so a console that
-- read it would report every shop dormant.
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
          select max(x.created_at)                                   as last_sale_at,
                 sum(x.total) filter (
                   where x.business_day >= current_date - 30)        as sales_30d,
                 count(*) filter (
                   where x.business_day >= current_date - 30
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

-- =============================================================================
-- The strip across the top of /admin
--
-- Deliberately one call rather than counting the roster in TypeScript: the
-- money figures window over every sale in the country this month, and a console
-- that added those up in a Node runtime would be reading the whole of `sales`
-- across every tenant to render a headline.
--
-- MRR counts `active` and `past_due` and nothing else. A trial is not revenue —
-- counting it is how a founder's dashboard tells them they are doing better
-- than they are — and a suspended shop is money that has stopped arriving,
-- which is exactly what the figure is supposed to notice.
-- =============================================================================
create or replace function public.platform_overview()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
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
    month as (
      select coalesce(sum(x.total), 0) as sales_month,
             count(*) filter (where x.status <> 'refund') as bills_month
        from public.sales x
       where x.business_day >= date_trunc('month', current_date)::date
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
      )
    )
  );
end;
$fn$;

revoke execute on function public.platform_clients(), public.platform_overview()
  from public, anon;
grant execute on function public.platform_clients(), public.platform_overview()
  to authenticated, service_role;

comment on function public.platform_clients() is
  'One row per shop for /admin/clients — plan, standing, monthly value and whether the shop is actually selling. Runs as the caller; the platform-admin guard is on top of RLS, not instead of it.';
comment on function public.platform_overview() is
  'The figures across the top of /admin. MRR counts active and past_due only — a trial is not revenue.';

-- =============================================================================
-- Activation — the one way a tenant comes into existence
--
-- Four inserts, one transaction, called by `activateClient()` in
-- `app/(admin)/admin/clients/actions.ts` and by the order queue's Verify
-- button, which is the same code path by design: there is exactly one function
-- that can bring a shop into being, so there is exactly one thing to audit.
--
-- The invite arrives already hashed. The plaintext token is minted in the
-- Server Action and goes straight into the WhatsApp message — it must never be
-- an argument here, because arguments end up in `pg_stat_statements` and in the
-- slow-query log, and an invite that is readable from a log is an invite that
-- is not single-use in any meaningful sense.
--
-- `p_trial_days` decides the whole shape of the first period. A trial *is* the
-- period, not a flag beside one: the subscription runs to the end of the trial
-- and is extended when the first payment lands, so the expiry list is the same
-- list whether a shop is trialing or paying, and nobody has to remember that
-- trials are tracked on a second column.
-- =============================================================================
create or replace function public.activate_tenant(
  p_shop_name text,
  p_owner_name text,
  p_phone text,
  p_email text,
  p_city text,
  p_shop_type text,
  p_ntn text,
  p_strn text,
  p_notes text,
  p_plan_id uuid,
  p_billing_cycle text,
  p_agreed_price numeric,
  p_max_branches integer,
  p_max_registers integer,
  p_trial_days integer,
  p_starts_at timestamptz,
  p_grace_days integer,
  -- sha256 of the invite token, hex. Never the token itself.
  p_token_hash text,
  p_invite_days integer,
  p_order_id uuid,
  p_actor uuid
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_tenant uuid;
  v_branch uuid;
  v_subscription uuid;
  v_invite uuid;
  v_status text;
  v_trial_ends timestamptz;
  v_period_end timestamptz;
begin
  if p_trial_days > 0 then
    v_status := 'trialing';
    v_trial_ends := p_starts_at + make_interval(days => p_trial_days);
    v_period_end := v_trial_ends;
  else
    v_status := 'active';
    v_trial_ends := null;
    v_period_end := p_starts_at
      + make_interval(months => private.cycle_months(p_billing_cycle));
  end if;

  insert into public.tenants
    (shop_name, owner_name, phone, email, city, shop_type, ntn, strn, notes, created_by)
  values
    (p_shop_name, p_owner_name, p_phone, nullif(btrim(p_email), ''), p_city,
     p_shop_type, nullif(btrim(p_ntn), ''), nullif(btrim(p_strn), ''),
     nullif(btrim(p_notes), ''), p_actor)
  returning id into v_tenant;

  -- One branch, primary, named for the shop. Nothing reads `branches` yet and
  -- the row is still created here rather than when multi-branch lands: a
  -- profile is attached to a branch at signup, and back-filling one for every
  -- shop later is a migration nobody wants to write.
  insert into public.branches (tenant_id, name, city, phone, is_primary)
  values (v_tenant, p_shop_name, p_city, p_phone, true)
  returning id into v_branch;

  insert into public.subscriptions
    (tenant_id, plan_id, status, billing_cycle, agreed_price, max_branches,
     max_registers, trial_ends_at, current_period_start, current_period_end,
     grace_days)
  values
    (v_tenant, p_plan_id, v_status, p_billing_cycle, p_agreed_price,
     greatest(p_max_branches, 1), greatest(p_max_registers, 1), v_trial_ends,
     p_starts_at, v_period_end, greatest(p_grace_days, 0))
  returning id into v_subscription;

  insert into public.invites
    (tenant_id, token_hash, email, phone, tenant_role, expires_at, created_by)
  values
    (v_tenant, p_token_hash, nullif(btrim(p_email), ''), p_phone, 'owner',
     now() + make_interval(days => greatest(p_invite_days, 1)), p_actor)
  returning id into v_invite;

  -- The self-serve half of the same path. Inside the transaction so an order
  -- cannot be marked verified against a tenant that failed to be created.
  if p_order_id is not null then
    update public.orders
       set status = 'verified',
           tenant_id = v_tenant,
           verified_by = p_actor,
           verified_at = now(),
           verification_started_at = null
     where id = p_order_id;
  end if;

  return jsonb_build_object(
    'tenant_id', v_tenant,
    'branch_id', v_branch,
    'subscription_id', v_subscription,
    'invite_id', v_invite,
    'status', v_status,
    'current_period_end', v_period_end
  );
end;
$fn$;

-- =============================================================================
-- A renewal, taken
--
-- The rupees and the period they bought, together. Splitting them is how a shop
-- ends up suspended with the money in the account, or trading for a month on a
-- payment nobody wrote down.
--
-- The row is locked before the new period is worked out, for the reason
-- `set_stock` locks the item row: two payments recorded from two browser tabs
-- would otherwise both read the same `current_period_end` and both extend from
-- it, and the shop would be paid up for one month having paid for two.
--
-- Extending from the later of the current period's end and the payment date is
-- what makes an early renewal add a month rather than lose the days already
-- paid for, and a late one start from today rather than back-dating a month the
-- shop never had.
-- =============================================================================
create or replace function public.record_subscription_payment(
  p_tenant uuid,
  p_amount numeric,
  p_method text,
  p_reference text,
  p_paid_at timestamptz,
  -- How many billing cycles this payment buys. Zero records the money without
  -- moving the period, which is what a part payment is.
  p_cycles integer,
  p_notes text,
  p_actor uuid
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_sub public.subscriptions%rowtype;
  v_from timestamptz;
  v_end timestamptz;
  v_start timestamptz;
  v_status text;
  v_payment uuid;
begin
  select * into v_sub
    from public.subscriptions
   where tenant_id = p_tenant
   for update;

  if not found then
    raise exception 'that shop has no subscription to take a payment against'
      using errcode = 'no_data_found';
  end if;

  if p_cycles > 0 then
    v_from := greatest(v_sub.current_period_end, p_paid_at);
    v_end := v_from + make_interval(
      months => private.cycle_months(v_sub.billing_cycle) * p_cycles);
    -- A period that had already run out starts again from the payment;
    -- one still running keeps the start it had, so the dates stay ordered.
    v_start := case
      when v_sub.current_period_end <= p_paid_at then p_paid_at
      else v_sub.current_period_start
    end;
    -- Money arriving is what un-suspends a shop. `cancelled` is included on
    -- purpose: a shop that pays after cancelling has come back, and refusing
    -- to notice would leave an operator editing the status by hand afterwards.
    v_status := case
      when v_sub.status in ('trialing', 'past_due', 'suspended', 'cancelled')
      then 'active' else v_sub.status
    end;

    update public.subscriptions
       set current_period_start = v_start,
           current_period_end = v_end,
           status = v_status,
           suspended_at = case when v_status = 'active' then null else suspended_at end,
           cancelled_at = case when v_status = 'active' then null else cancelled_at end
     where id = v_sub.id;
  else
    v_from := null;
    v_end := v_sub.current_period_end;
    v_status := v_sub.status;
  end if;

  insert into public.payments
    (tenant_id, subscription_id, amount, method, reference, paid_at,
     covers_period_start, covers_period_end, recorded_by, notes)
  values
    (p_tenant, v_sub.id, p_amount, p_method, nullif(btrim(p_reference), ''),
     p_paid_at, v_from, case when p_cycles > 0 then v_end else null end,
     p_actor, nullif(btrim(p_notes), ''))
  returning id into v_payment;

  return jsonb_build_object(
    'payment_id', v_payment,
    'status', v_status,
    'current_period_end', v_end
  );
end;
$fn$;

-- Neither write is reachable with a tenant's JWT, or with an admin's. Both are
-- called from a Server Action on the service-role client — rule 3 from
-- `0001_init.sql`, and the reason neither needs `security definer`.
revoke execute on function
    public.activate_tenant(text, text, text, text, text, text, text, text, text,
      uuid, text, numeric, integer, integer, integer, timestamptz, integer,
      text, integer, uuid, uuid),
    public.record_subscription_payment(uuid, numeric, text, text, timestamptz,
      integer, text, uuid)
  from public, anon, authenticated;

grant execute on function
    public.activate_tenant(text, text, text, text, text, text, text, text, text,
      uuid, text, numeric, integer, integer, integer, timestamptz, integer,
      text, integer, uuid, uuid),
    public.record_subscription_payment(uuid, numeric, text, text, timestamptz,
      integer, text, uuid)
  to service_role;

comment on function public.activate_tenant(text, text, text, text, text, text, text, text, text, uuid, text, numeric, integer, integer, integer, timestamptz, integer, text, integer, uuid, uuid) is
  'Tenant, branch, subscription and hashed invite in one transaction — the only way a shop comes into existence, for both the direct and the self-serve path.';
comment on function public.record_subscription_payment(uuid, numeric, text, text, timestamptz, integer, text, uuid) is
  'A renewal: the rupees and the period they bought, written together under a row lock.';
