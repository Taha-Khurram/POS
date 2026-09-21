-- =============================================================================
-- 0033_restaurant — tables, the kitchen, and a bill that stays open
--
-- Apply manually after 0032_tenders.sql.
--
-- Everything in Flo so far assumes the shape of a kiryana: a customer arrives
-- at a counter with shopping, the bill is rung up and settled, and the
-- transaction is over in ninety seconds. A dhaba is the other shape entirely.
-- Four people sit down, the order arrives in pieces over an hour, half of it
-- has to reach a cook who is not at the till, somebody wants the qeema without
-- onions, and the money is taken at the end — by which time the till has served
-- eleven other things.
--
-- **A table order is not a sale until it is settled.** It claims no receipt
-- number and it moves no stock, for exactly the reason `held_bills` claims
-- neither: a number issued before anybody has paid is a hole in the shop's
-- series that `record_sale`'s single transaction exists to prevent. Settling
-- calls `record_sale` with the order's lines, which is the one write that
-- claims a number, takes the stock and records the money — and the order is
-- marked settled pointing at the sale it became.
--
-- **Restaurant mode is a shop-level switch and off by default.** A kiryana must
-- not grow a table map, and a shop that turns it on does not lose its counter:
-- the register still works exactly as it did, and `/app/tables` is a second way
-- in rather than a replacement.
--
-- **The kitchen ticket is a print, not a printer.** `kots` records what was
-- sent and when, and the ticket prints through the same `@media print` block
-- the receipt uses. Routing a ticket to a *particular* printer at the grill is
-- hardware Flo does not have and does not pretend to — what it has is the
-- ticket, numbered, timed, and reprintable, which is what a kitchen argues over.
--
-- Everything obeys 0001: `tenant_id not null`, RLS enabled and forced, select
-- only for tenant JWTs, every write through a security-definer function.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · The switch
--
-- On `tenant_settings` rather than derived from `tenant_settings.shop_type`,
-- because the two answer different questions: a bakery with four seats is a
-- 'bakery' that needs tables, and a caterer is a 'restaurant' that has none.
-- What draws the table map is whether the shop wants one.
-- -----------------------------------------------------------------------------
alter table public.tenant_settings
  add column if not exists restaurant_mode boolean not null default false;

comment on column public.tenant_settings.restaurant_mode is
  'Draws the table map and the kitchen ticket. Off by default and independent of shop_type: a bakery with four seats needs it and a caterer does not.';

-- -----------------------------------------------------------------------------
-- 2 · The tables
--
-- `area` is free text — "Terrace", "Family hall", "Upstairs" — because every
-- dhaba names its sections differently and a closed list would be six rows to
-- delete before anybody could type theirs. It is the grouping the map draws.
--
-- There is no `status` column. Whether a table is occupied is whether an open
-- order sits on it, which is a fact about `table_orders` — and a stored status
-- is the second copy that drifts the first time a settle fails halfway.
-- -----------------------------------------------------------------------------
create table if not exists public.dining_tables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  branch_id uuid not null references public.branches (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 24),
  area text check (area is null or length(btrim(area)) <= 40),
  -- What it seats. Shown on the map so a waiter sitting a party of six does not
  -- walk to a two-top, and carried onto the order as `covers` defaults.
  seats smallint not null default 4 check (seats between 1 and 40),
  sort_order integer not null default 0,
  -- Off keeps its history and takes it off the map — a table pushed into the
  -- store room for the winter. The same bargain every `is_active` in this
  -- schema strikes.
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One name per shop. "T4" twice is two tables nobody can tell apart on a ticket.
create unique index if not exists dining_tables_tenant_name_idx
  on public.dining_tables (tenant_id, lower(btrim(name)));

create index if not exists dining_tables_tenant_map_idx
  on public.dining_tables (tenant_id, is_active, area, sort_order);

