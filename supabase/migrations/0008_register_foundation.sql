-- =============================================================================
-- 0008_register_foundation -- offline-first register contract
--
-- Apply manually after 0007_renewal_reminders.sql. Register writes will arrive
-- through the service-role sync endpoint; tenant JWTs remain read-only.
-- Client-generated UUIDs make retries and offline replay idempotent.
-- =============================================================================

create table public.items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  sku text,
  name text not null check (length(btrim(name)) > 0),
  name_urdu text,
  search_terms text[] not null default '{}',
  unit text not null default 'piece' check (unit in ('piece', 'kilo', 'carton', 'plate')),
  selling_price numeric(12, 2) not null default 0 check (selling_price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index items_tenant_sku_idx
  on public.items (tenant_id, sku)
  where sku is not null;
create index items_tenant_active_idx on public.items (tenant_id, is_active);
create index items_search_terms_gin_idx on public.items using gin (search_terms);

create table public.register_devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  branch_id uuid not null references public.branches (id) on delete cascade,
  device_key text not null,
  label text not null,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, device_key)
);

create index register_devices_tenant_idx on public.register_devices (tenant_id, revoked_at);
create index register_devices_branch_idx on public.register_devices (branch_id, revoked_at);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  branch_id uuid not null references public.branches (id) on delete cascade,
  device_id uuid references public.register_devices (id) on delete set null,
  opened_by uuid references auth.users (id) on delete set null,
  opened_at timestamptz not null default now(),
  opening_float numeric(12, 2) not null default 0 check (opening_float >= 0),
  closed_by uuid references auth.users (id) on delete set null,
  closed_at timestamptz,
  closing_cash numeric(12, 2) check (closing_cash >= 0),
  over_short numeric(12, 2),
  status text not null default 'open' check (status in ('open', 'closed'))
);

create unique index shifts_one_open_per_device_idx
  on public.shifts (device_id)
  where status = 'open' and device_id is not null;
create index shifts_tenant_opened_idx on public.shifts (tenant_id, opened_at desc);
create index shifts_branch_opened_idx on public.shifts (branch_id, opened_at desc);

create table public.sales (
  id uuid primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  branch_id uuid not null references public.branches (id) on delete restrict,
  shift_id uuid references public.shifts (id) on delete set null,
  receipt_number text not null,
  status text not null default 'completed' check (status in ('completed', 'held', 'returned')),
  subtotal numeric(12, 2) not null check (subtotal >= 0),
  discount_total numeric(12, 2) not null default 0 check (discount_total >= 0),
  total numeric(12, 2) not null check (total >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, receipt_number)
);

create index sales_tenant_created_idx on public.sales (tenant_id, created_at desc);
create index sales_branch_created_idx on public.sales (branch_id, created_at desc);
create index sales_shift_idx on public.sales (shift_id);

create table public.sale_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  sale_id uuid not null references public.sales (id) on delete cascade,
  item_id uuid references public.items (id) on delete set null,
  name_snapshot text not null,
  unit text not null check (unit in ('piece', 'kilo', 'carton', 'plate')),
  quantity numeric(12, 3) not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  discount numeric(12, 2) not null default 0 check (discount >= 0),
  line_total numeric(12, 2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create index sale_lines_tenant_created_idx on public.sale_lines (tenant_id, created_at desc);
create index sale_lines_sale_idx on public.sale_lines (sale_id);
create index sale_lines_item_idx on public.sale_lines (item_id);

create table public.sale_tenders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  sale_id uuid not null references public.sales (id) on delete cascade,
  method text not null check (method in ('cash', 'card', 'raast', 'easypaisa', 'jazzcash', 'udhaar')),
  amount numeric(12, 2) not null check (amount >= 0),
  created_at timestamptz not null default now()
);

create index sale_tenders_tenant_created_idx on public.sale_tenders (tenant_id, created_at desc);
create index sale_tenders_sale_idx on public.sale_tenders (sale_id);

create table public.sync_outbox (
  id uuid primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  operation text not null check (operation in ('insert', 'update', 'delete')),
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  synced_at timestamptz
);

create index sync_outbox_pending_idx on public.sync_outbox (tenant_id, created_at) where synced_at is null;
create unique index sync_outbox_entity_operation_idx on public.sync_outbox (tenant_id, entity_type, entity_id, operation) where synced_at is null;

create trigger items_set_updated_at before update on public.items
  for each row execute function private.set_updated_at();

-- Read-only from tenant JWTs. Sync and register mutations use audited server
-- actions, so a forged browser request cannot rewrite sales or the outbox.
revoke insert, update, delete, truncate on
  public.items, public.register_devices, public.shifts, public.sales,
  public.sale_lines, public.sale_tenders, public.sync_outbox
  from anon, authenticated;
revoke select on
  public.items, public.register_devices, public.shifts, public.sales,
  public.sale_lines, public.sale_tenders, public.sync_outbox
  from anon;
grant select on
  public.items, public.register_devices, public.shifts, public.sales,
  public.sale_lines, public.sale_tenders, public.sync_outbox
  to authenticated;

alter table public.items enable row level security;
alter table public.items force row level security;
alter table public.register_devices enable row level security;
alter table public.register_devices force row level security;
alter table public.shifts enable row level security;
alter table public.shifts force row level security;
alter table public.sales enable row level security;
alter table public.sales force row level security;
alter table public.sale_lines enable row level security;
alter table public.sale_lines force row level security;
alter table public.sale_tenders enable row level security;
alter table public.sale_tenders force row level security;
alter table public.sync_outbox enable row level security;
alter table public.sync_outbox force row level security;

create policy items_read_own on public.items for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_platform_admin()));
create policy register_devices_read_own on public.register_devices for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_platform_admin()));
create policy shifts_read_own on public.shifts for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_platform_admin()));
create policy sales_read_own on public.sales for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_platform_admin()));
create policy sale_lines_read_own on public.sale_lines for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_platform_admin()));
create policy sale_tenders_read_own on public.sale_tenders for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_platform_admin()));
create policy sync_outbox_read_own on public.sync_outbox for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_platform_admin()));
