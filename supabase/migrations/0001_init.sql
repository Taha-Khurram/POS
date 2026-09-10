-- =============================================================================
-- 0001_init — the platform tables
--
-- Everything Flo needs before a single sale exists: who the tenants are, what
-- they are entitled to, how they were activated, and what we did to their
-- account. Sales, stock, khata and staff arrive in later migrations.
--
-- Three rules this file establishes and every later migration must keep:
--   1. tenant_id uuid not null on every business table, with RLS from birth.
--   2. RLS reads JWT claims, never a subquery into profiles. The claims are
--      stamped by public.custom_access_token_hook at the bottom of this file.
--   3. Tenant users get SELECT policies only. Writes to platform tables happen
--      through the service role inside a Server Action, so there is exactly one
--      auditable path. Read paths may carry `or private.is_platform_admin()`;
--      write paths never do — support impersonation is read-only by design.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- A private schema for helpers. Nothing here is reachable over PostgREST, and
-- Postgres' default of granting EXECUTE to PUBLIC is revoked up front.
-- -----------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, anon, service_role;
alter default privileges in schema private revoke execute on functions from public;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

-- audit_log is append-only. RLS alone would not do it: the service role has
-- BYPASSRLS, and the service role is what the console writes with. A trigger is
-- the only thing that stops an UPDATE from either side of the connection.
create or replace function private.deny_mutation()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  raise exception 'relation %.% is append-only', tg_table_schema, tg_table_name
    using errcode = 'restrict_violation';
end;
$fn$;

-- =============================================================================
-- Tables
-- =============================================================================

-- The shop. One row per paying client. Lifecycle lives on subscriptions so
-- there is a single source of truth for "is this shop suspended".
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  shop_name text not null check (length(btrim(shop_name)) > 0),
  owner_name text not null check (length(btrim(owner_name)) > 0),
  phone text not null check (length(btrim(phone)) > 0),
  email text,
  city text not null,
  shop_type text not null check (
    shop_type in ('kiryana', 'restaurant', 'bakery', 'pharmacy', 'clothing', 'retail', 'other')
  ),
  -- Printed on every receipt once the shop gives them to us. Nullable: most
  -- kiryana stores will not have an STRN.
  ntn text,
  strn text,
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tenants_created_at_idx on public.tenants (created_at desc);
create index tenants_phone_idx on public.tenants (phone);
create index tenants_city_idx on public.tenants (city);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  city text,
  address text,
  phone text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index branches_tenant_id_idx on public.branches (tenant_id);
create unique index branches_one_primary_per_tenant
  on public.branches (tenant_id) where is_primary;

-- Auth users that belong to a shop — the owner, and optionally one manager.
-- Cashiers are NOT here: they get a PIN on the staff table (Part 3) and never
-- touch auth, which is what keeps one paid tenant at one or two MAU.
--
-- tenant_id is nullable on purpose. A half-created account has no tenant, and
-- with these policies it can read nothing at all — inert rather than dangerous.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  tenant_id uuid references public.tenants (id) on delete cascade,
  branch_id uuid references public.branches (id) on delete set null,
  tenant_role text check (tenant_role in ('owner', 'manager')),
  full_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_tenant_id_idx on public.profiles (tenant_id);
create index profiles_branch_id_idx on public.profiles (branch_id);

-- You are not a tenant. This table is the whole of /admin's access control.
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  platform_role text not null check (platform_role in ('super_admin', 'support')),
  full_name text,
  created_at timestamptz not null default now()
);

-- Plan definitions, editable from /admin/plans without a deploy. features is
-- the entitlement source; subscriptions.feature_overrides is the one-off deal
-- cut for a single client.
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = lower(code)),
  name text not null,
  pitch text,
  list_price numeric(12, 2) not null check (list_price >= 0),
  features jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One subscription per tenant. agreed_price is deliberately separate from the
-- plan's list price: Pakistani B2B sales involve haggling, and a system that can
-- only charge the list price forces you to lose the deal or lie to your records.
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  plan_id uuid not null references public.plans (id) on delete restrict,
  status text not null default 'trialing' check (
    status in ('trialing', 'active', 'past_due', 'suspended', 'cancelled')
  ),
  billing_cycle text not null default 'monthly' check (
    billing_cycle in ('monthly', 'quarterly', 'yearly')
  ),
  agreed_price numeric(12, 2) not null check (agreed_price >= 0),
  max_branches integer not null default 1 check (max_branches >= 1),
  max_registers integer not null default 1 check (max_registers >= 1),
  feature_overrides jsonb not null default '{}'::jsonb,
  trial_ends_at timestamptz,
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz not null,
  -- How long past_due is tolerated before the renewal screen appears.
  grace_days integer not null default 7 check (grace_days >= 0),
  suspended_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_period_ordered
    check (current_period_end > current_period_start)
);