drop trigger if exists dining_tables_set_updated_at on public.dining_tables;
create trigger dining_tables_set_updated_at before update on public.dining_tables
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3 · What somebody ordered
--
-- `service` is the distinction a kitchen and a cashier both need. A parcel is
-- packed and handed over; a dine-in is plated and carried. They are priced the
-- same and printed differently, and a parcel has no table — which is why
-- `table_id` is nullable and the check below ties the two together.
--
-- `order_number` is a shop-wide running number off `document_series`, not a
-- receipt number. A table order is not a sale (see the header) and must never
-- look like one: `T-00042` on a kitchen ticket cannot be mistaken for
-- `ALM-260921-0042` on a receipt.
-- -----------------------------------------------------------------------------
create table if not exists public.table_orders (
  id uuid primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  branch_id uuid not null references public.branches (id) on delete cascade,
  -- Null for a parcel or a delivery. `on delete set null` so retiring a table
  -- never deletes what was eaten at it.
  table_id uuid references public.dining_tables (id) on delete set null,
  order_number text not null,
  service text not null default 'dine_in'
    check (service in ('dine_in', 'parcel', 'delivery')),
  status text not null default 'open'
    check (status in ('open', 'settled', 'cancelled')),
  -- How many people are eating. Not decoration: covers per table and spend per
  -- cover are the two figures a restaurant runs on, and neither can be
  -- recovered afterwards from a bill.
  covers smallint check (covers is null or covers between 1 and 60),
  customer_id uuid references public.customers (id) on delete set null,
  note text check (note is null or length(btrim(note)) <= 500),
  -- The sale it became. Null while open, and the whole link between this table
  -- and the money — every figure a restaurant reports still comes off `sales`.
  sale_id uuid references public.sales (id) on delete set null,
  opened_by uuid references auth.users (id) on delete set null,
  opened_at timestamptz not null default now(),
  settled_at timestamptz,
  updated_at timestamptz not null default now(),
  -- A dine-in order is at a table; a parcel is not. Enforced rather than left
  -- to the screens, because an order with neither is one nobody can find and an
  -- order with both is one two waiters will serve.
  constraint table_orders_seated
    check ((service = 'dine_in') = (table_id is not null))
);

create unique index if not exists table_orders_tenant_number_idx
  on public.table_orders (tenant_id, order_number);

-- **One open order per table.** The index is what guarantees it, not a check in
-- a Server Action: two waiters opening the same table at the same second is the
-- ordinary way a restaurant gets two bills for one party.
create unique index if not exists table_orders_one_open_per_table_idx
  on public.table_orders (table_id)
  where status = 'open' and table_id is not null;

-- The map, and the "what is still open" list the floor runs on.
create index if not exists table_orders_tenant_open_idx
  on public.table_orders (tenant_id, status, opened_at desc);

drop trigger if exists table_orders_set_updated_at on public.table_orders;
create trigger table_orders_set_updated_at before update on public.table_orders
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4 · The lines
--
-- `course` is what a kitchen sequences on. Starters go now, mains go when the
-- starters are cleared, and a ticket that cannot say which is a ticket the cook
-- ignores.
--
-- `status` is the line's own journey: `new` is typed and not yet sent, `sent`
-- is on a ticket in the kitchen, `void` is cancelled. A voided line is kept
-- rather than deleted — "who cancelled the mutton after it was fired" is the
-- question a restaurant asks at the end of a bad night, and a deleted row
-- cannot answer it.
--
-- Prices are snapshotted at the moment the line is added, unlike a held bill
-- which re-prices on resume. A restaurant quotes off a menu the customer is
-- holding, and a rate that changed between the order and the bill is an
-- argument at the table.
-- -----------------------------------------------------------------------------
create table if not exists public.table_order_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  order_id uuid not null references public.table_orders (id) on delete cascade,
  item_id uuid references public.items (id) on delete set null,
  variant_id uuid references public.item_variants (id) on delete set null,
  name_snapshot text not null check (length(btrim(name_snapshot)) between 1 and 160),
  unit text not null,
  quantity numeric(12, 3) not null check (quantity > 0),
  -- What the menu said when it was ordered. See above.
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  course text not null default 'main'
    check (course in ('drinks', 'starter', 'main', 'dessert')),
  status text not null default 'new'
    check (status in ('new', 'sent', 'void')),
  -- "No onions", "extra spicy", "well done". The unpriced half of a modifier,
  -- and the half every dhaba actually uses.
  note text check (note is null or length(btrim(note)) <= 200),
  -- Which ticket it went to the kitchen on. Null while `new`.
  kot_id uuid,
  voided_by uuid references auth.users (id) on delete set null,
  voided_reason text check (voided_reason is null or length(btrim(voided_reason)) <= 200),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists table_order_lines_order_idx
  on public.table_order_lines (order_id, course, created_at);

