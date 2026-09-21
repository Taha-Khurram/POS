-- =============================================================================
-- 0031_variants — one item, many rows on the shelf
--
-- Apply manually after 0030_batches.sql.
--
-- `items.tracking = 'variant'` has existed since 0008 and `items.variant_count`
-- since 0015, and neither has ever meant anything: the product sheet drew the
-- SKUs a matrix *would* generate and said so in as many words, because
-- `item_variants` did not exist. A cloth house cannot use a till that thinks
-- "Lawn suit" is one thing with one stock figure when the shelf holds small
-- blue, small green, medium blue and four others — and neither can a shoe shop,
-- which is the same problem with a wider grid.
--
-- **This is the batch problem again, one shape over**, and it is solved the same
-- way on purpose. An item's stock lives in rows under it; `private.move_stock`
-- writes the row and `items.stock` together and remains the only writer of
-- either; `items.stock` stays the running total every existing reader, report
-- and stock gate already asks. What differs is who chooses: a batch is picked
-- by the till (soonest date first) and a variant is picked by the customer.
--
-- **An item is variant-tracked or batch-tracked, never both.** A check
-- constraint enforces it. Batches-per-variant is a third level, and the shops
-- that need one do not need the other — a pharmacy has no colours and a cloth
-- house has no expiry. Allowing it would double the width of every stock screen
-- for a case nobody has.
--
-- **A variant's barcode may not collide with an item's.** They live in two
-- tables, so no single unique index can say it; a trigger on both says it
-- instead. Scanning a code that could be two things is the one failure a till
-- cannot recover from, and it is worth a trigger — these tables are written a
-- few times a day, not a few times a second.
--
-- Everything obeys 0001: `tenant_id not null`, RLS enabled and forced, select
-- only for tenant JWTs, every write through a security-definer function.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · The variants
--
-- `option_a` and `option_b`, not a jsonb bag of arbitrary axes. Two is what a
-- grid can draw and what a shopkeeper can pick from on a 10-inch screen: size
-- and colour for a cloth house, size and width for shoes, flavour and weight
-- for a bakery. A third axis is a matrix nobody can tap through, and the
-- open-ended version would put the till's picker at the mercy of whatever
-- somebody typed.
--
-- The axis *names* live on the item (`variant_axes`) and the values live here,
-- which is what stops one item's rows disagreeing about what its columns mean.
--
-- `selling_price` and `cost_price` are nullable and null means "the item's".
-- Most of a cloth house's sizes are one price and the XXL is not, so the
-- exception is a column and the rule is an absence — the opposite way round
-- would make every variant carry a copy of a number that has one home.
-- -----------------------------------------------------------------------------
alter table public.items
  add column if not exists variant_axes text[] not null default '{}';

comment on column public.items.variant_axes is
  'What this item''s two variant columns are called — {Size, Colour}. On the item so its rows cannot disagree about what they mean. Empty for everything that is not variant-tracked.';

-- An item is one or the other. See the header: batches-per-variant is a third
-- level for a shop that does not exist.
alter table public.items drop constraint if exists items_one_stock_split;
alter table public.items add constraint items_one_stock_split
  check (not (tracks_batches and tracking = 'variant'));

create table if not exists public.item_variants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- Cascade, like `item_batches.item_id`: a variant is a way of splitting one
  -- item's stock and has nothing left to say once the item is gone. The sale
  -- lines keep their own `name_snapshot` and print exactly as they were rung up.
  item_id uuid not null references public.items (id) on delete cascade,
  -- The two values, in the order `items.variant_axes` names them. `option_b` is
  -- nullable because plenty of items vary on one axis only — a bakery's cake
  -- has sizes and no colours.
  option_a text not null check (length(btrim(option_a)) between 1 and 40),
  option_b text check (option_b is null or length(btrim(option_b)) between 1 and 40),
  sku text check (sku is null or length(btrim(sku)) <= 40),
  barcode text check (barcode is null or length(btrim(barcode)) <= 32),
  -- Null means the item's own. The exception is the column; the rule is the
  -- absence.
  selling_price numeric(12, 2) check (selling_price is null or selling_price >= 0),
  cost_price numeric(12, 2) check (cost_price is null or cost_price >= 0),
  quantity numeric(12, 3) not null default 0,
  -- Off takes the row out of the till's grid and keeps its sales — the same
  -- bargain `items.is_active` strikes. A colour that stopped selling is not a
  -- colour whose last two years should stop grouping.
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per combination. Case-folded, because "Blue" and "blue" are one
-- colour on one shelf and two rows would be two stock figures for it.
create unique index if not exists item_variants_identity_idx
  on public.item_variants (
    tenant_id, item_id, lower(btrim(option_a)), lower(btrim(coalesce(option_b, '')))
  );

-- The two codes a till scans. Partial on not-null, like `items`' own, so the
-- overwhelming number of variants without a code do not collide with each
-- other.
create unique index if not exists item_variants_tenant_barcode_idx
  on public.item_variants (tenant_id, barcode)
  where barcode is not null;