create unique index subscriptions_one_per_tenant on public.subscriptions (tenant_id);
create index subscriptions_plan_id_idx on public.subscriptions (plan_id);
-- Drives the expiring-in-7/3/1 lists and the daily pg_cron sweep.
create index subscriptions_status_period_end_idx
  on public.subscriptions (status, current_period_end);

-- Self-serve checkout (path B). A row here is a claim of payment, not a
-- payment — it becomes a tenant only when you match it against your bank
-- statement and press Verify, which calls the same activateClient() as path A.
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  status text not null default 'awaiting_payment' check (
    status in ('awaiting_payment', 'proof_submitted', 'verified', 'rejected', 'expired')
  ),
  shop_name text not null,
  owner_name text not null,
  phone text not null,
  email text,
  city text not null,
  shop_type text not null,
  plan_id uuid references public.plans (id) on delete set null,
  billing_cycle text not null default 'monthly' check (
    billing_cycle in ('monthly', 'quarterly', 'yearly')
  ),
  branches integer not null default 1 check (branches >= 1),
  registers integer not null default 1 check (registers >= 1),
  quoted_price numeric(12, 2) not null check (quoted_price >= 0),
  -- Storage object path in the private payment-proofs bucket.
  proof_path text,
  proof_uploaded_at timestamptz,
  tenant_id uuid references public.tenants (id) on delete set null,
  verified_by uuid references auth.users (id) on delete set null,
  verified_at timestamptz,
  rejection_reason text,
  created_ip inet,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_status_created_at_idx on public.orders (status, created_at desc);
create index orders_tenant_id_idx on public.orders (tenant_id);
create index orders_plan_id_idx on public.orders (plan_id);
create index orders_phone_idx on public.orders (phone);