create index if not exists table_order_lines_kot_idx
  on public.table_order_lines (kot_id)
  where kot_id is not null;

-- -----------------------------------------------------------------------------
-- 5 · The priced half of a modifier
--
-- Two shapes exist and both are real: "no onions" changes nothing but the
-- cooking, and "extra cheese" changes the bill. The first is
-- `table_order_lines.note` above — free text, because no list survives contact
-- with a kitchen. The second has to be a row, because it has a price and the
-- customer is going to be charged it.
--
-- `group_name` is what the choice is called on screen — "Add-ons", "Spice",
-- "Size of the naan". Free text for the reason `dining_tables.area` is: every
-- kitchen names them differently.
--
-- Deliberately *not* a min/max selection rule engine. A required single-choice
-- group with a default is a modelling exercise that pays off in a chain with a
-- menu team; a dhaba needs a list of things you can add, each with a price.
-- -----------------------------------------------------------------------------
create table if not exists public.item_modifiers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  group_name text not null default 'Add-ons'
    check (length(btrim(group_name)) between 1 and 40),
  name text not null check (length(btrim(name)) between 1 and 60),
  -- Signed: "no raita" can take money off as easily as "extra cheese" puts it
  -- on, and a shop that discounts a substitution should not have to fake it.
  price_delta numeric(12, 2) not null default 0,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists item_modifiers_identity_idx
  on public.item_modifiers (
    tenant_id, item_id, lower(btrim(group_name)), lower(btrim(name))
  );

create index if not exists item_modifiers_item_idx
  on public.item_modifiers (tenant_id, item_id, sort_order);

/* What was actually chosen on one line, with the price as it stood — the same
   snapshot discipline `unit_price` above keeps, and for the same reason: a
   kitchen that puts the cheese up by twenty rupees on Friday must not change
   what Thursday's table was charged. */
create table if not exists public.table_order_line_modifiers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  line_id uuid not null references public.table_order_lines (id) on delete cascade,
  modifier_id uuid references public.item_modifiers (id) on delete set null,
  name_snapshot text not null check (length(btrim(name_snapshot)) between 1 and 60),
  price_delta numeric(12, 2) not null default 0
);

create index if not exists table_order_line_modifiers_line_idx
  on public.table_order_line_modifiers (line_id);

-- -----------------------------------------------------------------------------
-- 6 · The kitchen ticket
--
-- One row per *send*, not per order. A table that orders starters at eight and
-- mains at half past has two tickets, and the kitchen works off the second
-- without re-reading the first. That is also what makes a reprint meaningful:
-- "KOT-00114, sent 20:31" is a thing a cook can be asked about.
--
-- `printed_at` is when the browser drew it. Flo does not route to a printer at
-- the grill — see the header — so this is the honest record of when somebody
-- pressed print, which is the question anybody actually asks.
-- -----------------------------------------------------------------------------
create table if not exists public.kots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  order_id uuid not null references public.table_orders (id) on delete cascade,
  kot_number text not null,
  sent_at timestamptz not null default now(),
  printed_at timestamptz,
  sent_by uuid references auth.users (id) on delete set null,
  note text check (note is null or length(btrim(note)) <= 200)
);

create unique index if not exists kots_tenant_number_idx
  on public.kots (tenant_id, kot_number);

create index if not exists kots_order_idx on public.kots (order_id, sent_at);

alter table public.table_order_lines
  drop constraint if exists table_order_lines_kot_id_fkey;
alter table public.table_order_lines
  add constraint table_order_lines_kot_id_fkey
  foreign key (kot_id) references public.kots (id) on delete set null;

-- Two more running series for `document_series`, which `0028` built open-ended
-- for exactly this.
alter table public.document_series drop constraint if exists document_series_kind_check;
alter table public.document_series add constraint document_series_kind_check
  check (kind in ('purchase_order', 'goods_receipt', 'table_order', 'kot'));

-- -----------------------------------------------------------------------------
-- 7 · Who may read it
-- -----------------------------------------------------------------------------
revoke insert, update, delete, truncate on public.dining_tables from anon, authenticated;
revoke insert, update, delete, truncate on public.table_orders from anon, authenticated;
revoke insert, update, delete, truncate on public.table_order_lines from anon, authenticated;
revoke insert, update, delete, truncate on public.item_modifiers from anon, authenticated;
revoke insert, update, delete, truncate on public.table_order_line_modifiers from anon, authenticated;
revoke insert, update, delete, truncate on public.kots from anon, authenticated;

