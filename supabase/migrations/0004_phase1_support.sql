-- =============================================================================
-- 0004_phase1_support -- support notes and client health snapshots
--
-- Apply manually in Supabase after 0003_storage.sql. These tables are kept
-- separate from tenants so notes remain timestamped and health can be updated
-- by the future register/staff sync without changing the admin contract.
-- =============================================================================

create table public.tenant_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  author_id uuid references auth.users (id) on delete set null,
  body text not null check (length(btrim(body)) > 0),
  created_at timestamptz not null default now()
);

create index tenant_notes_tenant_created_at_idx
  on public.tenant_notes (tenant_id, created_at desc);
create index tenant_notes_author_id_idx
  on public.tenant_notes (author_id);

create table public.tenant_health (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  last_sale_at timestamptz,
  last_sync_at timestamptz,
  pending_outbox_count integer not null default 0 check (pending_outbox_count >= 0),
  registered_devices_count integer not null default 0 check (registered_devices_count >= 0),
  staff_count integer not null default 0 check (staff_count >= 0),
  item_count integer not null default 0 check (item_count >= 0),
  updated_at timestamptz not null default now()
);

create index tenant_health_last_sale_idx
  on public.tenant_health (last_sale_at);
create index tenant_health_last_sync_idx
  on public.tenant_health (last_sync_at);

create trigger tenant_health_set_updated_at
  before update on public.tenant_health
  for each row execute function private.set_updated_at();

revoke insert, update, delete, truncate
  on public.tenant_notes, public.tenant_health
  from anon, authenticated;
revoke select on public.tenant_notes, public.tenant_health from anon;

grant select on public.tenant_notes, public.tenant_health to authenticated;

alter table public.tenant_notes enable row level security;
alter table public.tenant_notes force row level security;
alter table public.tenant_health enable row level security;
alter table public.tenant_health force row level security;

create policy tenant_notes_platform_read
  on public.tenant_notes
  for select to authenticated
  using ((select private.is_platform_admin()));

create policy tenant_health_platform_read
  on public.tenant_health
  for select to authenticated
  using ((select private.is_platform_admin()));

comment on table public.tenant_notes is
  'Timestamped internal support notes for platform operators.';
comment on table public.tenant_health is
  'Latest usage/sync snapshot written by future register and sync services.';