-- Every rupee taken, and who took it. This is what /admin/payments writes and
-- what the MRR strip is computed from.
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  order_id uuid references public.orders (id) on delete set null,
  amount numeric(12, 2) not null check (amount > 0),
  method text not null check (
    method in ('bank_transfer', 'easypaisa', 'jazzcash', 'cash', 'card', 'other')
  ),
  reference text,
  paid_at timestamptz not null default now(),
  covers_period_start timestamptz,
  covers_period_end timestamptz,
  recorded_by uuid references auth.users (id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

create index payments_tenant_paid_at_idx on public.payments (tenant_id, paid_at desc);
create index payments_subscription_id_idx on public.payments (subscription_id);
create index payments_order_id_idx on public.payments (order_id);
create index payments_paid_at_idx on public.payments (paid_at desc);

-- The only way a user account comes into existence. Tokens are stored hashed,
-- so a leaked database dump yields no usable invite.
create table public.invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  email text,
  phone text,
  tenant_role text not null default 'owner' check (tenant_role in ('owner', 'manager')),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index invites_tenant_id_idx on public.invites (tenant_id);
-- One live invite per tenant per role: regenerating a link must invalidate the
-- old one rather than leave two valid doors open.
create unique index invites_one_live_per_tenant_role
  on public.invites (tenant_id, tenant_role)
  where used_at is null and revoked_at is null;

-- demo-form.tsx submissions, surfaced at /admin/leads.
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  contact_name text not null,
  phone text not null,
  business_name text,
  email text,
  city text,
  shop_type text,
  registers text,
  message text,
  source text not null default 'demo_form',
  status text not null default 'new' check (
    status in ('new', 'contacted', 'qualified', 'won', 'lost')
  ),
  handled_by uuid references auth.users (id) on delete set null,
  notes text,
  created_ip inet,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index leads_status_created_at_idx on public.leads (status, created_at desc);
create index leads_handled_by_idx on public.leads (handled_by);

-- Append-only. This console can activate paid accounts and read client sales,
-- so every mutation through it lands here — including ours.
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  actor_email text,
  actor_kind text not null default 'platform_admin' check (
    actor_kind in ('platform_admin', 'tenant_user', 'system')
  ),
  action text not null,
  tenant_id uuid references public.tenants (id) on delete set null,
  subject_type text,
  subject_id text,
  before jsonb,
  after jsonb,
  ip inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index audit_log_created_at_idx on public.audit_log (created_at desc);
create index audit_log_tenant_created_at_idx on public.audit_log (tenant_id, created_at desc);
create index audit_log_actor_id_idx on public.audit_log (actor_id);
create index audit_log_action_idx on public.audit_log (action);

-- =============================================================================
-- Order references — short, human-readable, safe to read out on a phone call.
-- The alphabet drops 0/1/I/L/O/U so nobody transcribes FLO-0O1I wrong.
-- =============================================================================
create or replace function private.gen_order_reference()
returns text
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  candidate text;
  i integer;
begin
  loop
    candidate := 'FLO-';
    for i in 1..6 loop
      candidate := candidate
        || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
    end loop;
    exit when not exists (select 1 from public.orders o where o.reference = candidate);
  end loop;
  return candidate;
end;
$fn$;

alter table public.orders
  alter column reference set default private.gen_order_reference();

-- =============================================================================
-- Triggers
-- =============================================================================
create trigger tenants_set_updated_at before update on public.tenants
  for each row execute function private.set_updated_at();
create trigger branches_set_updated_at before update on public.branches
  for each row execute function private.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger plans_set_updated_at before update on public.plans
  for each row execute function private.set_updated_at();
create trigger subscriptions_set_updated_at before update on public.subscriptions
  for each row execute function private.set_updated_at();
create trigger orders_set_updated_at before update on public.orders
  for each row execute function private.set_updated_at();
create trigger leads_set_updated_at before update on public.leads
  for each row execute function private.set_updated_at();

create trigger audit_log_append_only before update or delete on public.audit_log
  for each statement execute function private.deny_mutation();

-- =============================================================================
-- Claim readers. Pure JWT reads — no table access, so no security definer and
-- no bypass risk. Policies wrap them in (select …) so Postgres evaluates them
-- once per statement instead of once per row.
-- =============================================================================
create or replace function private.current_tenant_id()
returns uuid
language sql
stable
set search_path = ''
as $fn$
  select nullif(auth.jwt() ->> 'tenant_id', '')::uuid;
$fn$;

create or replace function private.current_tenant_role()
returns text
language sql
stable
set search_path = ''
as $fn$
  select nullif(auth.jwt() ->> 'tenant_role', '');
$fn$;

create or replace function private.current_platform_role()
returns text
language sql
stable
set search_path = ''
as $fn$
  select nullif(auth.jwt() ->> 'platform_role', '');
$fn$;

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select coalesce(auth.jwt() ->> 'platform_role', '') in ('super_admin', 'support');
$fn$;

create or replace function private.is_super_admin()
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select coalesce(auth.jwt() ->> 'platform_role', '') = 'super_admin';
$fn$;

revoke execute on function
    private.set_updated_at(),
    private.deny_mutation(),
    private.gen_order_reference(),
    private.current_tenant_id(),
    private.current_tenant_role(),
    private.current_platform_role(),
    private.is_platform_admin(),
    private.is_super_admin()
  from public;

grant execute on function
    private.current_tenant_id(),
    private.current_tenant_role(),
    private.current_platform_role(),
    private.is_platform_admin(),
    private.is_super_admin()
  to authenticated;

-- =============================================================================
-- Privileges. Supabase grants anon/authenticated everything on new public
-- tables by default; RLS is the real gate, but revoking the write privileges
-- outright means a mistaken policy still cannot write. Every platform write
-- goes through the service role in a Server Action.
-- =============================================================================
revoke insert, update, delete, truncate on
    public.tenants, public.branches, public.profiles, public.platform_admins,
    public.plans, public.subscriptions, public.orders, public.payments,
    public.invites, public.leads, public.audit_log
  from anon, authenticated;

-- SELECT stays granted to authenticated and is gated by RLS below — that is
-- what lets the console read with your own JWT rather than the service role, so
-- a bug in the /admin layout gate is still caught by the database. anon reads
-- nothing at all: the one public read (/order/[ref]) runs server-side.
revoke select on
    public.tenants, public.branches, public.profiles, public.platform_admins,
    public.plans, public.subscriptions, public.orders, public.payments,
    public.invites, public.leads, public.audit_log
  from anon;

-- =============================================================================
-- Row Level Security
--
-- Tenant users get SELECT only, scoped to their own tenant_id claim. Platform
-- admins get an `or private.is_platform_admin()` on read paths only. There is
-- no INSERT/UPDATE/DELETE policy anywhere in this file, by design.
-- =============================================================================
alter table public.tenants enable row level security;
alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.platform_admins enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.orders enable row level security;
alter table public.payments enable row level security;
alter table public.invites enable row level security;
alter table public.leads enable row level security;
alter table public.audit_log enable row level security;

alter table public.tenants force row level security;
alter table public.branches force row level security;
alter table public.profiles force row level security;
alter table public.platform_admins force row level security;
alter table public.plans force row level security;
alter table public.subscriptions force row level security;
alter table public.orders force row level security;
alter table public.payments force row level security;
alter table public.invites force row level security;
alter table public.leads force row level security;
alter table public.audit_log force row level security;

create policy tenants_read_own on public.tenants
  for select to authenticated
  using (
    id = (select private.current_tenant_id())
    or (select private.is_platform_admin())
  );

create policy branches_read_own on public.branches
  for select to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    or (select private.is_platform_admin())
  );