create unique index if not exists item_variants_tenant_sku_idx
  on public.item_variants (tenant_id, sku)
  where sku is not null;

-- The grid, in the order the shop arranged it.
create index if not exists item_variants_item_idx
  on public.item_variants (tenant_id, item_id, sort_order, option_a);

drop trigger if exists item_variants_set_updated_at on public.item_variants;
create trigger item_variants_set_updated_at before update on public.item_variants
  for each row execute function private.set_updated_at();

comment on table public.item_variants is
  'One row per size/colour of a variant-tracked item, each with its own stock, code and optionally its own price. A sub-ledger under items.stock — private.move_stock writes both together.';

-- -----------------------------------------------------------------------------
-- 2 · A code means one thing
--
-- No unique index can span two tables, and a barcode that could be an item or a
-- variant is the one failure a till cannot recover from — it rings up the wrong
-- thing and nobody notices until the shelf count is wrong.
--
-- So a trigger on each table refuses a code the other already holds. It is a
-- read per write on tables written a handful of times a day, which is nothing,
-- and it closes the gap a pair of per-table indexes leaves open.
--
-- The honest caveat: two transactions inserting the same code at the same
-- instant can both pass this, because neither can see the other's uncommitted
-- row. That window is unreachable through the product — every write here is a
-- Server Action on one service-role connection — and it is the same window any
-- cross-table check has without a shared table to lock.
-- -----------------------------------------------------------------------------
create or replace function private.one_barcode_per_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.barcode is null then
    return new;
  end if;

  if tg_table_name = 'items' then
    if exists (
      select 1 from public.item_variants v
       where v.tenant_id = new.tenant_id and v.barcode = new.barcode
    ) then
      raise exception 'barcode % is already on a variant of another item', new.barcode
        using errcode = '23505', constraint = 'items_tenant_barcode_idx';
    end if;
  else
    if exists (
      select 1 from public.items i
       where i.tenant_id = new.tenant_id and i.barcode = new.barcode
    ) then
      raise exception 'barcode % is already on an item', new.barcode
        using errcode = '23505', constraint = 'item_variants_tenant_barcode_idx';
    end if;
  end if;

  return new;
end;
$fn$;

revoke execute on function private.one_barcode_per_code() from public, anon, authenticated;

drop trigger if exists items_barcode_is_unique on public.items;
create trigger items_barcode_is_unique
  before insert or update of barcode on public.items
  for each row execute function private.one_barcode_per_code();

drop trigger if exists item_variants_barcode_is_unique on public.item_variants;
create trigger item_variants_barcode_is_unique
  before insert or update of barcode on public.item_variants
  for each row execute function private.one_barcode_per_code();

-- -----------------------------------------------------------------------------
-- 3 · The ledger names the variant
-- -----------------------------------------------------------------------------
alter table public.stock_movements
  add column if not exists variant_id uuid
    references public.item_variants (id) on delete set null;

create index if not exists stock_movements_variant_idx
  on public.stock_movements (variant_id)
  where variant_id is not null;

-- The sale line names it too, so a receipt reprint and every report can say
-- *which* one was sold. `on delete set null` beside the existing not-null
-- `name_snapshot`, for the reason `item_id` carries it: deleting a colour must
-- not take a receipt with it.
alter table public.sale_lines
  add column if not exists variant_id uuid
    references public.item_variants (id) on delete set null;

create index if not exists sale_lines_variant_idx
  on public.sale_lines (variant_id)
  where variant_id is not null;

-- -----------------------------------------------------------------------------
-- 4 · The one way stock moves, widened a last time
--
-- Dropped and recreated, like 0028 and 0030 before it, because a new parameter
-- is a new signature and a default would leave the nine-argument version
-- standing beside it as an overload that silently moves no variant. Existing
-- callers pass eight or nine arguments and resolve here on the defaults.
--
-- A variant and a batch are mutually exclusive by the check in section 1, so
-- nothing has to decide what a movement carrying both would mean.
-- -----------------------------------------------------------------------------
drop function if exists private.move_stock(uuid, uuid, numeric, text, uuid, text, uuid, uuid, uuid);

