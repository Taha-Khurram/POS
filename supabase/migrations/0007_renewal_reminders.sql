-- =============================================================================
-- 0007_renewal_reminders -- daily renewal reminder queue
--
-- Apply manually after 0006_rate_limits.sql. This creates the durable queue and
-- schedules only enqueueing; delivery remains an explicit email/WhatsApp worker
-- concern and never blocks subscription access.
-- =============================================================================

create table public.renewal_reminders (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  reminder_date date not null,
  days_until_expiry integer not null check (days_until_expiry in (1, 3, 7)),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (subscription_id, reminder_date, days_until_expiry)
);

create index renewal_reminders_pending_idx
  on public.renewal_reminders (sent_at, reminder_date);
create index renewal_reminders_tenant_idx
  on public.renewal_reminders (tenant_id, reminder_date desc);

alter table public.renewal_reminders enable row level security;
alter table public.renewal_reminders force row level security;
revoke all on public.renewal_reminders from anon, authenticated;
grant select on public.renewal_reminders to authenticated;

create policy renewal_reminders_platform_read
  on public.renewal_reminders
  for select to authenticated
  using ((select private.is_platform_admin()));

create or replace function private.enqueue_renewal_reminders()
returns void
language sql
security definer
set search_path = ''
as $fn$
  insert into public.renewal_reminders
    (tenant_id, subscription_id, reminder_date, days_until_expiry)
  select
    s.tenant_id,
    s.id,
    current_date,
    (s.current_period_end::date - current_date)::integer
  from public.subscriptions s
  where s.status in ('trialing', 'active', 'past_due')
    and (s.current_period_end::date - current_date) in (1, 3, 7)
  on conflict (subscription_id, reminder_date, days_until_expiry) do nothing;
$fn$;

revoke execute on function private.enqueue_renewal_reminders() from public;
grant execute on function private.enqueue_renewal_reminders() to service_role;

create extension if not exists pg_cron with schema extensions;

select cron.schedule(
  'flo-renewal-reminders',
  '0 8 * * *',
  $$select private.enqueue_renewal_reminders();$$
);

comment on table public.renewal_reminders is
  'Durable 7/3/1-day renewal queue; delivery is handled separately.';
