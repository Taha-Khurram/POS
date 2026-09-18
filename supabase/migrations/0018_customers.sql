-- =============================================================================
-- 0018_customers — the shop's regulars, and the end of the khata
--
-- Apply manually after 0017_no_seeded_tree.sql.
--
-- Two things, and they are one decision.
--
-- **The customer becomes a row.** A kiryana knows two hundred people by face
-- and by phone number, and every screen that matters afterwards — who bought
-- what, who has not been in since Eid, which number to send the new rate list
-- to — needs somewhere to hang that on. `public.customers` is that, and
-- `sales.customer_id` is what attaches a bill to it.
--
-- **The khata goes.** It was specified as `customers` plus an `udhaar_ledger`
-- of debits and credits, with a per-customer limit enforced at the register and
-- ageing buckets behind it. It is not being built, so everything that was
-- pointing at it is removed rather than left standing: the two permission
-- columns on `role_permissions`, the `udhaar` tender on `sale_tenders`, and the
-- `udhaar_khata` feature flag on both plans. A column nothing writes and a
-- feature flag nothing reads are how a product ends up claiming something it
-- cannot do — the same reason 0016 dropped `items.subcategory` outright rather
-- than leaving it unread.
--
-- What replaces `can_sell_on_khata` is `can_manage_customers`, because the rail
-- still needs one switch per module and the module is still there. The old
-- value is carried across before the column is dropped: an owner who trusted a
-- cashier with the customer book keeps trusting them with the customer list.
--
-- Everything obeys 0001: `tenant_id not null`, RLS enabled and forced, select
-- only for tenant JWTs, every write through a Server Action on the service
-- role.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · The customers
--
-- `phone` is the identity and `name` is not. Two brothers called Bilal both
-- shop here; one phone number is one person, and it is what a shopkeeper
-- actually reaches for when the customer is standing at the counter. So the
-- unique index is on the phone and there is none on the name.
--
-- It is nullable all the same. The customer who wants a bill in their company's
-- name and will not give a number is a real customer, and refusing to record
-- them is how a shop goes back to the notebook.
-- -----------------------------------------------------------------------------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 80),
  -- Stored normalised — digits, with Pakistani numbers folded to their 03xx
  -- form by `normalisePhone` in `lib/pos/customer.ts`. That is what makes the
  -- unique index below mean anything: "0300 123 4567" and "+92 300 1234567" are
  -- one customer to everybody except a database storing them as typed.
  phone text check (phone is null or phone ~ '^\+?[0-9]{7,15}$'),
  email text check (email is null or length(btrim(email)) between 3 and 160),
  -- One field, not four. A shop writes "Shop 4, Anarkali, near the masjid" and
  -- no amount of address modelling improves on that.
  address text check (address is null or length(btrim(address)) <= 200),
  -- What the shopkeeper would otherwise write in the margin. "Takes the 5 kg
  -- bag every Friday", "brother of Imran at the pharmacy".
  notes text check (notes is null or length(btrim(notes)) <= 500),
  -- Off keeps their bills and takes them out of the till's picker — the same
  -- bargain `items.is_active` strikes. Someone who has moved away is not
  -- someone whose last two years of receipts should stop grouping.
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One number, one customer. Partial, because the shops that need this most are
-- the ones with sixty walk-ins recorded by name alone, and nulls must not
-- collide with each other.
--
-- Scoped to the tenant like every other unique index in the schema: two shops
-- on one street share a customer and always will.
create unique index if not exists customers_tenant_phone_idx
  on public.customers (tenant_id, phone)
  where phone is not null;

-- The list is read whole and sorted by name, and the till reads the active ones
-- the same way. One index over both.
create index if not exists customers_tenant_name_idx
  on public.customers (tenant_id, is_active, name);

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at before update on public.customers
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2 · The bill knows who it was for
--
-- `on delete set null` beside the existing not-null `receipt_number`, for the
-- reason `sale_lines.item_id` carries the same clause: deleting a customer must
-- never take a receipt with it. What is lost is the ability to total that
-- person's spending, which is exactly the trade the delete screen names.
--
-- No back-fill. Every sale recorded before this migration was rung up without
-- anybody being asked, and inventing a customer for it would be worse than the
-- null.
-- -----------------------------------------------------------------------------
alter table public.sales
  add column if not exists customer_id uuid
    references public.customers (id) on delete set null;

