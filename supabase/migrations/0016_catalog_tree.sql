-- =============================================================================
-- 0016_catalog_tree — the shop's own departments and categories
--
-- Apply manually after 0015_catalog.sql.
--
-- 0015 said it outright: the tree was `lib/pos/catalog.ts`'s fixed six
-- departments, stored flat on `items` as text, and "a shop that needs its own
-- tree gets the table then". This is then. Every shop that sells anything the
-- six do not cover — a cloth house, a hardware store, a pharmacy — was filing
-- its whole list under "Grocery" because there was nothing else to pick.
--
-- Two tables and not one with a `parent_id`, because the tree is exactly two
-- levels deep and always will be: a department tile on the register's home
-- grid, a category tile inside it, then items. A self-referencing table would
-- need a trigger to stop a third level that no screen can draw.
--
-- `items.department` and `items.category` stay text. They are the names as they
-- were when the item was filed, not foreign keys, and that is deliberate: the
-- till, the CSV import and the tree counts all read them as words today, and
-- nothing here renames a department — the only writes are adding one and
-- removing an empty one, so there is no cascade to miss. The day rename
-- arrives, it updates the matching item rows in the same transaction.
--
-- `subcategory` goes. It was the third level, it was never on the register's
-- grid, and in practice it was one more dropdown between a shopkeeper and a
-- saved item — forty seconds an item is the budget, and a level nobody
-- browsed by was spending it.
--
-- Everything obeys 0001: tenant_id not null on both tables, RLS enabled and
-- forced, select-only for tenant JWTs. The writes are
-- `app/(app)/app/inventory/tree-actions.ts` on the service role.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · Departments
--
-- `unique (id, tenant_id)` is not redundant with the primary key: it is what
-- lets `categories` carry a composite foreign key, so a category cannot end up
-- pointing at a department belonging to another shop. Rule 1 puts tenant_id on
-- every business table, and this is what stops the two columns disagreeing.
-- -----------------------------------------------------------------------------
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 40),
  -- The order they are drawn in on the register's home grid. A shop lays its
  -- departments out by where the shelves are, not alphabetically.
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id)
);

-- Case- and space-insensitive, because "Beverages" and "beverages " are one
-- department to everybody except the database, and a shop that ends up with
-- both has two half-full tiles on the register.
create unique index if not exists departments_tenant_name_idx
  on public.departments (tenant_id, lower(btrim(name)));

-- The tree is read whole, in display order, on every load of Products & stock.
create index if not exists departments_tenant_order_idx
  on public.departments (tenant_id, sort_order, name);

-- -----------------------------------------------------------------------------
-- 2 · Categories
--
-- `department_id` is indexed by the unique index below rather than by an index
-- of its own: `(department_id, lower(btrim(name)))` is a prefix match for every
-- lookup and every cascade that column takes.
-- -----------------------------------------------------------------------------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  department_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 40),
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The composite the unique key above exists for. Deleting a department takes
  -- its categories with it; the action refuses to delete one that still has
  -- items, so the cascade only ever runs on an empty branch.
  foreign key (department_id, tenant_id)
    references public.departments (id, tenant_id) on delete cascade
);

create unique index if not exists categories_department_name_idx
  on public.categories (department_id, lower(btrim(name)));

create index if not exists categories_tenant_order_idx
  on public.categories (tenant_id, department_id, sort_order, name);

drop trigger if exists departments_set_updated_at on public.departments;
create trigger departments_set_updated_at before update on public.departments
  for each row execute function private.set_updated_at();

drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at before update on public.categories
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3 · The tree a new shop starts with
--
-- A shop with no departments cannot add a product at all, so an empty tree is
-- an onboarding wall rather than a blank slate. These are the same six that
-- were hard-coded in `lib/pos/catalog.ts`, and they are now a starting point a
-- shop edits rather than a list it is stuck inside.
--
-- One function, called by the backfill below and by the trigger after it, so
-- the shop created next year gets exactly what the shops created last year
-- got. `on conflict do nothing` throughout, so calling it twice is harmless.
-- -----------------------------------------------------------------------------
create or replace function private.seed_catalog_tree(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  branch record;
  dept_id uuid;
begin
  for branch in
    select * from (values
      (1, 'Beverages',
       array['Soft drinks', 'Juices & nectars', 'Tea & coffee', 'Water']),
      (2, 'Grocery',
       array['Atta, rice & pulses', 'Cooking oil & ghee', 'Sugar & salt',
             'Masala & spices']),
      (3, 'Dairy & bakery',
       array['Milk & cream', 'Yogurt & butter', 'Bread & rusk']),
      (4, 'Snacks & confectionery',
       array['Chips & namkeen', 'Biscuits', 'Chocolates & toffees']),
      (5, 'Household',
       array['Detergents & soap', 'Paper & cleaning']),
      (6, 'Personal care',
       array['Hair & skin', 'Oral care'])
    ) as t(pos, dept, cats)
  loop
    insert into public.departments (tenant_id, name, sort_order)
    values (p_tenant, branch.dept, branch.pos)
    on conflict do nothing;

    -- Re-read rather than `returning`: the insert above does nothing when the
    -- shop already has the department, and this function has to be safe to
    -- call twice.
    select d.id into dept_id
    from public.departments d
    where d.tenant_id = p_tenant
      and lower(btrim(d.name)) = lower(branch.dept);

    if dept_id is null then
      continue;
    end if;

    insert into public.categories (tenant_id, department_id, name, sort_order)
    select p_tenant, dept_id, c.name, c.pos
    from unnest(branch.cats) with ordinality as c(name, pos)
    on conflict do nothing;
  end loop;
end;
$$;

-- Nobody calls this from a JWT. It is the migration's and the trigger's.
revoke execute on function private.seed_catalog_tree(uuid)
  from public, anon, authenticated;

create or replace function private.seed_catalog_tree_on_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_catalog_tree(new.id);
  return new;
end;
$$;

revoke execute on function private.seed_catalog_tree_on_tenant()
  from public, anon, authenticated;

drop trigger if exists tenants_seed_catalog_tree on public.tenants;
create trigger tenants_seed_catalog_tree after insert on public.tenants
  for each row execute function private.seed_catalog_tree_on_tenant();

-- Every shop that already exists, including the ones whose items are already
-- filed under these names.
do $$
declare
  t uuid;
begin
  for t in select id from public.tenants loop
    perform private.seed_catalog_tree(t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4 · A department an item is filed under that the tree has lost
--
-- The backfill above plants the six defaults, but an item imported from a CSV
-- before this migration could carry any department string `placeInTree` let
-- through. Those names become real rows rather than being re-filed, because an
-- owner who typed "Hardware" meant it.
-- -----------------------------------------------------------------------------
-- `distinct on` and not `distinct`: two items spelled "Hardware" and "hardware"
-- are one department to the unique index, and a single INSERT offering both is
-- the one shape `on conflict do nothing` cannot save.
insert into public.departments (tenant_id, name, sort_order)
select distinct on (i.tenant_id, lower(btrim(i.department)))
  i.tenant_id, btrim(i.department), 90
from public.items i
where i.department is not null
  and length(btrim(i.department)) between 1 and 40
  and not exists (
    select 1 from public.departments d
    where d.tenant_id = i.tenant_id
      and lower(btrim(d.name)) = lower(btrim(i.department))
  )
on conflict do nothing;

insert into public.categories (tenant_id, department_id, name, sort_order)
select distinct on (d.id, lower(btrim(i.category)))
  i.tenant_id, d.id, btrim(i.category), 90
from public.items i
join public.departments d
  on d.tenant_id = i.tenant_id
  and lower(btrim(d.name)) = lower(btrim(i.department))
where i.category is not null
  and length(btrim(i.category)) between 1 and 40
  and not exists (
    select 1 from public.categories c
    where c.department_id = d.id
      and lower(btrim(c.name)) = lower(btrim(i.category))
  )
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 5 · Subcategory goes
--
-- Dropped rather than left unread. A column nothing writes and nothing shows is
-- a column that gets restored by somebody in a year on the assumption it means
-- something, and by then half the rows will disagree with the other half.
-- -----------------------------------------------------------------------------
alter table public.items drop column if exists subcategory;

-- -----------------------------------------------------------------------------
-- 6 · Privileges and RLS
--
-- Same shape as everything since 0001: readable through the shop's own JWT,
-- writable only by the service role inside a Server Action, and invisible to
-- anon. The read may carry `is_platform_admin`; there is no write policy to
-- carry it, because support impersonation is read-only.
-- -----------------------------------------------------------------------------
revoke insert, update, delete, truncate on
  public.departments, public.categories from anon, authenticated;
revoke select on public.departments, public.categories from anon;
grant select on public.departments, public.categories to authenticated;

alter table public.departments enable row level security;
alter table public.departments force row level security;
alter table public.categories enable row level security;
alter table public.categories force row level security;

drop policy if exists departments_read_own on public.departments;
create policy departments_read_own on public.departments for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_platform_admin()));

drop policy if exists categories_read_own on public.categories;
create policy categories_read_own on public.categories for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_platform_admin()));

comment on table public.departments is
  'The shop''s own top level. Drawn as tiles on the register''s home grid.';
comment on table public.categories is
  'The second and last level. A third was tried as items.subcategory and dropped in 0016.';