alter table public.dining_tables enable row level security;
alter table public.dining_tables force row level security;
alter table public.table_orders enable row level security;
alter table public.table_orders force row level security;
alter table public.table_order_lines enable row level security;
alter table public.table_order_lines force row level security;
alter table public.item_modifiers enable row level security;
alter table public.item_modifiers force row level security;
alter table public.table_order_line_modifiers enable row level security;
alter table public.table_order_line_modifiers force row level security;
alter table public.kots enable row level security;
alter table public.kots force row level security;

drop policy if exists dining_tables_read_own on public.dining_tables;
create policy dining_tables_read_own on public.dining_tables for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_platform_admin()));

drop policy if exists table_orders_read_own on public.table_orders;
create policy table_orders_read_own on public.table_orders for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_platform_admin()));

drop policy if exists table_order_lines_read_own on public.table_order_lines;
create policy table_order_lines_read_own on public.table_order_lines for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_platform_admin()));

drop policy if exists item_modifiers_read_own on public.item_modifiers;
create policy item_modifiers_read_own on public.item_modifiers for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_platform_admin()));

drop policy if exists table_order_line_modifiers_read_own on public.table_order_line_modifiers;
create policy table_order_line_modifiers_read_own on public.table_order_line_modifiers for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_platform_admin()));

drop policy if exists kots_read_own on public.kots;
create policy kots_read_own on public.kots for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_platform_admin()));

-- -----------------------------------------------------------------------------
-- 8 · The flag stops lying
--
-- `0020`'s rule: `restaurant_mode` was false because there was none, and it
-- goes true in the migration that lands one. Both plans — a dhaba on Standard
-- with no table map is not a tier, it is a shop that cannot use the product.
-- -----------------------------------------------------------------------------
update public.plans
   set features = features || jsonb_build_object('restaurant_mode', true)
 where code in ('standard', 'premium');

