-- =============================================================================
-- 0042_orders_become_clients — money first, then a client, then a plan
--
-- `0036` made one button do everything: Verify on `/admin/orders` created the
-- tenant, its branch, its subscription and an owner invite in one
-- transaction, and recorded no payment at all. The operator's day does not run
-- in that order. A transfer lands; it is recorded against the order it paid
-- for; the order is accepted and becomes a client; and the client is activated
-- on a plan when somebody has decided what the plan is. Four steps, each one a
-- thing a person does on purpose, so four writes — and the in-between states
-- are real states the console draws rather than half-done rows.
--
-- What changes:
--
-- * `payments.tenant_id` becomes nullable. A payment can now land against an
--   order before any tenant exists, and `payments_owner_known` requires one of
--   the two. Rule 1 of `0001_init.sql` says every *business* table carries a
--   not-null tenant; `payments` is the platform's own ledger about a shop, not
--   the shop's data, and a row with no tenant is invisible to every tenant JWT
--   because `tenant_id = claim` is never true of a null. The read policy is
--   untouched: select-only, `(select …)`-wrapped claim helpers, the platform
--   escape on the read path only.
--
-- * `public.create_client` replaces `activate_tenant`. It writes the tenant and
--   its primary branch and nothing else. Given an order it locks that row
--   first — the lock is what stops one order becoming two shops, which the
--   ten-minute `verification_started_at` claim in the Server Action used to do
--   from outside the transaction — refuses an order nobody has recorded money
--   against, marks it verified, and moves that order's payments onto the new
--   tenant in the same transaction.
--
-- * `public.start_subscription` is activation proper: the plan, the price, the
--   period. It attaches any payment the shop already made that no period has
--   claimed yet, so the money recorded against an order ends up saying which
--   period it bought.
--
-- * The owner's login is minted by the Server Action (`auth.admin.createUser`
--   is not a thing SQL can do), the way `/app/employees` mints a cashier's —
--   a work address and a password shown once. `invites` are no longer written.
--
-- * `paused` is a standing. It freezes the clock: the till stops, and on resume
--   the period is pushed out by exactly as long as it was paused, so a shop
--   shut for a month of renovation does not come back to find the month it paid
--   for spent. `pause_subscription` does both halves under a row lock.
--
-- * Grace is enforced. `grace_days` has been stored since `0001` and read by
--   nothing. `private.sweep_subscriptions` now moves a trading shop to
--   `past_due` when its period ends and to `suspended` when the grace days
--   after it run out, hourly on pg_cron. `getEntitlements` applies the same
--   two rules at read time, so the till stops on the hour the grace ends and
--   not whenever the sweep next runs; the two definitions have to stay
--   identical. That reverses `0036`'s "suspension is a decision somebody takes,
--   not a date that arrives" — deliberately, and at the owner's call: a lapsed
--   shop that keeps trading until somebody notices is a shop trading for free.
--   Suspended is still read-only, not locked out — the books stay the shop's.
--
-- Every write function here is granted to `service_role` alone, so none needs
-- `security definer`. No table is created and no policy is added.
-- =============================================================================

/* ---------------------------------------------------------------------------
 * Payments that arrive before the shop does
 * ------------------------------------------------------------------------- */

alter table public.payments
  alter column tenant_id drop not null,
  add constraint payments_owner_known
    check (tenant_id is not null or order_id is not null);

/* ---------------------------------------------------------------------------
 * Paused
 * ------------------------------------------------------------------------- */

alter table public.subscriptions
  drop constraint subscriptions_status_check,
  add constraint subscriptions_status_check check (
    status in ('trialing', 'active', 'past_due', 'paused', 'suspended', 'cancelled')
  ),
  add column paused_at timestamptz,
  add constraint subscriptions_paused_has_date
    check ((status = 'paused') = (paused_at is not null));

drop function if exists public.activate_tenant(
  text, text, text, text, text, text, text, text, text, uuid, text, numeric,
  integer, integer, integer, timestamptz, integer, text, integer, uuid, uuid);

/* ---------------------------------------------------------------------------
 * A client: the shop, before any plan
 * ------------------------------------------------------------------------- */