create or replace function private.move_stock(
  p_tenant uuid,
  p_item uuid,
  p_delta numeric,
  p_reason text,
  p_sale uuid,
  p_note text,
  p_by uuid,
  p_receipt uuid default null,
  p_batch uuid default null,
  p_variant uuid default null
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_after numeric;
begin
  if p_item is null or p_delta is null or p_delta = 0 then
    return null;
  end if;

  update public.items
     set stock = stock + p_delta
   where id = p_item
     and tenant_id = p_tenant
  returning stock into v_after;

  if not found then
    return null;
  end if;

  if p_batch is not null then
    update public.item_batches
       set quantity = quantity + p_delta
     where id = p_batch
       and tenant_id = p_tenant
       and item_id = p_item;

    if not found then
      raise exception 'batch % is not a batch of item %', p_batch, p_item
        using errcode = 'restrict_violation';
    end if;
  end if;

  if p_variant is not null then
    update public.item_variants
       set quantity = quantity + p_delta
     where id = p_variant
       and tenant_id = p_tenant
       and item_id = p_item;

    if not found then
      raise exception 'variant % is not a variant of item %', p_variant, p_item
        using errcode = 'restrict_violation';
    end if;
  end if;

  insert into public.stock_movements (
    tenant_id, item_id, reason, quantity, stock_after, sale_id,
    goods_receipt_id, batch_id, variant_id, note, created_by
  )
  values (
    p_tenant, p_item, p_reason, p_delta, v_after, p_sale,
    p_receipt, p_batch, p_variant, nullif(btrim(coalesce(p_note, '')), ''), p_by
  );

  return v_after;
end;
$fn$;

revoke execute on function private.move_stock(uuid, uuid, numeric, text, uuid, text, uuid, uuid, uuid, uuid)
  from public, anon, authenticated;

comment on function private.move_stock(uuid, uuid, numeric, text, uuid, text, uuid, uuid, uuid, uuid) is
  'The only writer of items.stock, item_batches.quantity and item_variants.quantity. Moves the item total and whichever sub-ledger row together, so they cannot drift.';

-- -----------------------------------------------------------------------------
-- 5 · Counting one variant
--
-- The same absolute-to-relative adapter `set_stock` is for an item and
-- `adjust_batch` is for a batch, and for the identical reason: the screen says
-- "there are nine mediums" and the safe write is a delta worked out under a row
-- lock. Reading, subtracting and writing in a Server Action reads the count
-- before counter 2 sells two and writes a number that un-sells them.
-- -----------------------------------------------------------------------------
create or replace function public.adjust_variant(
  p_tenant uuid,
  p_variant uuid,
  p_to numeric,
  p_reason text,
  p_note text,
  p_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_item uuid;
  v_before numeric;
  v_after numeric;
begin
  if p_reason not in ('count', 'correction') then
    raise exception 'a counted variant figure is not a %', p_reason
      using errcode = '22023';
  end if;

  if p_to is null or p_to < 0 then
    raise exception 'a variant cannot be counted to %', p_to
      using errcode = '22023';
  end if;

  select v.item_id, v.quantity into v_item, v_before
    from public.item_variants v
   where v.id = p_variant and v.tenant_id = p_tenant
     for update;

  if not found then
    raise exception 'variant % is not this shop''s', p_variant
      using errcode = 'restrict_violation';
  end if;

  if p_to = v_before then
    return jsonb_build_object('moved', false, 'before', v_before, 'after', v_before);
  end if;

  v_after := private.move_stock(
    p_tenant, v_item, p_to - v_before, p_reason, null, p_note, p_by, null, null, p_variant
  );

  return jsonb_build_object(
    'moved', true, 'before', v_before, 'after', p_to, 'item_stock', v_after
  );
end;
$fn$;

revoke execute on function public.adjust_variant(uuid, uuid, numeric, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.adjust_variant(uuid, uuid, numeric, text, text, uuid)
  to service_role;

-- -----------------------------------------------------------------------------
-- 6 · Writing the grid
--
-- The whole set at once, not one row at a time. A shop setting up a cloth line
-- picks two axes and their values and gets twelve rows; picking them one at a
-- time would be twelve saves and eleven chances to stop halfway.
--
-- **Rows are never deleted by this.** A combination dropped from the grid is
-- switched off instead, because it may be on last month's receipts and may
-- still have stock — and stock that vanished with a row is stock `items.stock`
-- still counts, which is the one way the two can be made to disagree. What the
-- screen offers is switching a row off, and what that does is take it out of
-- the till's grid.
-- -----------------------------------------------------------------------------
create or replace function public.save_variants(
  p_tenant uuid,
  p_item uuid,
  p_axes text[],
  p_rows jsonb,
  p_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row jsonb;
  v_index integer := 0;
  v_seen uuid[] := '{}';
  v_id uuid;
  v_added integer := 0;
  v_off integer := 0;
begin
  if not exists (
    select 1 from public.items i
     where i.id = p_item and i.tenant_id = p_tenant and i.tracking = 'variant'
  ) then
    raise exception 'item % is not sold by variant', p_item
      using errcode = 'restrict_violation';
  end if;

  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    raise exception 'a variant item needs at least one row'
      using errcode = '22023';
  end if;

  if array_length(p_axes, 1) is null or array_length(p_axes, 1) > 2 then
    raise exception 'a variant item has one or two columns, not %',
      coalesce(array_length(p_axes, 1), 0)
      using errcode = '22023';
  end if;

  update public.items
     set variant_axes = p_axes,
         variant_count = jsonb_array_length(p_rows)
   where id = p_item and tenant_id = p_tenant;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_index := v_index + 1;

    insert into public.item_variants (
      tenant_id, item_id, option_a, option_b, sku, barcode,
      selling_price, cost_price, sort_order, is_active
    )
    values (
      p_tenant,
      p_item,
      v_row->>'option_a',
      nullif(btrim(coalesce(v_row->>'option_b', '')), ''),
      nullif(btrim(coalesce(v_row->>'sku', '')), ''),
      nullif(btrim(coalesce(v_row->>'barcode', '')), ''),
      nullif(v_row->>'selling_price', '')::numeric,
      nullif(v_row->>'cost_price', '')::numeric,
      v_index,
      true
    )
    on conflict (
      tenant_id, item_id, lower(btrim(option_a)), lower(btrim(coalesce(option_b, '')))
    )
    do update set
      sku = excluded.sku,
      barcode = excluded.barcode,
      selling_price = excluded.selling_price,
      cost_price = excluded.cost_price,
      sort_order = excluded.sort_order,
      -- A combination that comes back after being switched off is switched
      -- back on, with whatever stock it still had. That is what somebody means
      -- by re-adding it.
      is_active = true
    returning id into v_id;

    if v_id is not null then
      v_seen := v_seen || v_id;
      v_added := v_added + 1;
    end if;
  end loop;

  -- Everything the grid no longer names. Switched off, never deleted — see the
  -- header.
  update public.item_variants
     set is_active = false
   where tenant_id = p_tenant
     and item_id = p_item
     and is_active
     and not (id = any (v_seen));

  get diagnostics v_off = row_count;

  return jsonb_build_object('rows', v_added, 'switched_off', v_off);
end;
$fn$;

revoke execute on function public.save_variants(uuid, uuid, text[], jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.save_variants(uuid, uuid, text[], jsonb, uuid)
  to service_role;

comment on function public.save_variants(uuid, uuid, text[], jsonb, uuid) is
  'Writes an item''s whole variant grid at once. Upserts by combination, switches off what the grid no longer names, and never deletes a row that may be on a receipt.';

-- -----------------------------------------------------------------------------
-- 7 · A whole-item stocktake stops making sense here too
--
-- Same refusal `0030` added for a batch-tracked item, same reason: "there are
-- nine" cannot say nine of which colour, and spreading the difference across
-- the grid would invent stock in whichever row the guess picked.
-- -----------------------------------------------------------------------------
create or replace function public.set_stock(
  p_tenant uuid,
  p_item uuid,
  p_to numeric,
  p_reason text,
  p_note text,
  p_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_before numeric;
  v_tracked boolean;
  v_tracking text;
begin
  if p_reason not in ('count', 'correction', 'opening', 'import') then
    raise exception 'a counted stock figure is not a %', p_reason
      using errcode = '22023';
  end if;

  select stock, tracks_batches, tracking into v_before, v_tracked, v_tracking
    from public.items
   where id = p_item
     and tenant_id = p_tenant
     for update;

  if not found then
    raise exception 'item % is not on this shop''s list', p_item
      using errcode = 'restrict_violation';
  end if;

  if v_tracked then
    raise exception
      'this item is counted by batch, so count each batch on its own — one figure cannot say which of them expires when'
      using errcode = 'restrict_violation';
  end if;

  -- Only once the grid exists. An item switched to `variant` that nobody has
  -- built rows for yet is still one pile of stock, and refusing its count would
  -- strand whatever was already on the shelf.
  if v_tracking = 'variant' and exists (
    select 1 from public.item_variants v
     where v.item_id = p_item and v.tenant_id = p_tenant and v.is_active
  ) then
    raise exception
      'this item is sold by variant, so count each one on its own — one figure cannot say which size or colour it is'
      using errcode = 'restrict_violation';
  end if;

  if p_to = v_before then
    return jsonb_build_object('moved', false, 'before', v_before, 'after', v_before);
  end if;

  return jsonb_build_object(
    'moved', true,
    'before', v_before,
    'after', coalesce(
      private.move_stock(p_tenant, p_item, p_to - v_before, p_reason, null, p_note, p_by),
      p_to
    )
  );
end;
$fn$;

revoke execute on function public.set_stock(uuid, uuid, numeric, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.set_stock(uuid, uuid, numeric, text, text, uuid)
  to service_role;

-- -----------------------------------------------------------------------------
-- 8 · Who may read it
-- -----------------------------------------------------------------------------
revoke insert, update, delete, truncate on public.item_variants from anon, authenticated;

alter table public.item_variants enable row level security;
alter table public.item_variants force row level security;

drop policy if exists item_variants_read_own on public.item_variants;
create policy item_variants_read_own on public.item_variants for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_platform_admin()));

-- -----------------------------------------------------------------------------
-- 9 · The three write paths learn about variants
--
-- `record_sale`, `record_return` and `record_receipt` are replaced in full —
-- same signatures, so nothing calling them changes. Each body is its 0030
-- version with one branch added, and the branch is always the same shape: a
-- line naming a variant moves that variant's row, and everything else behaves
-- exactly as it did.
--
-- **The order of the branch matters.** A variant is checked *before* batches in
-- `record_sale`. The check constraint in section 1 makes the two mutually
-- exclusive, so the order can only ever matter if that constraint is one day
-- relaxed — and if it is, whoever relaxes it has to come here and decide,
-- rather than discover that one of them silently won.
--
-- **A variant's cost is its own where it has one.** `cost_snapshot` is stamped
-- from `item_variants.cost_price` falling back to the item's, for the reason
-- the column exists at all: two colours of one shirt can have cost the shop
-- different money, and a margin worked out from the wrong one is a margin
-- nobody can find the error in.
--
-- **A return goes back into the very row it left.** A variant is the one case
-- with no ambiguity about where returned stock belongs — the customer is
-- handing back a medium blue and the sale line says so. No walk, no assumption,
-- no conservative rule needed.
--
-- **A delivery reprices only what it named**, so twelve medium blues arriving
-- dearer never reprices the smalls.
-- -----------------------------------------------------------------------------

create or replace function public.record_sale(
  p_tenant uuid, p_counter uuid, p_sale_id uuid, p_business_day date,
  p_created_by uuid, p_subtotal numeric, p_total numeric, p_tender text,
  p_lines jsonb, p_customer uuid, p_discount numeric default 0,
  p_ceiling_pct numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_branch uuid; v_prefix text; v_serial integer; v_receipt text; v_line jsonb;
  v_item uuid; v_variant uuid; v_quantity numeric; v_gross numeric;
  v_discount numeric; v_left numeric; v_share numeric; v_index integer := 0;
  v_count integer; v_shift uuid; v_tracked boolean; v_tracking text; v_cost numeric;
begin
  select receipt_number into v_receipt from public.sales
   where id = p_sale_id and tenant_id = p_tenant;
  if found then
    return jsonb_build_object('receipt_number', v_receipt, 'replayed', true);
  end if;

  v_count := jsonb_array_length(p_lines);

  if p_total < 0 or p_subtotal < 0 or v_count = 0 then
    raise exception 'a sale needs at least one line and a total of zero or more'
      using errcode = '22023';
  end if;

  select coalesce(sum((value->>'line_total')::numeric), 0) into v_gross
    from jsonb_array_elements(p_lines);

  v_discount := round(coalesce(p_discount, 0), 2);

  if v_discount < 0 then
    raise exception 'a discount cannot be negative' using errcode = '22023';
  end if;

  if v_discount > v_gross then
    raise exception 'a discount of % is more than the bill of %', v_discount, v_gross
      using errcode = '22023';
  end if;

  if v_discount > 0 and v_discount > ceil(v_gross * coalesce(p_ceiling_pct, 0)) / 100 then
    raise exception 'a discount of % is over this cashier''s ceiling of %%%',
      v_discount, p_ceiling_pct using errcode = 'restrict_violation';
  end if;

  if p_customer is not null and not exists (
    select 1 from public.customers c where c.id = p_customer and c.tenant_id = p_tenant
  ) then
    raise exception 'customer % is not on this shop''s list', p_customer
      using errcode = 'restrict_violation';
  end if;

  update public.counters
     set receipt_serial = case when receipt_day = p_business_day then receipt_serial + 1 else 1 end,
         receipt_day = p_business_day
   where id = p_counter and tenant_id = p_tenant and is_active
  returning branch_id, receipt_prefix, receipt_serial into v_branch, v_prefix, v_serial;

  if not found then
    raise exception 'counter % is not an open counter for this shop', p_counter
      using errcode = 'restrict_violation';
  end if;

  if v_branch is null then
    raise exception 'counter % has no branch, so a sale has nowhere to land', p_counter
      using errcode = 'restrict_violation';
  end if;

  select id into v_shift from public.shifts
   where tenant_id = p_tenant and counter_id = p_counter and status = 'open';

  v_receipt := v_prefix || '-' || to_char(p_business_day, 'YYMMDD') || '-' || lpad(v_serial::text, 4, '0');

  insert into public.sales (
    id, tenant_id, branch_id, counter_id, customer_id, receipt_number,
    business_day, status, subtotal, discount_total, total, created_by, shift_id
  )
  values (
    p_sale_id, p_tenant, v_branch, p_counter, p_customer, v_receipt,
    p_business_day, 'completed', v_gross, v_discount, v_gross - v_discount,
    p_created_by, v_shift
  );

  v_left := v_discount;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_index := v_index + 1;
    v_item := nullif(v_line->>'item_id', '')::uuid;
    v_variant := nullif(v_line->>'variant_id', '')::uuid;
    v_quantity := (v_line->>'quantity')::numeric;

    if v_discount = 0 or v_gross = 0 then
      v_share := 0;
    elsif v_index = v_count then
      v_share := v_left;
    else
      v_share := round(v_discount * (v_line->>'line_total')::numeric / v_gross, 2);
    end if;

    v_share := greatest(least(v_share, (v_line->>'line_total')::numeric, v_left), 0);
    v_left := v_left - v_share;

    v_tracked := false;
    v_tracking := 'unit';
    v_cost := 0;

    if v_item is not null then
      select i.tracks_batches, i.tracking, i.cost_price
        into v_tracked, v_tracking, v_cost
        from public.items i where i.id = v_item and i.tenant_id = p_tenant;
    end if;

    -- A variant's own cost where it has one. Two colours of the same shirt can
    -- have cost the shop different money, and the margin on the receipt has to
    -- be the one that was really paid — the same reason cost_snapshot exists.
    if v_variant is not null then
      select coalesce(v.cost_price, v_cost) into v_cost
        from public.item_variants v
       where v.id = v_variant and v.tenant_id = p_tenant and v.item_id = v_item;

      if not found then
        raise exception 'that size or colour is not one of this item''s'
          using errcode = 'restrict_violation';
      end if;
    end if;

    insert into public.sale_lines (
      tenant_id, sale_id, item_id, variant_id, name_snapshot, unit,
      quantity, unit_price, discount, line_total, cost_snapshot
    )
    values (
      p_tenant, p_sale_id, v_item, v_variant, v_line->>'name', v_line->>'unit',
      v_quantity, (v_line->>'unit_price')::numeric, v_share,
      (v_line->>'line_total')::numeric - v_share, coalesce(v_cost, 0)
    );

    if v_variant is not null then
      perform private.move_stock(
        p_tenant, v_item, -v_quantity, 'sale', p_sale_id, null, p_created_by,
        null, null, v_variant
      );
    elsif coalesce(v_tracked, false) then
      perform private.take_from_batches(
        p_tenant, v_item, v_quantity, p_sale_id, p_created_by, p_business_day
      );
    else
      perform private.move_stock(
        p_tenant, v_item, -v_quantity, 'sale', p_sale_id, null, p_created_by
      );
    end if;
  end loop;

  if v_left <> 0 then
    v_discount := v_discount - v_left;
    update public.sales set discount_total = v_discount, total = v_gross - v_discount
     where id = p_sale_id;
  end if;

  insert into public.sale_tenders (tenant_id, sale_id, method, amount)
  values (p_tenant, p_sale_id, p_tender, v_gross - v_discount);

  return jsonb_build_object(
    'receipt_number', v_receipt, 'replayed', false, 'discount', v_discount,
    'total', v_gross - v_discount, 'shift_id', v_shift
  );
end;
$fn$;

revoke execute on function public.record_sale(uuid, uuid, uuid, date, uuid, numeric, numeric, text, jsonb, uuid, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.record_sale(uuid, uuid, uuid, date, uuid, numeric, numeric, text, jsonb, uuid, numeric, numeric)
  to service_role;

create or replace function public.record_return(
  p_tenant uuid, p_counter uuid, p_return_id uuid, p_business_day date,
  p_created_by uuid, p_sale_id uuid, p_lines jsonb, p_tender text,
  p_restock boolean, p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_branch uuid; v_prefix text; v_serial integer; v_receipt text; v_line jsonb;
  v_original public.sale_lines%rowtype; v_want numeric; v_done numeric;
  v_unit_net numeric; v_unit_discount numeric; v_amount numeric;
  v_discount numeric; v_gross numeric := 0; v_off numeric := 0; v_net numeric := 0;
  v_sale public.sales%rowtype; v_shift uuid; v_tracked boolean;
begin
  select receipt_number into v_receipt from public.sales
   where id = p_return_id and tenant_id = p_tenant;
  if found then
    return jsonb_build_object('receipt_number', v_receipt, 'replayed', true);
  end if;

  if jsonb_array_length(p_lines) = 0 then
    raise exception 'a return needs at least one line' using errcode = '22023';
  end if;

  select * into v_sale from public.sales
   where id = p_sale_id and tenant_id = p_tenant for update;

  if not found then
    raise exception 'bill % is not this shop''s', p_sale_id
      using errcode = 'restrict_violation';
  end if;

  if v_sale.status <> 'completed' then
    raise exception 'bill % is not a completed sale, so there is nothing to give back', p_sale_id
      using errcode = 'restrict_violation';
  end if;

  update public.counters
     set receipt_serial = case when receipt_day = p_business_day then receipt_serial + 1 else 1 end,
         receipt_day = p_business_day
   where id = p_counter and tenant_id = p_tenant and is_active
  returning branch_id, receipt_prefix, receipt_serial into v_branch, v_prefix, v_serial;

  if not found then
    raise exception 'counter % is not an open counter for this shop', p_counter
      using errcode = 'restrict_violation';
  end if;

  select id into v_shift from public.shifts
   where tenant_id = p_tenant and counter_id = p_counter and status = 'open';

  v_receipt := v_prefix || '-' || to_char(p_business_day, 'YYMMDD') || '-' || lpad(v_serial::text, 4, '0');

  insert into public.sales (
    id, tenant_id, branch_id, counter_id, customer_id, receipt_number,
    business_day, status, subtotal, discount_total, total, created_by,
    refunds_sale_id, note, shift_id
  )
  values (
    p_return_id, p_tenant, v_branch, p_counter, v_sale.customer_id, v_receipt,
    p_business_day, 'refund', 0, 0, 0, p_created_by,
    p_sale_id, nullif(btrim(coalesce(p_note, '')), ''), v_shift
  );

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    select * into v_original from public.sale_lines
     where id = (v_line->>'line_id')::uuid and sale_id = p_sale_id
       and tenant_id = p_tenant for update;

    if not found then
      raise exception 'that line is not on bill %', p_sale_id
        using errcode = 'restrict_violation';
    end if;

    v_want := (v_line->>'quantity')::numeric;

    if v_want is null or v_want <= 0 then
      raise exception 'a return of % is not a quantity', v_want using errcode = '22023';
    end if;

    select coalesce(-sum(l.quantity), 0) into v_done from public.sale_lines l
     where l.refunds_line_id = v_original.id and l.tenant_id = p_tenant;

    if v_want > v_original.quantity - v_done then
      raise exception 'only % of % are still returnable on that line',
        v_original.quantity - v_done, v_original.quantity
        using errcode = 'restrict_violation';
    end if;

    v_unit_net := v_original.line_total / v_original.quantity;
    v_unit_discount := v_original.discount / v_original.quantity;
    v_amount := round(v_unit_net * v_want, 2);
    v_discount := round(v_unit_discount * v_want, 2);

    insert into public.sale_lines (
      tenant_id, sale_id, item_id, variant_id, name_snapshot, unit, quantity,
      unit_price, discount, line_total, cost_snapshot, refunds_line_id
    )
    values (
      p_tenant, p_return_id, v_original.item_id, v_original.variant_id,
      v_original.name_snapshot, v_original.unit, -v_want, v_original.unit_price,
      -v_discount, -v_amount, v_original.cost_snapshot, v_original.id
    );

    v_gross := v_gross + round(v_original.unit_price * v_want, 2);
    v_off := v_off + v_discount;
    v_net := v_net + v_amount;

    if p_restock and v_original.item_id is not null then
      -- Back into the very row it left. A variant is the one case where there
      -- is no ambiguity at all about where returned stock belongs: the customer
      -- is handing back a medium blue, and the line says so.
      if v_original.variant_id is not null then
        perform private.move_stock(
          p_tenant, v_original.item_id, v_want, 'return', p_return_id, null,
          p_created_by, null, null, v_original.variant_id
        );
      else
        select i.tracks_batches into v_tracked from public.items i
         where i.id = v_original.item_id and i.tenant_id = p_tenant;

        if coalesce(v_tracked, false) then
          perform private.return_to_batches(
            p_tenant, v_original.item_id, v_want, p_sale_id, p_return_id, p_created_by
          );
        else
          perform private.move_stock(
            p_tenant, v_original.item_id, v_want, 'return', p_return_id, null, p_created_by
          );
        end if;
      end if;
    end if;
  end loop;

  update public.sales set subtotal = -v_gross, discount_total = -v_off, total = -v_net
   where id = p_return_id;

  insert into public.sale_tenders (tenant_id, sale_id, method, amount)
  values (p_tenant, p_return_id, p_tender, -v_net);

  return jsonb_build_object('receipt_number', v_receipt, 'replayed', false, 'total', v_net);
end;
$fn$;

revoke execute on function public.record_return(uuid, uuid, uuid, date, uuid, uuid, jsonb, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.record_return(uuid, uuid, uuid, date, uuid, uuid, jsonb, text, boolean, text)
  to service_role;

create or replace function public.record_receipt(
  p_tenant uuid, p_grn_id uuid, p_supplier uuid, p_order uuid, p_received_on date,
  p_invoice_no text, p_note text, p_freight numeric, p_other numeric,
  p_lines jsonb, p_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_branch uuid; v_number text; v_line jsonb; v_lines jsonb[]; v_count integer;
  v_index integer; v_subtotal numeric := 0; v_quantity_total numeric := 0;
  v_extra numeric; v_spread numeric := 0; v_share numeric; v_item uuid;
  v_quantity numeric; v_line_total numeric; v_landed_line numeric;
  v_landed_unit numeric; v_tracked boolean; v_batch uuid; v_variant uuid;
begin
  select gr.grn_number into v_number from public.goods_receipts gr
   where gr.id = p_grn_id and gr.tenant_id = p_tenant;
  if found then
    return jsonb_build_object('grn_number', v_number, 'replayed', true);
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'a delivery needs at least one line' using errcode = '22023';
  end if;

  if coalesce(p_freight, 0) < 0 or coalesce(p_other, 0) < 0 then
    raise exception 'freight and other costs cannot be negative' using errcode = '22023';
  end if;

  if not exists (select 1 from public.suppliers s
                  where s.id = p_supplier and s.tenant_id = p_tenant) then
    raise exception 'supplier % is not on this shop''s list', p_supplier
      using errcode = 'restrict_violation';
  end if;

  if p_order is not null and not exists (
    select 1 from public.purchase_orders po
     where po.id = p_order and po.tenant_id = p_tenant and po.supplier_id = p_supplier
  ) then
    raise exception 'order % is not this shop''s order with that supplier', p_order
      using errcode = 'restrict_violation';
  end if;

  select b.id into v_branch from public.branches b
   where b.tenant_id = p_tenant and b.is_primary limit 1;

  if v_branch is null then
    raise exception 'this shop has no branch, so a delivery has nowhere to land'
      using errcode = 'restrict_violation';
  end if;

  select array_agg(elem), count(*) into v_lines, v_count
    from jsonb_array_elements(p_lines) as elem;

  for v_index in 1 .. v_count loop
    if coalesce((v_lines[v_index]->>'quantity')::numeric, 0) <= 0 then
      raise exception 'every line on a delivery has to bring in more than nothing'
        using errcode = '22023';
    end if;
    v_subtotal := v_subtotal + (v_lines[v_index]->>'line_total')::numeric;
    v_quantity_total := v_quantity_total + (v_lines[v_index]->>'quantity')::numeric;
  end loop;

  if v_quantity_total <= 0 then
    raise exception 'a delivery has to bring something in' using errcode = '22023';
  end if;

  v_extra := coalesce(p_freight, 0) + coalesce(p_other, 0);
  v_number := 'GRN-' || lpad(private.next_number(p_tenant, 'goods_receipt')::text, 5, '0');

  insert into public.goods_receipts (
    id, tenant_id, branch_id, supplier_id, purchase_order_id, grn_number,
    received_on, supplier_invoice_no, note, subtotal, freight, other_cost,
    total, created_by
  )
  values (
    p_grn_id, p_tenant, v_branch, p_supplier, p_order, v_number,
    p_received_on, nullif(btrim(coalesce(p_invoice_no, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    v_subtotal, coalesce(p_freight, 0), coalesce(p_other, 0),
    v_subtotal + v_extra, p_by
  );

  for v_index in 1 .. v_count loop
    v_line := v_lines[v_index];
    v_item := nullif(v_line->>'item_id', '')::uuid;
    v_variant := nullif(v_line->>'variant_id', '')::uuid;
    v_quantity := (v_line->>'quantity')::numeric;
    v_line_total := (v_line->>'line_total')::numeric;

    if v_index = v_count then
      v_share := v_extra - v_spread;
    elsif v_subtotal > 0 then
      v_share := round(v_extra * v_line_total / v_subtotal, 2);
    else
      v_share := round(v_extra * v_quantity / v_quantity_total, 2);
    end if;

    v_spread := v_spread + v_share;
    v_landed_line := v_line_total + v_share;
    v_landed_unit := round(v_landed_line / v_quantity, 4);

    insert into public.goods_receipt_lines (
      tenant_id, goods_receipt_id, purchase_order_line_id, item_id,
      name_snapshot, unit, quantity, unit_cost, line_total, landed_unit_cost
    )
    values (
      p_tenant, p_grn_id, nullif(v_line->>'po_line_id', '')::uuid, v_item,
      v_line->>'name', v_line->>'unit', v_quantity,
      (v_line->>'unit_cost')::numeric, v_line_total, v_landed_unit
    );

    v_batch := null;
    v_tracked := false;

    if v_item is not null and v_variant is null then
      select i.tracks_batches into v_tracked from public.items i
       where i.id = v_item and i.tenant_id = p_tenant;

      if coalesce(v_tracked, false) then
        v_batch := private.ensure_batch(
          p_tenant, v_item, v_line->>'batch_no',
          nullif(v_line->>'expires_on', '')::date, v_landed_unit, p_grn_id
        );
      end if;
    end if;

    perform private.move_stock(
      p_tenant, v_item, v_quantity, 'purchase', null, null, p_by,
      p_grn_id, v_batch, v_variant
    );

    if v_item is not null then
      -- The variant's own cost where the line named one; otherwise the item's.
      -- A delivery of medium blue must not reprice the smalls.
      if v_variant is not null then
        update public.item_variants set cost_price = round(v_landed_unit, 2)
         where id = v_variant and tenant_id = p_tenant;
      else
        update public.items set cost_price = round(v_landed_unit, 2)
         where id = v_item and tenant_id = p_tenant;
      end if;
    end if;
  end loop;

  return jsonb_build_object('grn_number', v_number, 'replayed', false,
                            'total', v_subtotal + v_extra);
end;
$fn$;

revoke execute on function public.record_receipt(uuid, uuid, uuid, uuid, date, text, text, numeric, numeric, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.record_receipt(uuid, uuid, uuid, uuid, date, text, text, numeric, numeric, jsonb, uuid)
  to service_role;
