-- =============================================================================
-- 0009_shop_settings — the two Settings cards that had nowhere to live
--
-- Apply manually after 0008_register_foundation.sql. Shop details already had
-- columns on `tenants`; currency, the clock, and what a cashier is allowed to
-- do did not, and were rendered at their Pakistani defaults. They get tables
-- here so the screen shows what is stored rather than what is hard-coded.
--
-- Both tables inherit the rules from 0001: tenant_id not null, RLS enabled and
-- forced, select-only for tenant JWTs. Every write goes through a Server Action
-- on the service role, which is also the only thing that writes audit_log.
--
-- The closed option lists are check constraints rather than free text on
-- purpose: `lib/pos/settings-options.ts` renders exactly these ids, and a value
-- the select cannot draw is a settings row nobody can ever correct again.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Currency and clock. One row per shop; tenant_id is the key, so the primary
-- key index is also the index the RLS predicate reads.
-- -----------------------------------------------------------------------------
create table public.tenant_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  currency text not null default 'PKR'
    check (currency in ('PKR', 'AED', 'SAR', 'USD')),
  -- How the amount is written on an 80 mm roll. Most thermal printers cannot
  -- draw ₨, so 'rs-prefix' is the default and the safe answer.
  currency_format text not null default 'rs-prefix'
    check (currency_format in ('rs-prefix', 'symbol', 'suffix')),
  timezone text not null default 'Asia/Karachi'
    check (timezone in ('Asia/Karachi', 'Asia/Dubai', 'Asia/Riyadh')),
  -- Where every report window is cut. A dhaba that shuts at 1 am wants that
  -- sale on the day it opened, so this is a whole hour between midnight and 4.
  day_ends_at text not null default '00:00'
    check (day_ends_at in ('00:00', '01:00', '02:00', '03:00', '04:00')),
  week_starts_on text not null default 'monday'
    check (week_starts_on in ('monday', 'sunday', 'saturday')),
  -- MM-DD. Pakistan's financial year opens on 1 July.
  fiscal_year_starts text not null default '07-01'
    check (fiscal_year_starts in ('07-01', '01-01', '04-01')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- What each level may do. Only the two levels below the owner are stored:
-- admin is allowed everything by definition, and a row saying so is a row
-- somebody can eventually set to false and lock themselves out with.
--
-- `access_level` rather than `role`: 'cashier' is not one of the tenant_role
-- values on profiles, because a cashier is a PIN on the register and never an
-- auth user at all.
-- -----------------------------------------------------------------------------
create table public.role_permissions (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  access_level text not null check (access_level in ('cashier', 'manager')),
  can_discount boolean not null default false,
  -- Per cent off one line, and off the bill. 0 with can_discount on means a
  -- level that may press the button and never move the price — allowed, and
  -- caught by the UI rather than by a constraint.
  discount_ceiling_pct numeric(5, 2) not null default 0
    check (discount_ceiling_pct >= 0 and discount_ceiling_pct <= 100),
  can_sell_on_khata boolean not null default false,
  -- Rupees this level may put on a customer's book unasked.
  khata_ceiling numeric(12, 2) not null default 0
    check (khata_ceiling >= 0),
  can_refund boolean not null default false,
  can_open_drawer boolean not null default false,
  can_close_shift boolean not null default false,
  can_edit_items boolean not null default false,
  can_change_price boolean not null default false,
  can_view_reports boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, access_level)
);

create trigger tenant_settings_set_updated_at before update on public.tenant_settings
  for each row execute function private.set_updated_at();
create trigger role_permissions_set_updated_at before update on public.role_permissions
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Backfill. A shop with no row reads the same defaults from the application, so
-- this is not load-bearing — it simply means an existing client's first visit
-- to Settings shows a stored row rather than an implied one.
-- -----------------------------------------------------------------------------
insert into public.tenant_settings (tenant_id)
select id from public.tenants
on conflict (tenant_id) do nothing;

insert into public.role_permissions (
  tenant_id, access_level,
  can_discount, discount_ceiling_pct,
  can_sell_on_khata, khata_ceiling,
  can_refund, can_open_drawer, can_close_shift,
  can_edit_items, can_change_price, can_view_reports
)
select t.id, 'cashier', true, 5, true, 2000, false, false, false, false, false, false
from public.tenants t
on conflict (tenant_id, access_level) do nothing;

insert into public.role_permissions (
  tenant_id, access_level,
  can_discount, discount_ceiling_pct,
  can_sell_on_khata, khata_ceiling,
  can_refund, can_open_drawer, can_close_shift,
  can_edit_items, can_change_price, can_view_reports
)
select t.id, 'manager', true, 15, true, 0, true, true, true, true, false, true
from public.tenants t
on conflict (tenant_id, access_level) do nothing;

-- -----------------------------------------------------------------------------
-- Privileges and RLS. Read-only from a tenant JWT; the Settings forms post to a
-- Server Action on the service role, so a forged browser request cannot raise
-- its own discount ceiling.
-- -----------------------------------------------------------------------------
revoke insert, update, delete, truncate on
  public.tenant_settings, public.role_permissions
  from anon, authenticated;
revoke select on
  public.tenant_settings, public.role_permissions
  from anon;
grant select on
  public.tenant_settings, public.role_permissions
  to authenticated;

alter table public.tenant_settings enable row level security;
alter table public.tenant_settings force row level security;
alter table public.role_permissions enable row level security;
alter table public.role_permissions force row level security;

create policy tenant_settings_read_own on public.tenant_settings for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_platform_admin()));
create policy role_permissions_read_own on public.role_permissions for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_platform_admin()));