create or replace function public.create_client(
  p_shop_name text,
  p_owner_name text,
  p_phone text,
  p_email text,
  p_city text,
  p_shop_type text,
  p_ntn text,
  p_strn text,
  p_notes text,
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
  v_order public.orders%rowtype;
begin
  if p_order_id is not null then
    select * into v_order from public.orders where id = p_order_id for update;

    if not found then
      raise exception 'that order does not exist' using errcode = 'no_data_found';
    end if;

    if v_order.status not in ('awaiting_payment', 'proof_submitted') then
      raise exception 'that order has already been dealt with'
        using errcode = 'check_violation';
    end if;

    if not exists (select 1 from public.payments where order_id = p_order_id) then
      raise exception 'no payment has been recorded against that order'
        using errcode = 'check_violation';
    end if;
  end if;

  insert into public.tenants
    (shop_name, owner_name, phone, email, city, shop_type, ntn, strn, notes, created_by)
  values
    (p_shop_name, p_owner_name, p_phone, nullif(btrim(p_email), ''), p_city,
     p_shop_type, nullif(btrim(p_ntn), ''), nullif(btrim(p_strn), ''),
     nullif(btrim(p_notes), ''), p_actor)
  returning id into v_tenant;

  insert into public.branches (tenant_id, name, city, phone, is_primary)
  values (v_tenant, p_shop_name, p_city, p_phone, true)
  returning id into v_branch;

  if p_order_id is not null then
    update public.orders
       set status = 'verified',
           tenant_id = v_tenant,
           verified_by = p_actor,
           verified_at = now(),
           verification_started_at = null
     where id = p_order_id;

    update public.payments
       set tenant_id = v_tenant
     where order_id = p_order_id
       and tenant_id is null;
  end if;

  return jsonb_build_object('tenant_id', v_tenant, 'branch_id', v_branch);
end;
$fn$;

/* ---------------------------------------------------------------------------
 * Activation: a client gets a plan
 * ------------------------------------------------------------------------- */

create or replace function public.start_subscription(
  p_tenant uuid,
  p_plan_id uuid,
  p_billing_cycle text,
  p_agreed_price numeric,
  p_max_branches integer,
  p_max_registers integer,
  p_trial_days integer,
  p_starts_at timestamptz,
  p_grace_days integer
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_subscription uuid;
  v_status text;
  v_trial_ends timestamptz;
  v_period_end timestamptz;
begin
  -- Serialises two operators activating the same client from two tabs; the
  -- unique index `subscriptions_one_per_tenant` is the floor under it.
  perform 1 from public.tenants where id = p_tenant for update;
  if not found then
    raise exception 'that client does not exist' using errcode = 'no_data_found';
  end if;

  if exists (select 1 from public.subscriptions where tenant_id = p_tenant) then
    raise exception 'that client is already on a plan' using errcode = 'unique_violation';
  end if;

  if p_trial_days > 0 then
    v_status := 'trialing';
    v_trial_ends := p_starts_at + make_interval(days => p_trial_days);
    v_period_end := v_trial_ends;
  else
    v_status := 'active';
    v_period_end := p_starts_at
      + make_interval(months => private.cycle_months(p_billing_cycle));
  end if;

  insert into public.subscriptions
    (tenant_id, plan_id, status, billing_cycle, agreed_price, max_branches,
     max_registers, trial_ends_at, current_period_start, current_period_end,
     grace_days)
  values
    (p_tenant, p_plan_id, v_status, p_billing_cycle, p_agreed_price,
     greatest(p_max_branches, 1), greatest(p_max_registers, 1), v_trial_ends,
     p_starts_at, v_period_end, greatest(p_grace_days, 0))
  returning id into v_subscription;

  -- The money that came in before there was a plan to put it against. On a
  -- trial it bought no period yet, so it is linked and says so by covering
  -- nothing; the first period proper is recorded when the trial converts.
  update public.payments
     set subscription_id = v_subscription,
         covers_period_start = case when v_status = 'active' then p_starts_at end,
         covers_period_end = case when v_status = 'active' then v_period_end end
   where tenant_id = p_tenant
     and subscription_id is null;

  return jsonb_build_object(
    'subscription_id', v_subscription,
    'status', v_status,
    'current_period_end', v_period_end
  );
end;
$fn$;

/* ---------------------------------------------------------------------------
 * Pause and resume
 * ------------------------------------------------------------------------- */

create or replace function public.pause_subscription(p_tenant uuid, p_pause boolean)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_sub public.subscriptions%rowtype;
  v_end timestamptz;
  v_trial_ends timestamptz;
  v_status text;
begin
  select * into v_sub from public.subscriptions where tenant_id = p_tenant for update;

  if not found then
    raise exception 'that shop has no subscription' using errcode = 'no_data_found';
  end if;

  if p_pause then
    if v_sub.status not in ('trialing', 'active', 'past_due') then
      raise exception 'only a trading shop can be paused' using errcode = 'check_violation';
    end if;

    update public.subscriptions
       set status = 'paused', paused_at = now()
     where id = v_sub.id;

    return jsonb_build_object('status', 'paused', 'current_period_end', v_sub.current_period_end);
  end if;

  if v_sub.status <> 'paused' then
    raise exception 'that shop is not paused' using errcode = 'check_violation';
  end if;

  -- Every day it was shut goes back on the end of the period.
  v_end := v_sub.current_period_end + (now() - v_sub.paused_at);
  v_trial_ends := case
    when v_sub.trial_ends_at is not null
     and v_sub.trial_ends_at >= v_sub.current_period_end
    then v_end else v_sub.trial_ends_at
  end;
  -- Back to what it would have been had it never stopped: still on trial if
  -- the trial is still the period, otherwise trading or late by the date.
  v_status := case
    when v_trial_ends is not null and v_trial_ends >= v_end then 'trialing'
    when v_end > now() then 'active'
    else 'past_due'
  end;

  update public.subscriptions
     set status = v_status,
         paused_at = null,
         current_period_end = v_end,
         trial_ends_at = v_trial_ends
   where id = v_sub.id;

  return jsonb_build_object('status', v_status, 'current_period_end', v_end);
end;
$fn$;

/* ---------------------------------------------------------------------------
 * A renewal while paused extends the frozen period, not today's
 * ------------------------------------------------------------------------- */

create or replace function public.record_subscription_payment(
  p_tenant uuid,
  p_amount numeric,
  p_method text,
  p_reference text,
  p_paid_at timestamptz,
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
    -- A paused shop's clock is stopped, so its period ends where it ended —
    -- extending from the payment date would spend the frozen days.
    v_from := case
      when v_sub.status = 'paused' then v_sub.current_period_end
      else greatest(v_sub.current_period_end, p_paid_at)
    end;
    v_end := v_from + make_interval(
      months => private.cycle_months(v_sub.billing_cycle) * p_cycles);
    v_start := case
      when v_sub.status <> 'paused' and v_sub.current_period_end <= p_paid_at then p_paid_at
      else v_sub.current_period_start
    end;
    -- Money un-suspends a shop. A paused one stays paused: somebody paused it
    -- on purpose, and resuming is theirs to press.
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

/* ---------------------------------------------------------------------------
 * Grace, enforced
 * ------------------------------------------------------------------------- */

-- `lapseOf` in `lib/entitlements.ts` is these two rules for the till, and the
-- two have to stay identical: late once the period has ended, stopped once the
-- grace days after it have run out too.
create or replace function private.sweep_subscriptions()
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
begin
  with late as (
    update public.subscriptions
       set status = 'past_due'
     where status in ('trialing', 'active')
       and current_period_end < now()
       and current_period_end + make_interval(days => grace_days) >= now()
    returning tenant_id, id
  )
  insert into public.audit_log (actor_kind, action, tenant_id, subject_type, subject_id, after)
  select 'system', 'subscription.past_due', tenant_id, 'subscription', id::text,
         jsonb_build_object('status', 'past_due', 'reason', 'period ended')
    from late;

  with stopped as (
    update public.subscriptions
       set status = 'suspended', suspended_at = now()
     where status in ('trialing', 'active', 'past_due')
       and current_period_end + make_interval(days => grace_days) < now()
    returning tenant_id, id
  )
  insert into public.audit_log (actor_kind, action, tenant_id, subject_type, subject_id, after)
  select 'system', 'subscription.suspended', tenant_id, 'subscription', id::text,
         jsonb_build_object('status', 'suspended', 'reason', 'grace ran out')
    from stopped;
end;
$fn$;

revoke execute on function private.sweep_subscriptions() from public, anon, authenticated;

select cron.schedule('flo-subscription-sweep', '5 * * * *',
  $$select private.sweep_subscriptions()$$);

-- Catch up now rather than at five past the hour.
select private.sweep_subscriptions();

/* ---------------------------------------------------------------------------
 * The roster learns about pauses and owner logins
 * ------------------------------------------------------------------------- */
-- `paused_at` rides along so the record can say when it stopped, and
-- `has_owner` replaces `invite_open`: nothing mints an invite any more, and the
-- question the roster was asking — can anybody get in yet — is now whether an
-- owner login exists. Every other line is as `0040` left it.

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
          s.paused_at,
          private.monthly_value(s.agreed_price, s.billing_cycle) as monthly_value,
          -- Negative once the period has passed, the same sign convention
          -- `getEntitlements` hands the bell. A paused shop's clock is stopped,
          -- so its days are counted from the day it stopped.
          (s.current_period_end::date
             - coalesce(s.paused_at::date, current_date))        as days_until_expiry,
          sale.last_sale_at,
          coalesce(sale.sales_30d, 0)                            as sales_30d,
          coalesce(sale.bills_30d, 0)                            as bills_30d,
          coalesce(cat.item_count, 0)                            as item_count,
          coalesce(usr.user_count, 0)                            as user_count,
          coalesce(cnt.counter_count, 0)                         as counter_count,
          coalesce(pay.paid_total, 0)                            as paid_total,
          pay.last_paid_at,
          -- Whether anybody can sign in as the owner yet. Accepted and not yet
          -- activated is the state an operator has to finish.
          exists (
            select 1 from public.profiles o
             where o.tenant_id = t.id
               and o.tenant_role = 'owner'
          ) as has_owner
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
  'One row per shop for /admin/clients — plan, standing (null until activated), monthly value, whether an owner login exists and whether the shop is actually selling. Recent trading is thirty days counting today. Runs as the caller; the platform-admin guard is on top of RLS, not instead of it.';

/* ---------------------------------------------------------------------------
 * Grants
 * ------------------------------------------------------------------------- */

revoke execute on function
    public.create_client(text, text, text, text, text, text, text, text, text, uuid, uuid),
    public.start_subscription(uuid, uuid, text, numeric, integer, integer, integer, timestamptz, integer),
    public.pause_subscription(uuid, boolean)
  from public, anon, authenticated;

grant execute on function
    public.create_client(text, text, text, text, text, text, text, text, text, uuid, uuid),
    public.start_subscription(uuid, uuid, text, numeric, integer, integer, integer, timestamptz, integer),
    public.pause_subscription(uuid, boolean)
  to service_role;
