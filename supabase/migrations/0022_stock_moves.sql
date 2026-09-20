-- =============================================================================
-- 0022_stock_moves — the shelf count stops being a guess
--
-- Apply manually after 0021_reports.sql.
--
-- `items.stock` has existed since 0015 and nothing has ever moved it. A shop
-- could type 48 into the box, sell forty-seven of them across a Saturday, and
-- the screen would still say 48 on Sunday morning — which makes the Products
-- screen a manual count, the low-stock bell decoration, and "stock that adds
-- up" the one claim the product could not make. It is the single most
-- expensive gap in the build, because every other number on the console is
-- checked by somebody: a wrong total is disputed at the counter within a
-- minute, and a wrong shelf count is discovered a month later by a shopkeeper
-- standing in front of an empty shelf the console says has fourteen.
--
-- Two things land here, and they are one decision.
--
-- **Stock moves inside the sale's own transaction.** `record_sale` already
-- claims the receipt number and inserts the sale, its lines and its tender
-- together, because a number claimed against a sale that failed to insert is a
-- hole in the shop's series. A stock decrement written anywhere else — a second
-- statement in the Server Action, a trigger that could be disabled, a nightly
-- job — is the same hole one column over: a sale that happened and a shelf
-- that does not know. So it goes in the function, between the line insert and
-- the tender, and either all of it is true or none of it is.
--
-- **Every move is written down.** `public.stock_movements` is the ledger:
-- what moved, by how much, why, and what the count read afterwards. Without it
-- `items.stock` is a number that changes for reasons nobody can reconstruct,
-- and the first time an owner disagrees with it there is no conversation to
-- have. With it, "it says nine and there are seven" is a list to read rather
-- than an argument. It is also what makes a return able to put stock back
-- honestly, and what a stocktake corrects against.
--
-- `plans.features.stock_ledger` goes back to true in this migration, which is
-- the rule 0020 set: a flag is a promise the console can be held to, flipped in
-- the same migration that lands the thing it promises.
--
-- Everything obeys 0001: `tenant_id not null`, RLS enabled and forced, select
-- only for tenant JWTs, every write through a security-definer function or a
-- Server Action on the service role.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · The ledger
--
-- One row per movement, signed: negative is off the shelf, positive is onto it.
-- Signed rather than a quantity plus an in/out flag because every question
-- anybody asks of this table is a `sum()`, and a flag would put a CASE inside
-- every one of them.
--
-- `stock_after` is the count as it stood when the row was written. It is
-- redundant — it can be re-derived by adding the column up — and it is worth
-- the column anyway: it is what lets a shopkeeper read one screen of movements
-- and see where the number went wrong, without the console having to replay the
-- item's whole history to answer. It is also the only evidence that survives a
-- stocktake overwriting the running total.
--
-- `reason` is a closed list because it is read by people. "Sale" and "return"
-- are written by the register; "count" is a stocktake, where the owner types
-- what is actually on the shelf; "correction" is an edit to an item that
-- changed the number without anybody counting; "opening" is the figure an item
-- was added with; "import" is the same thing arriving off a spreadsheet.
-- -----------------------------------------------------------------------------
create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- Cascade, unlike `sale_lines.item_id`, and deliberately the other way round
  -- from it: a receipt is a record of what happened and outlives the item, but
  -- a ledger explaining a shelf count has nothing left to explain once the row
  -- it counted is gone. The sale it came from keeps the money and the name.
  item_id uuid not null references public.items (id) on delete cascade,
  reason text not null check (
    reason in ('sale', 'return', 'count', 'correction', 'opening', 'import')
  ),
  quantity numeric(12, 3) not null check (quantity <> 0),
  stock_after numeric(12, 3) not null,
  -- Which bill moved it, for the two reasons that are written by the register.
  -- `on delete set null` for the reason every other pointer at `sales` carries
  -- it, though nothing deletes a sale today.
  sale_id uuid references public.sales (id) on delete set null,
  -- What the owner typed when they corrected a count. "Damaged in the rain",
  -- "three bags went back to the supplier" — the sentence that makes the
  -- difference readable a month later.
  note text check (note is null or length(btrim(note)) <= 200),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- "What has happened to this item?" is the only question the screen asks, and
-- it asks it newest-first.
create index if not exists stock_movements_item_idx
  on public.stock_movements (tenant_id, item_id, created_at desc);

-- "What moved today?" — the stocktake view, and the one a report would want.
create index if not exists stock_movements_tenant_at_idx
  on public.stock_movements (tenant_id, created_at desc);