-- A user always sees their own row; owners and managers see their colleagues.
create policy profiles_read_own_tenant on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or tenant_id = (select private.current_tenant_id())
    or (select private.is_platform_admin())
  );

create policy subscriptions_read_own on public.subscriptions
  for select to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    or (select private.is_platform_admin())
  );

create policy payments_read_own on public.payments
  for select to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    or (select private.is_platform_admin())
  );

-- The public /order/[ref] page reads by reference server-side with the service
-- role. A signed-in tenant only ever sees the orders that became their account.
create policy orders_read_own on public.orders
  for select to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    or (select private.is_platform_admin())
  );

create policy invites_read_platform on public.invites
  for select to authenticated
  using ((select private.is_platform_admin()));

create policy leads_read_platform on public.leads
  for select to authenticated
  using ((select private.is_platform_admin()));

-- You can see that you are an admin. Only a super_admin sees the roster, since
-- that is who hires and revokes support staff.
create policy platform_admins_read_self on public.platform_admins
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_super_admin()));

create policy plans_read_platform on public.plans
  for select to authenticated
  using ((select private.is_platform_admin()));

create policy audit_log_read_platform on public.audit_log
  for select to authenticated
  using ((select private.is_platform_admin()));

-- =============================================================================
-- Custom access token hook
--
-- Stamps tenant_id, tenant_role, branch_id and platform_role into the JWT so
-- RLS reads a claim instead of sub-querying profiles on every row — the
-- difference between a 40 ms and a 900 ms report.
--
-- Enable it once per project: Dashboard → Authentication → Hooks →
-- "Customize Access Token (JWT) Claims" → public.custom_access_token_hook.
--
-- NOTE: never stamp a claim named `role`. Supabase already uses `role` for the
-- Postgres role the request runs as (`authenticated`); overwriting it breaks
-- every query the client makes. Hence tenant_role.
-- =============================================================================
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  claims jsonb;
  v_user_id uuid;
  v_tenant_id uuid;
  v_branch_id uuid;
  v_tenant_role text;
  v_platform_role text;
begin
  claims := coalesce(event -> 'claims', '{}'::jsonb);
  v_user_id := (event ->> 'user_id')::uuid;

  select p.tenant_id, p.branch_id, p.tenant_role
    into v_tenant_id, v_branch_id, v_tenant_role
  from public.profiles p
  where p.id = v_user_id;

  select pa.platform_role
    into v_platform_role
  from public.platform_admins pa
  where pa.user_id = v_user_id;

  claims := jsonb_set(claims, '{tenant_id}',
    coalesce(to_jsonb(v_tenant_id::text), 'null'::jsonb), true);
  claims := jsonb_set(claims, '{branch_id}',
    coalesce(to_jsonb(v_branch_id::text), 'null'::jsonb), true);
  claims := jsonb_set(claims, '{tenant_role}',
    coalesce(to_jsonb(v_tenant_role), 'null'::jsonb), true);
  claims := jsonb_set(claims, '{platform_role}',
    coalesce(to_jsonb(v_platform_role), 'null'::jsonb), true);

  return jsonb_set(event, '{claims}', claims);
end;
$fn$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook (jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook (jsonb)
  from authenticated, anon, public;

-- The hook runs as supabase_auth_admin, which needs to read the two tables it
-- resolves claims from — and nothing else.
grant select on public.profiles, public.platform_admins to supabase_auth_admin;

create policy profiles_read_auth_admin on public.profiles
  as permissive for select to supabase_auth_admin using (true);

create policy platform_admins_read_auth_admin on public.platform_admins
  as permissive for select to supabase_auth_admin using (true);