-- "What has this customer bought?" is the one query the profile screen runs,
-- and it runs it newest-first. Partial on not-null because the overwhelming
-- majority of rows in a kiryana are walk-ins and there is no reason to index
-- them: a shop that attaches a customer to one bill in twenty gets an index a
-- twentieth of the size.
create index if not exists sales_tenant_customer_idx
  on public.sales (tenant_id, customer_id, business_day desc)
  where customer_id is not null;

-- -----------------------------------------------------------------------------
-- 3 · `record_sale` carries the customer
--
-- Dropped and recreated rather than `create or replace`d: a new parameter makes
-- a new signature, and a default would leave the old nine-argument function
-- sitting beside the new one as an overload that silently records no customer.
--
-- The customer is checked inside the transaction rather than taken on trust,
-- the same way the counter always has been. The Server Action checks it too;
-- this is the one that cannot be skipped, because it is the one holding the
-- lock.
-- -----------------------------------------------------------------------------
drop function if exists public.record_sale(uuid, uuid, uuid, date, uuid, numeric, numeric, text, jsonb);

create or replace function public.record_sale(
  p_tenant uuid,
  p_counter uuid,
  p_sale_id uuid,
  p_business_day date,
  p_created_by uuid,
  p_subtotal numeric,
  p_total numeric,
  p_tender text,
  p_lines jsonb,
  -- Null is a walk-in, which is most bills in most shops.
  p_customer uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_branch uuid;
  v_prefix text;
  v_serial integer;
  v_receipt text;
  v_line jsonb;
begin
  -- Already recorded. The retry gets the same receipt rather than a second one.
  select receipt_number into v_receipt
  from public.sales
  where id = p_sale_id and tenant_id = p_tenant;

  if found then
    return jsonb_build_object('receipt_number', v_receipt, 'replayed', true);
  end if;

  if p_total < 0 or p_subtotal < 0 or jsonb_array_length(p_lines) = 0 then
    raise exception 'a sale needs at least one line and a total of zero or more'
      using errcode = '22023';
  end if;

  -- A customer id that is not this shop's is a crafted request, not a typo, so
  -- it fails the sale rather than being quietly dropped to null. A sale that
  -- silently loses the customer it was rung up against is a sale the shop
  -- cannot find again.
  if p_customer is not null and not exists (
    select 1 from public.customers c
    where c.id = p_customer and c.tenant_id = p_tenant
  ) then
    raise exception 'customer % is not on this shop''s list', p_customer
      using errcode = 'restrict_violation';
  end if;

  -- Claims the next number and proves the counter belongs to this tenant and is
  -- open, in one statement. The row is locked for the rest of the transaction,
  -- so two tablets on the same counter queue rather than collide.
  --
  -- Note the right-hand side of a SET reads the OLD row: `receipt_day` in the
  -- CASE is the day the last sale was rung, which is how the series restarts
  -- each morning without a separate reset job.
  update public.counters
     set receipt_serial = case when receipt_day = p_business_day then receipt_serial + 1 else 1 end,
         receipt_day = p_business_day
   where id = p_counter
     and tenant_id = p_tenant
     and is_active
  returning branch_id, receipt_prefix, receipt_serial
       into v_branch, v_prefix, v_serial;

  if not found then
    raise exception 'counter % is not an open counter for this shop', p_counter
      using errcode = 'restrict_violation';
  end if;

  if v_branch is null then
    raise exception 'counter % has no branch, so a sale has nowhere to land', p_counter
      using errcode = 'restrict_violation';
  end if;

  v_receipt := v_prefix || '-' || to_char(p_business_day, 'YYMMDD') || '-' || lpad(v_serial::text, 4, '0');

  insert into public.sales (
    id, tenant_id, branch_id, counter_id, customer_id, receipt_number,
    business_day, status, subtotal, discount_total, total, created_by
  )
  values (
    p_sale_id, p_tenant, v_branch, p_counter, p_customer, v_receipt,
    p_business_day, 'completed', p_subtotal, 0, p_total, p_created_by
  );

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    insert into public.sale_lines (
      tenant_id, sale_id, item_id, name_snapshot, unit,
      quantity, unit_price, discount, line_total
    )
    values (
      p_tenant,
      p_sale_id,
      -- `name_snapshot` is what the receipt was printed from, which is why 0008
      -- made it not-null and the item reference nullable: deleting an item
      -- leaves every past roll printing exactly as it was rung up.
      nullif(v_line->>'item_id', '')::uuid,
      v_line->>'name',
      v_line->>'unit',
      (v_line->>'quantity')::numeric,
      (v_line->>'unit_price')::numeric,
      0,
      (v_line->>'line_total')::numeric
    );
  end loop;

  insert into public.sale_tenders (tenant_id, sale_id, method, amount)
  values (p_tenant, p_sale_id, p_tender, p_total);

  return jsonb_build_object('receipt_number', v_receipt, 'replayed', false);
end;
$fn$;

revoke execute on function public.record_sale(uuid, uuid, uuid, date, uuid, numeric, numeric, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.record_sale(uuid, uuid, uuid, date, uuid, numeric, numeric, text, jsonb, uuid)
  to service_role;

comment on function public.record_sale(uuid, uuid, uuid, date, uuid, numeric, numeric, text, jsonb, uuid) is
  'Records one register sale and claims its counter receipt number atomically. Replays safely on a repeated sale id.';

-- -----------------------------------------------------------------------------
-- 4 · The khata goes
--
-- 4a · The permission. Added, carried across, then the two khata columns are
-- dropped — in that order, inside one migration, so no shop spends a moment
-- with neither switch.
-- -----------------------------------------------------------------------------
alter table public.role_permissions
  add column if not exists can_manage_customers boolean not null default false;

-- The owner's own answer, kept. Somebody trusted with the customer book is
-- trusted with the customer list; anyone who was not stays switched off.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'role_permissions'
      and column_name = 'can_sell_on_khata'
  ) then
    execute 'update public.role_permissions set can_manage_customers = can_sell_on_khata';
  end if;
end;
$$;

alter table public.role_permissions
  drop column if exists can_sell_on_khata,
  drop column if exists khata_ceiling;

comment on column public.role_permissions.can_manage_customers is
  'Reaches the Customers module and may add, edit and delete its rows.';

-- -----------------------------------------------------------------------------
-- 4b · The tender. `udhaar` was one of six methods 0008 allowed on
-- `sale_tenders`, and it was the only one meaning "not paid". The register
-- never offered it, so nothing has been written under it — but a tender that
-- settles nothing, left legal in the column, is the day somebody adds the
-- button back without the ledger under it.
--
-- Dropped and re-added rather than altered, the same way 0011 replaced the unit
-- check: Postgres has no `alter constraint`.
-- -----------------------------------------------------------------------------
alter table public.sale_tenders drop constraint if exists sale_tenders_method_check;
alter table public.sale_tenders add constraint sale_tenders_method_check
  check (method in ('cash', 'card', 'raast', 'easypaisa', 'jazzcash'));

-- -----------------------------------------------------------------------------
-- 4c · The feature flag. `plans.features` is the single authority entitlements
-- are resolved from, so a key that is true there is a promise. `-` removes a
-- key from a jsonb object; `customer_directory` takes its place, because what
-- both plans do now include is the list.
-- -----------------------------------------------------------------------------
update public.plans
   set features = (features - 'udhaar_khata')
                  || jsonb_build_object('customer_directory', true)
 where features ? 'udhaar_khata'
    or not (features ? 'customer_directory');

-- A one-off deal cut for a single client can carry its own overrides, and one
-- of them could be the flag that just stopped existing.
update public.subscriptions
   set feature_overrides = feature_overrides - 'udhaar_khata'
 where feature_overrides ? 'udhaar_khata';

-- -----------------------------------------------------------------------------
-- 5 · Privileges and RLS
--
-- Same shape as everything since 0001: readable through the shop's own JWT,
-- writable only by the service role inside a Server Action, invisible to anon.
-- The read may carry `is_platform_admin`; there is no write policy to carry it,
-- because support impersonation is read-only.
-- -----------------------------------------------------------------------------
revoke insert, update, delete, truncate on public.customers from anon, authenticated;
revoke select on public.customers from anon;
grant select on public.customers to authenticated;

alter table public.customers enable row level security;
alter table public.customers force row level security;

drop policy if exists customers_read_own on public.customers;
create policy customers_read_own on public.customers for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_platform_admin()));

comment on table public.customers is
  'The shop''s regulars. Identified by phone, read through the tenant JWT, written by Server Actions on the service role.';
comment on column public.customers.phone is
  'Normalised by lib/pos/customer.ts before it is written — that is what makes customers_tenant_phone_idx mean one person.';
comment on column public.sales.customer_id is
  'Who the bill was for. Null is a walk-in; set null on delete, so a receipt outlives the customer record.';