-- Reversing a return against the bill it came off.
create index if not exists stock_movements_sale_idx
  on public.stock_movements (sale_id)
  where sale_id is not null;

comment on table public.stock_movements is
  'Every change to items.stock, signed and with a reason. Written only by private.move_stock inside the transaction that caused it.';
comment on column public.stock_movements.quantity is
  'Signed: negative off the shelf, positive onto it. Every question of this table is a sum(), which is why there is no separate in/out flag.';
comment on column public.stock_movements.stock_after is
  'What items.stock read the instant after this row was written. Redundant and worth it: it is how an owner finds where a count went wrong without replaying the whole history.';

-- -----------------------------------------------------------------------------
-- 2 · The one way stock moves
--
-- Every caller goes through here, so there is exactly one place that can write
-- `items.stock` and exactly one place that writes the ledger, and they cannot
-- drift apart. The update and the insert are two statements in one function,
-- which inside a `record_sale` transaction means they are two statements in one
-- sale.
--
-- The item is located by `(id, tenant_id)` rather than by id alone: a line can
-- never move another shop's shelf, whatever it was handed. An id that does not
-- resolve returns null rather than raising — `sale_lines.item_id` is nullable
-- by design, and a sale must not fail because a line points at an item somebody
-- deleted between the search and the Charge button.
--
-- `security definer` because `items` and `stock_movements` are both revoked
-- from `authenticated` outright. `search_path = ''` and every name schema
-- qualified, per 0001.
-- -----------------------------------------------------------------------------
create or replace function private.move_stock(
  p_tenant uuid,
  p_item uuid,
  -- Signed. Negative is off the shelf.
  p_delta numeric,
  p_reason text,
  p_sale uuid,
  p_note text,
  p_by uuid
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

  -- One statement, so the read and the write cannot be separated by another
  -- tablet's sale. Two counters selling the last bottle at the same moment
  -- queue on the row lock and both movements land; the shelf goes to -1, which
  -- is the truth and is exactly what the shop needs to see.
  update public.items
     set stock = stock + p_delta
   where id = p_item
     and tenant_id = p_tenant
  returning stock into v_after;

  -- Not this shop's item, or an item deleted since the bill was rung up.
  -- Nothing to move and nothing to explain.
  if not found then
    return null;
  end if;

  insert into public.stock_movements (
    tenant_id, item_id, reason, quantity, stock_after, sale_id, note, created_by
  )
  values (
    p_tenant, p_item, p_reason, p_delta, v_after, p_sale,
    nullif(btrim(coalesce(p_note, '')), ''), p_by
  );

  return v_after;
end;
$fn$;

revoke execute on function private.move_stock(uuid, uuid, numeric, text, uuid, text, uuid)
  from public, anon, authenticated;

comment on function private.move_stock(uuid, uuid, numeric, text, uuid, text, uuid) is
  'The only writer of items.stock. Moves the count and records why, in the transaction that caused it. Returns the new count, or null for an item that is not this tenant''s.';

-- -----------------------------------------------------------------------------
-- 3 · Counting the shelf
--
-- The Products screen has a stock box in it and an owner types a number into
-- that box, so the console's entry point is absolute ("there are nine") and not
-- relative ("three fewer"). This is the function that turns the one into the
-- other: it locks the row, works out the difference, and hands `move_stock` a
-- delta.
--
-- That matters more than it looks. The obvious implementation — read the item
-- in the Server Action, subtract, then write — reads the count before the
-- customer at counter 2 buys two of them and writes a number that silently
-- un-sells them. Doing the arithmetic where the row is locked is the only way
-- a stocktake and a sale at the same second both survive.
--
-- A delta of zero writes nothing at all. An owner who opens an item, changes
-- its price and saves has not counted the shelf, and a ledger full of "count:
-- 0" rows is a ledger nobody reads.
-- -----------------------------------------------------------------------------
create or replace function public.set_stock(
  p_tenant uuid,
  p_item uuid,
  -- What is actually on the shelf.
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
  v_after numeric;
begin
  if p_reason not in ('count', 'correction', 'opening', 'import') then
    raise exception 'a counted stock figure is not a %', p_reason
      using errcode = '22023';
  end if;

  -- Locked, so the delta below is worked out against the count as it is this
  -- instant rather than as it was when the form was opened.
  select stock into v_before
    from public.items
   where id = p_item
     and tenant_id = p_tenant
     for update;

  if not found then
    raise exception 'item % is not on this shop''s list', p_item
      using errcode = 'restrict_violation';
  end if;

  if p_to = v_before then
    return jsonb_build_object('moved', false, 'before', v_before, 'after', v_before);
  end if;

  v_after := private.move_stock(
    p_tenant, p_item, p_to - v_before, p_reason, null, p_note, p_by
  );

  return jsonb_build_object(
    'moved', true, 'before', v_before, 'after', coalesce(v_after, p_to)
  );
end;
$fn$;

revoke execute on function public.set_stock(uuid, uuid, numeric, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.set_stock(uuid, uuid, numeric, text, text, uuid)
  to service_role;

comment on function public.set_stock(uuid, uuid, numeric, text, text, uuid) is
  'Sets an item to a counted figure and records the difference as a movement. Absolute in, relative down, so a stocktake and a sale at the same second both survive.';

-- -----------------------------------------------------------------------------
-- 4 · The register moves the shelf
--
-- Same signature as 0019's, so this is a replace. The only change is the four
-- lines after the line insert.
--
-- It is deliberately after the insert and not instead of it: the line is the
-- receipt and has to exist whether or not the item still does. `move_stock`
-- returning null for an item deleted mid-bill is therefore not an error — the
-- money is recorded, the paper prints, and there is no shelf left to debit.
--
-- Nothing here refuses a sale for want of stock, and nothing should. A kiryana
-- sells the bag that is on the counter whether or not the console has caught up
-- with it, and a till that says "no" to a customer holding cash is a till the
-- shop stops using by lunchtime. The count goes negative, the Products screen
-- shows it in red, and the shop corrects it — which is a conversation about a
-- real discrepancy rather than a refused sale.
-- -----------------------------------------------------------------------------
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
  v_item uuid;
  v_quantity numeric;
begin
  -- Already recorded. The retry gets the same receipt rather than a second one
  -- — and, since 0022, does not debit the shelf a second time either.
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

  if p_customer is not null and not exists (
    select 1 from public.customers c
    where c.id = p_customer and c.tenant_id = p_tenant
  ) then
    raise exception 'customer % is not on this shop''s list', p_customer
      using errcode = 'restrict_violation';
  end if;

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
    v_item := nullif(v_line->>'item_id', '')::uuid;
    v_quantity := (v_line->>'quantity')::numeric;

    insert into public.sale_lines (
      tenant_id, sale_id, item_id, name_snapshot, unit,
      quantity, unit_price, discount, line_total, cost_snapshot
    )
    values (
      p_tenant,
      p_sale_id,
      v_item,
      v_line->>'name',
      v_line->>'unit',
      v_quantity,
      (v_line->>'unit_price')::numeric,
      0,
      (v_line->>'line_total')::numeric,
      coalesce((
        select i.cost_price from public.items i
         where i.id = v_item and i.tenant_id = p_tenant
      ), 0)
    );

    -- Off the shelf, in this transaction, with the bill that took it named.
    -- Null for a line whose item has been deleted since it went on the bill:
    -- the receipt is still printed and the money is still counted.
    perform private.move_stock(
      p_tenant, v_item, -v_quantity, 'sale', p_sale_id, null, p_created_by
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
  'Records one register sale, claims its counter receipt number and takes every line off the shelf — atomically. Replays safely on a repeated sale id.';

-- -----------------------------------------------------------------------------
-- 5 · Who may read it
--
-- Rule 3 from 0001: tenant JWTs get a select policy and nothing else. The
-- writes are `private.move_stock`, which is revoked from everybody and only
-- reachable from a security-definer function above it.
-- -----------------------------------------------------------------------------
revoke insert, update, delete, truncate on public.stock_movements
  from anon, authenticated;

alter table public.stock_movements enable row level security;
alter table public.stock_movements force row level security;

drop policy if exists stock_movements_read_own on public.stock_movements;
create policy stock_movements_read_own on public.stock_movements for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_platform_admin()));

-- -----------------------------------------------------------------------------
-- 6 · The flag stops lying
--
-- 0020's rule, honoured: `stock_ledger` was flipped false because nothing moved
-- the shelf, and it goes back to true in the migration that moves it. Both
-- plans, because the ledger is not a Premium feature — a shop on Standard whose
-- stock does not move is a shop with no stock control at all, which is not a
-- tier, it is a defect.
-- -----------------------------------------------------------------------------
update public.plans
   set features = features || jsonb_build_object('stock_ledger', true)
 where code in ('standard', 'premium');