-- -----------------------------------------------------------------------------
-- 9 · Sitting somebody down
--
-- Replay-safe on a client-minted id, like every other write in this schema: a
-- waiter's tablet on shop Wi-Fi drops a request and retries, and a second order
-- on the same table is two bills for one party.
--
-- The one-open-order-per-table index does the real work. This function's own
-- check is there to turn a 23505 into a sentence; the index is what makes it
-- impossible for two waiters pressing at the same second.
-- -----------------------------------------------------------------------------
create or replace function public.open_table_order(
  p_tenant uuid,
  p_order_id uuid,
  p_table uuid,
  p_service text,
  p_covers smallint,
  p_customer uuid,
  p_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_branch uuid;
  v_number text;
  v_existing text;
begin
  select order_number into v_existing from public.table_orders
   where id = p_order_id and tenant_id = p_tenant;

  if found then
    return jsonb_build_object('order_number', v_existing, 'replayed', true);
  end if;

  if p_service not in ('dine_in', 'parcel', 'delivery') then
    raise exception '% is not a kind of order', p_service using errcode = '22023';
  end if;

  if p_service = 'dine_in' and p_table is null then
    raise exception 'a dine-in order has to be at a table' using errcode = '22023';
  end if;

  if p_table is not null then
    select b.branch_id into v_branch
      from public.dining_tables b
     where b.id = p_table and b.tenant_id = p_tenant and b.is_active;

    if not found then
      raise exception 'that table is not one of this shop''s open tables'
        using errcode = 'restrict_violation';
    end if;

    if exists (
      select 1 from public.table_orders o
       where o.table_id = p_table and o.status = 'open'
    ) then
      raise exception 'that table already has a bill open on it'
        using errcode = 'restrict_violation';
    end if;
  else
    select b.id into v_branch from public.branches b
     where b.tenant_id = p_tenant and b.is_primary limit 1;
  end if;

  if v_branch is null then
    raise exception 'this shop has no branch, so an order has nowhere to land'
      using errcode = 'restrict_violation';
  end if;

  v_number := 'T-' || lpad(private.next_number(p_tenant, 'table_order')::text, 5, '0');

  insert into public.table_orders (
    id, tenant_id, branch_id, table_id, order_number, service, covers,
    customer_id, opened_by
  )
  values (
    p_order_id, p_tenant, v_branch, p_table, v_number, p_service,
    p_covers, p_customer, p_by
  );

  return jsonb_build_object('order_number', v_number, 'replayed', false);
end;
$fn$;

revoke execute on function public.open_table_order(uuid, uuid, uuid, text, smallint, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.open_table_order(uuid, uuid, uuid, text, smallint, uuid, uuid)
  to service_role;

-- -----------------------------------------------------------------------------
-- 10 · Adding to the order
--
-- Appends only. A line already on a ticket in the kitchen cannot be edited by
-- this — it is voided instead, which leaves the record of what was fired and
-- then cancelled. That is the difference between a bill a restaurant can argue
-- from and one it cannot.
--
-- The price is snapshotted here rather than re-read at settle. A restaurant
-- quotes off a menu the customer is holding; a rate that moved between the
-- order and the bill is an argument at the table, and the shop loses it.
-- -----------------------------------------------------------------------------
create or replace function public.add_order_lines(
  p_tenant uuid,
  p_order uuid,
  p_lines jsonb,
  p_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_line jsonb;
  v_mod jsonb;
  v_line_id uuid;
  v_added integer := 0;
  v_status text;
begin
  select status into v_status from public.table_orders
   where id = p_order and tenant_id = p_tenant for update;

  if not found then
    raise exception 'that order is not this shop''s' using errcode = 'restrict_violation';
  end if;

  if v_status <> 'open' then
    raise exception 'that bill is %, so nothing more can go on it', v_status
      using errcode = 'restrict_violation';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('added', 0);
  end if;

  if jsonb_array_length(p_lines) > 100 then
    raise exception 'a hundred lines at once is a mistype, not an order'
      using errcode = '22023';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    insert into public.table_order_lines (
      tenant_id, order_id, item_id, variant_id, name_snapshot, unit,
      quantity, unit_price, course, note, created_by
    )
    values (
      p_tenant,
      p_order,
      nullif(v_line->>'item_id', '')::uuid,
      nullif(v_line->>'variant_id', '')::uuid,
      v_line->>'name',
      coalesce(v_line->>'unit', 'plate'),
      (v_line->>'quantity')::numeric,
      (v_line->>'unit_price')::numeric,
      coalesce(v_line->>'course', 'main'),
      nullif(btrim(coalesce(v_line->>'note', '')), ''),
      p_by
    )
    returning id into v_line_id;

    -- The priced half of a modifier, snapshotted beside the line for the reason
    -- the price is: putting the cheese up on Friday must not change what
    -- Thursday's table was charged.
    for v_mod in select * from jsonb_array_elements(coalesce(v_line->'modifiers', '[]'::jsonb))
    loop
      insert into public.table_order_line_modifiers (
        tenant_id, line_id, modifier_id, name_snapshot, price_delta
      )
      values (
        p_tenant,
        v_line_id,
        nullif(v_mod->>'id', '')::uuid,
        v_mod->>'name',
        coalesce((v_mod->>'price_delta')::numeric, 0)
      );
    end loop;

    v_added := v_added + 1;
  end loop;

  return jsonb_build_object('added', v_added);
end;
$fn$;

revoke execute on function public.add_order_lines(uuid, uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.add_order_lines(uuid, uuid, jsonb, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 11 · Sending it to the kitchen
--
-- Everything still `new` on the order goes onto one ticket and becomes `sent`.
-- One row per send rather than per order, so a table that orders starters at
-- eight and mains at half past has two tickets and the kitchen works off the
-- second without re-reading the first.
--
-- Nothing is sent twice: the `status = 'new'` filter is the whole guard, and it
-- is inside the same statement that stamps the ticket, so a double tap sends
-- nothing the second time rather than re-firing the grill.
-- -----------------------------------------------------------------------------
create or replace function public.send_to_kitchen(
  p_tenant uuid,
  p_order uuid,
  p_by uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_kot uuid;
  v_number text;
  v_lines integer;
  v_status text;
begin
  select status into v_status from public.table_orders
   where id = p_order and tenant_id = p_tenant for update;

  if not found then
    raise exception 'that order is not this shop''s' using errcode = 'restrict_violation';
  end if;

  if v_status <> 'open' then
    raise exception 'that bill is %, so nothing can go to the kitchen', v_status
      using errcode = 'restrict_violation';
  end if;

  if not exists (
    select 1 from public.table_order_lines l
     where l.order_id = p_order and l.status = 'new'
  ) then
    return jsonb_build_object('sent', 0, 'kot_number', null);
  end if;

  v_number := 'KOT-' || lpad(private.next_number(p_tenant, 'kot')::text, 5, '0');

  insert into public.kots (tenant_id, order_id, kot_number, sent_by, note)
  values (p_tenant, p_order, v_number, p_by,
          nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_kot;

  update public.table_order_lines
     set status = 'sent', kot_id = v_kot
   where order_id = p_order and status = 'new';

  get diagnostics v_lines = row_count;

  return jsonb_build_object('sent', v_lines, 'kot_number', v_number, 'kot_id', v_kot);
end;
$fn$;

revoke execute on function public.send_to_kitchen(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.send_to_kitchen(uuid, uuid, uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- 12 · Taking something off
--
-- A line that has not been sent is deleted outright: it was a mistype and never
-- reached a cook, and keeping it would fill every bill with rows nobody ordered.
--
-- A line that *has* been sent is voided and kept, with who did it and why. The
-- food was cooked — somebody has to answer for it at the end of the night, and
-- a deleted row cannot be asked.
-- -----------------------------------------------------------------------------
create or replace function public.void_order_line(
  p_tenant uuid,
  p_line uuid,
  p_reason text,
  p_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_status text;
  v_order uuid;
  v_order_status text;
begin
  select l.status, l.order_id into v_status, v_order
    from public.table_order_lines l
   where l.id = p_line and l.tenant_id = p_tenant
     for update;

  if not found then
    raise exception 'that line is not on any of this shop''s orders'
      using errcode = 'restrict_violation';
  end if;

  select status into v_order_status from public.table_orders
   where id = v_order and tenant_id = p_tenant;

  if v_order_status <> 'open' then
    raise exception 'that bill is %, so its lines cannot be changed', v_order_status
      using errcode = 'restrict_violation';
  end if;

  if v_status = 'void' then
    return jsonb_build_object('voided', false, 'deleted', false);
  end if;

  -- Never fired, never cooked. Gone.
  if v_status = 'new' then
    delete from public.table_order_lines where id = p_line;
    return jsonb_build_object('voided', false, 'deleted', true);
  end if;

  update public.table_order_lines
     set status = 'void',
         voided_by = p_by,
         voided_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_line;

  return jsonb_build_object('voided', true, 'deleted', false);
end;
$fn$;

revoke execute on function public.void_order_line(uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.void_order_line(uuid, uuid, text, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 13 · Moving a party, and closing an empty bill
-- -----------------------------------------------------------------------------
create or replace function public.move_table_order(
  p_tenant uuid,
  p_order uuid,
  p_table uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if exists (
    select 1 from public.table_orders o
     where o.table_id = p_table and o.status = 'open' and o.id <> p_order
  ) then
    raise exception 'that table already has a bill open on it'
      using errcode = 'restrict_violation';
  end if;

  if not exists (
    select 1 from public.dining_tables t
     where t.id = p_table and t.tenant_id = p_tenant and t.is_active
  ) then
    raise exception 'that table is not one of this shop''s open tables'
      using errcode = 'restrict_violation';
  end if;

  update public.table_orders
     set table_id = p_table, service = 'dine_in'
   where id = p_order and tenant_id = p_tenant and status = 'open';

  if not found then
    raise exception 'that order is not open' using errcode = 'restrict_violation';
  end if;

  return jsonb_build_object('moved', true);
end;
$fn$;

revoke execute on function public.move_table_order(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.move_table_order(uuid, uuid, uuid) to service_role;

/**
 * Closing a bill nobody paid.
 *
 * Only while nothing has reached the kitchen. Once food is cooked the bill has
 * a cost behind it and walking away from it is a decision somebody has to make
 * deliberately — which is what voiding every line is for, and it leaves the
 * record of what was fired.
 */
create or replace function public.cancel_table_order(
  p_tenant uuid,
  p_order uuid,
  p_reason text,
  p_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_sent integer;
begin
  select count(*) into v_sent
    from public.table_order_lines l
   where l.order_id = p_order and l.tenant_id = p_tenant and l.status = 'sent';

  if v_sent > 0 then
    raise exception
      '% lines have already gone to the kitchen. Void them one at a time so the record says who cancelled what.', v_sent
      using errcode = 'restrict_violation';
  end if;

  update public.table_orders
     set status = 'cancelled',
         note = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), note),
         settled_at = now()
   where id = p_order and tenant_id = p_tenant and status = 'open';

  if not found then
    raise exception 'that order is not open' using errcode = 'restrict_violation';
  end if;

  return jsonb_build_object('cancelled', true);
end;
$fn$;

revoke execute on function public.cancel_table_order(uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_table_order(uuid, uuid, text, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 14 · Settling it
--
-- This is the moment a table order becomes a sale: `record_sale` claims the
-- receipt number, writes the lines, takes the stock and records the tenders —
-- all of it in this transaction, so an order can never be marked settled
-- against a sale that failed to insert.
--
-- The lines are built here rather than by the Server Action, because the price
-- on a table line is the one that was quoted and the modifiers have to be
-- folded into it. A modifier is *not* a line of its own on the receipt: "Chicken
-- karahi — extra cheese" is one thing the customer ordered and one price they
-- are paying, and splitting it would print a bill nobody can check against a
-- menu.
--
-- Voided lines are left out. They were cooked, they are a cost, and they are in
-- the record — but nobody is charged for them.
-- -----------------------------------------------------------------------------
create or replace function public.settle_table_order(
  p_tenant uuid,
  p_order uuid,
  p_counter uuid,
  p_sale_id uuid,
  p_business_day date,
  p_tenders jsonb,
  p_discount numeric,
  p_ceiling_pct numeric,
  p_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_order public.table_orders%rowtype;
  v_lines jsonb;
  v_subtotal numeric;
  v_result jsonb;
begin
  select * into v_order from public.table_orders
   where id = p_order and tenant_id = p_tenant for update;

  if not found then
    raise exception 'that order is not this shop''s' using errcode = 'restrict_violation';
  end if;

  -- Already settled. Handed back rather than raised, so a retry after a dropped
  -- connection shows the cashier the receipt instead of an error against a bill
  -- the customer has already paid.
  if v_order.status = 'settled' then
    return jsonb_build_object(
      'replayed', true,
      'sale_id', v_order.sale_id,
      'receipt_number', (
        select receipt_number from public.sales where id = v_order.sale_id
      )
    );
  end if;

  if v_order.status <> 'open' then
    raise exception 'that bill is %', v_order.status using errcode = 'restrict_violation';
  end if;

  -- One row per line, with every modifier's price folded into the unit price.
  select
      jsonb_agg(
        jsonb_build_object(
          'item_id', l.item_id,
          'variant_id', l.variant_id,
          'name', l.name_snapshot,
          'unit', l.unit,
          'quantity', l.quantity,
          'unit_price', l.unit_price + coalesce(m.delta, 0),
          'line_total', round((l.unit_price + coalesce(m.delta, 0)) * l.quantity, 2)
        )
        order by l.created_at
      ),
      sum(round((l.unit_price + coalesce(m.delta, 0)) * l.quantity, 2))
    into v_lines, v_subtotal
    from public.table_order_lines l
    left join lateral (
      select sum(lm.price_delta) as delta
        from public.table_order_line_modifiers lm
       where lm.line_id = l.id
    ) m on true
   where l.order_id = p_order
     and l.tenant_id = p_tenant
     and l.status <> 'void';

  if v_lines is null then
    raise exception 'there is nothing on that bill to charge for'
      using errcode = '22023';
  end if;

  v_result := public.record_sale(
    p_tenant, p_counter, p_sale_id, p_business_day, p_by,
    v_subtotal, v_subtotal, p_tenders, v_lines, v_order.customer_id,
    coalesce(p_discount, 0), coalesce(p_ceiling_pct, 0)
  );

  update public.table_orders
     set status = 'settled', sale_id = p_sale_id, settled_at = now()
   where id = p_order;

  return v_result || jsonb_build_object('replayed', false, 'sale_id', p_sale_id);
end;
$fn$;

revoke execute on function public.settle_table_order(uuid, uuid, uuid, uuid, date, jsonb, numeric, numeric, uuid)
  from public, anon, authenticated;
grant execute on function public.settle_table_order(uuid, uuid, uuid, uuid, date, jsonb, numeric, numeric, uuid)
  to service_role;

comment on function public.settle_table_order(uuid, uuid, uuid, uuid, date, jsonb, numeric, numeric, uuid) is
  'Turns an open table order into a sale through record_sale, in one transaction, and marks the order settled against it. Modifier prices are folded into the line, never printed as lines of their own.';
