-- =============================================================================
-- 0030_batches — which carton it came off, and when it goes off
--
-- Apply manually after 0029_supplier_ledger.sql.
--
-- `items.stock` is one number. For a kiryana selling Surf Excel that is the
-- whole truth. For a pharmacy it is not a truth at all: forty strips of
-- Panadol are three batches with three expiry dates, two of them fine and one
-- of them due out of the shelf next Tuesday, and a console that cannot tell
-- them apart is a console a medical store cannot legally use. The same is true
-- of half a grocery — milk, bread, yoghurt, eggs.
--
-- **Batch tracking is per item and off by default.** That is the whole shape of
-- the decision. A shop's flour does not have a batch and asking for one would
-- be a second dropdown between a shopkeeper and a saved item — the mistake
-- `0016` undid when it dropped `items.subcategory`. `items.tracks_batches` is
-- opt-in, and everything below is a no-op for an item that has not opted in.
--
-- **`items.stock` stays the running total; batches are the sub-ledger under
-- it.** They can never disagree, because `private.move_stock` writes both in
-- one call and remains the only writer of either. A design where the batch rows
-- were the only truth and `items.stock` a view would have been cleaner on
-- paper and would have rewritten every reader, every report and the till's
-- stock gate to answer a question they already answer correctly.
--
-- **Sold first-expired-first, not first-in-first-out.** FIFO is about arrival
-- order and FEFO is about the date printed on the box, and it is the date that
-- matters: a carton received in March expiring in June must go before one
-- received in April expiring in December. `private.take_from_batches` orders on
-- `expires_on` and only breaks ties on arrival.
--
-- **An expired batch cannot be sold, and the till says which item and by how
-- much.** This is the one hard refusal in the product — harder than the stock
-- gate, which at least concerns a number somebody can go and count. Selling
-- expired medicine is the thing this migration exists to prevent, so the
-- allocation skips expired stock entirely and the sale is refused rather than
-- warned about. The way through is a write-off on the Products screen, which is
-- a deliberate, recorded act.
--
-- Everything obeys 0001: `tenant_id not null`, RLS enabled and forced, select
-- only for tenant JWTs, every write through a security-definer function.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · Which items are tracked
--
-- Off by default and off for every row that exists. A shop turns it on for the
-- handful of lines that need it — the medicines, the milk — and everything else
-- goes on working exactly as it did.
-- -----------------------------------------------------------------------------
alter table public.items
  add column if not exists tracks_batches boolean not null default false;

comment on column public.items.tracks_batches is
  'Opt-in. When true the item''s stock lives in item_batches as well as in items.stock, and the till sells first-expired-first. Off for everything a kiryana sells.';

-- -----------------------------------------------------------------------------
-- 2 · The batches
--
-- `batch_no` and `expires_on` are both nullable, and at least one of them has
-- to be there — that is what the check enforces. A pharmacy has both. A dairy
-- has an expiry and no batch number printed anywhere. A hardware shop tracking
-- a paint lot has a number and no expiry. All three are real, and a row with
-- neither is not a batch, it is the item's ordinary stock.
--
-- `quantity` may go negative, for the same reason `items.stock` may: two tills
-- selling the last strip at once is a discrepancy the shop needs to see rather
-- than a write the database should refuse.
-- -----------------------------------------------------------------------------
create table if not exists public.item_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- Cascade, like `stock_movements.item_id` and for the same reason: a batch
  -- explains a shelf count, and there is nothing left to explain once the item
  -- it counted is gone. The receipts and the sales keep their own snapshots.
  item_id uuid not null references public.items (id) on delete cascade,
  batch_no text check (batch_no is null or length(btrim(batch_no)) between 1 and 60),
  expires_on date,
  quantity numeric(12, 3) not null default 0,
  -- What one unit of *this* batch landed at, copied off the delivery that
  -- brought it in. Stored for the reason `goods_receipt_lines.landed_unit_cost`
  -- is stored: two batches of the same item bought three months apart cost
  -- different money, and the shelf holds both.
  unit_cost numeric(12, 4) not null default 0,
  -- The delivery that brought it in, when there was one. Null for a batch
  -- somebody opened by hand on the Products screen.
  goods_receipt_id uuid references public.goods_receipts (id) on delete set null,
  received_on date not null default current_date,
  note text check (note is null or length(btrim(note)) <= 200),
  created_at timestamptz not null default now(),
  constraint item_batches_identified
    check (batch_no is not null or expires_on is not null)
);

-- One batch per item per (number, expiry). A second delivery of the same batch
-- tops the row up rather than opening a parallel one — two rows for one batch
-- is two expiry dates for one carton, and the shelf has one.
--
-- The coalesces are what make it work with either half missing: a dairy line
-- keyed on expiry alone and a paint lot keyed on number alone both collapse
-- correctly, and `9999-12-31` stands in for "no expiry" so the index is total.
create unique index if not exists item_batches_identity_idx
  on public.item_batches (
    tenant_id,
    item_id,
    coalesce(btrim(batch_no), ''),
    coalesce(expires_on, date '9999-12-31')
  );

-- The allocation order, and the only index the till's hot path needs: what is
-- on the shelf for this item, soonest to expire first.
create index if not exists item_batches_fefo_idx
  on public.item_batches (tenant_id, item_id, expires_on, received_on)
  where quantity > 0;

-- "What is going off across the whole shop?" — the bell, and the expiry filter
-- on the item list. Partial, because a batch with nothing left in it is not
-- something anybody has to act on.
create index if not exists item_batches_expiry_idx
  on public.item_batches (tenant_id, expires_on)
  where quantity > 0 and expires_on is not null;

comment on table public.item_batches is
  'Stock of a batch-tracked item, split by batch number and expiry. A sub-ledger under items.stock — private.move_stock writes both together and is the only writer of either.';

-- -----------------------------------------------------------------------------
-- 3 · The ledger names the batch
--
-- `'expired'` joins the closed list of reasons. It is the only one that exists
-- to take stock *off* the shelf without anybody being paid for it, which is
-- exactly why it has to be its own reason rather than a 'correction' with a
-- note: "how much did we throw away last quarter" is a question a pharmacy
-- lives or dies by, and it has to be a `sum()` and not a text search.
-- -----------------------------------------------------------------------------
alter table public.stock_movements drop constraint if exists stock_movements_reason_check;
alter table public.stock_movements add constraint stock_movements_reason_check
  check (reason in (
    'sale', 'return', 'count', 'correction', 'opening', 'import', 'purchase', 'expired'
  ));

alter table public.stock_movements
  add column if not exists batch_id uuid
    references public.item_batches (id) on delete set null;

create index if not exists stock_movements_batch_idx
  on public.stock_movements (batch_id)
  where batch_id is not null;

-- -----------------------------------------------------------------------------
-- 4 · The one way stock moves, widened once more
--
-- Dropped and recreated rather than replaced: a new parameter is a new
-- signature, and a default would leave the eight-argument version standing
-- beside it as an overload that silently moves no batch. The existing callers
-- pass eight arguments and resolve to this one on the default.
--
-- The batch update and the item update are two statements in one function,
-- which inside a `record_sale` transaction means they are two statements in one
-- sale. That is the whole guarantee: `items.stock` and the sum of its batches
-- cannot drift, because nothing can move one without the other.
--
-- A batch that does not resolve raises rather than being skipped. Every caller
-- of this with a batch id got that id from `ensure_batch` or from a row it just
-- locked, so a miss is a bug in this file — and a bug that silently desyncs the
-- two counts is the one bug this design exists to make impossible.
-- -----------------------------------------------------------------------------
drop function if exists private.move_stock(uuid, uuid, numeric, text, uuid, text, uuid, uuid);

create or replace function private.move_stock(
  p_tenant uuid,
  p_item uuid,
  p_delta numeric,
  p_reason text,
  p_sale uuid,
  p_note text,
  p_by uuid,
  p_receipt uuid default null,
  p_batch uuid default null
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

  insert into public.stock_movements (
    tenant_id, item_id, reason, quantity, stock_after, sale_id,
    goods_receipt_id, batch_id, note, created_by
  )
  values (
    p_tenant, p_item, p_reason, p_delta, v_after, p_sale,
    p_receipt, p_batch, nullif(btrim(coalesce(p_note, '')), ''), p_by
  );

  return v_after;
end;
$fn$;

revoke execute on function private.move_stock(uuid, uuid, numeric, text, uuid, text, uuid, uuid, uuid)
  from public, anon, authenticated;

comment on function private.move_stock(uuid, uuid, numeric, text, uuid, text, uuid, uuid, uuid) is
  'The only writer of items.stock and of item_batches.quantity. Moves both together so they cannot drift, and records why.';

-- -----------------------------------------------------------------------------
-- 5 · Opening a batch, or topping one up
--
-- Upsert on the identity index, so a second delivery of the same batch number
-- and expiry finds the row rather than colliding with it. The cost is refreshed
-- on the way through: the newest delivery of a batch is the best answer to what
-- that batch cost, and the old figure is still on the goods receipt that set it.
-- -----------------------------------------------------------------------------
create or replace function private.ensure_batch(
  p_tenant uuid,
  p_item uuid,
  p_batch_no text,
  p_expires_on date,
  p_unit_cost numeric,
  p_receipt uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_no text := nullif(btrim(coalesce(p_batch_no, '')), '');
  v_id uuid;
begin
  if v_no is null and p_expires_on is null then
    -- Neither half given, so there is no batch to open. The caller falls back
    -- to moving the item's plain stock, which is the honest answer for a line
    -- somebody did not label.
    return null;
  end if;

  insert into public.item_batches (
    tenant_id, item_id, batch_no, expires_on, quantity, unit_cost, goods_receipt_id
  )
  values (p_tenant, p_item, v_no, p_expires_on, 0, coalesce(p_unit_cost, 0), p_receipt)
  on conflict (
    tenant_id, item_id,
    coalesce(btrim(batch_no), ''),
    coalesce(expires_on, date '9999-12-31')
  )
  do update set unit_cost = coalesce(excluded.unit_cost, public.item_batches.unit_cost)
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke execute on function private.ensure_batch(uuid, uuid, text, date, numeric, uuid)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6 · Taking stock off, soonest to expire first
--
-- The rows are locked in allocation order so two tills selling the last strip
-- queue rather than both taking it. `nulls last` puts an undated batch behind
-- every dated one, which is right: a batch nobody put a date on should be the
-- one left standing, not the one sold first.
--
-- Expired stock is not in the walk at all. If what is left unexpired does not
-- cover the line, the whole sale is refused with the item named and both
-- numbers — the same shape as the stock gate, and for a stronger reason. A
-- cashier cannot fix this at the till and should not try: the way through is a
-- write-off on the Products screen, which is a deliberate, recorded act by
-- somebody allowed to make it.
-- -----------------------------------------------------------------------------
create or replace function private.take_from_batches(
  p_tenant uuid,
  p_item uuid,
  p_quantity numeric,
  p_sale uuid,
  p_by uuid,
  p_today date
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_left numeric := p_quantity;
  v_take numeric;
  v_batch record;
  v_name text;
  v_have numeric;
begin
  if p_quantity is null or p_quantity <= 0 then
    return;
  end if;

  for v_batch in
    select b.id, b.quantity
      from public.item_batches b
     where b.tenant_id = p_tenant
       and b.item_id = p_item
       and b.quantity > 0
       and (b.expires_on is null or b.expires_on >= p_today)
     order by b.expires_on nulls last, b.received_on, b.created_at
       for update
  loop
    exit when v_left <= 0;

    v_take := least(v_left, v_batch.quantity);
    perform private.move_stock(
      p_tenant, p_item, -v_take, 'sale', p_sale, null, p_by, null, v_batch.id
    );
    v_left := v_left - v_take;
  end loop;

  if v_left > 0 then
    select i.name into v_name from public.items i
     where i.id = p_item and i.tenant_id = p_tenant;

    select coalesce(sum(b.quantity), 0) into v_have
      from public.item_batches b
     where b.tenant_id = p_tenant
       and b.item_id = p_item
       and b.quantity > 0
       and (b.expires_on is null or b.expires_on >= p_today);

    raise exception
      'there are only % of % in date — the rest has expired and cannot be sold. Write it off on Products & stock.',
      v_have, coalesce(v_name, 'that item')
      using errcode = 'restrict_violation';
  end if;
end;
$fn$;

revoke execute on function private.take_from_batches(uuid, uuid, numeric, uuid, uuid, date)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7 · Putting it back where it came from
--
-- A return of a batch-tracked item goes back into the batches *that sale* took
-- it out of, read off the movements the sale itself wrote. Falling back to a
-- plain FEFO pick would put June's stock into December's batch and quietly
-- extend its life by six months — the precise failure this migration exists to
-- prevent, arriving through the back door.
--
-- **Of those batches, soonest to expire first.** The obvious rule — unwind the
-- sale newest movement first — is not available and looked as though it was:
-- every movement one sale writes shares a single `created_at`, because `now()`
-- in Postgres is the transaction's start time, so ordering on it within a sale
-- is undefined. This was caught by a partial return landing in the wrong batch.
--
-- The conservative rule is deterministic and better anyway. Which physical
-- strip the customer handed back is unknowable, and assuming the earliest date
-- it could have carried is the only assumption that cannot extend anything's
-- life. It also puts returned stock at the front of the next allocation, which
-- is where returned stock belongs.
--
-- A sale rung up before this migration has no batch movements to read and falls
-- back to moving the item's plain stock — which is what those sales have always
-- done and stays correct, because `items.stock` is still the running total.
-- -----------------------------------------------------------------------------
create or replace function private.return_to_batches(
  p_tenant uuid,
  p_item uuid,
  p_quantity numeric,
  p_original_sale uuid,
  p_return_sale uuid,
  p_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_left numeric := p_quantity;
  v_put numeric;
  v_move record;
begin
  if p_quantity is null or p_quantity <= 0 then
    return;
  end if;

  for v_move in
    select m.batch_id, sum(-m.quantity) as took
      from public.stock_movements m
      join public.item_batches b on b.id = m.batch_id
     where m.tenant_id = p_tenant
       and m.item_id = p_item
       and m.sale_id = p_original_sale
       and m.reason = 'sale'
       and m.batch_id is not null
     group by m.batch_id, b.expires_on
     order by b.expires_on nulls last
  loop
    exit when v_left <= 0;

    v_put := least(v_left, v_move.took);
    perform private.move_stock(
      p_tenant, p_item, v_put, 'return', p_return_sale, null, p_by, null, v_move.batch_id
    );
    v_left := v_left - v_put;
  end loop;

  -- Nothing batched on the original — a sale from before batches existed, or an
  -- item that was not tracked then. The item's own count still has to move.
  if v_left > 0 then
    perform private.move_stock(
      p_tenant, p_item, v_left, 'return', p_return_sale, null, p_by
    );
  end if;
end;
$fn$;

revoke execute on function private.return_to_batches(uuid, uuid, numeric, uuid, uuid, uuid)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8 · Counting or writing off one batch
--
-- The absolute-to-relative adapter for a batch, exactly as `set_stock` is for an
-- item, and for the identical reason: the screen's entry point is "there are
-- nine of this batch left" and the safe write is a delta worked out under a
-- lock. Reading, subtracting and writing in a Server Action reads the count
-- before counter 2 sells two and writes a number that un-sells them.
--
-- Writing a batch off is this function with a target of nought and a reason of
-- `'expired'`, which is why there is no separate write-off function.
-- -----------------------------------------------------------------------------
create or replace function public.adjust_batch(
  p_tenant uuid,
  p_batch uuid,
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
  if p_reason not in ('count', 'correction', 'expired') then
    raise exception 'a counted batch figure is not a %', p_reason
      using errcode = '22023';
  end if;

  if p_to is null or p_to < 0 then
    raise exception 'a batch cannot be counted to %', p_to
      using errcode = '22023';
  end if;

  select b.item_id, b.quantity into v_item, v_before
    from public.item_batches b
   where b.id = p_batch and b.tenant_id = p_tenant
     for update;

  if not found then
    raise exception 'batch % is not this shop''s', p_batch
      using errcode = 'restrict_violation';
  end if;

  if p_to = v_before then
    return jsonb_build_object('moved', false, 'before', v_before, 'after', v_before);
  end if;

  v_after := private.move_stock(
    p_tenant, v_item, p_to - v_before, p_reason, null, p_note, p_by, null, p_batch
  );

  return jsonb_build_object(
    'moved', true, 'before', v_before, 'after', p_to, 'item_stock', v_after
  );
end;
$fn$;

revoke execute on function public.adjust_batch(uuid, uuid, numeric, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.adjust_batch(uuid, uuid, numeric, text, text, uuid)
  to service_role;

comment on function public.adjust_batch(uuid, uuid, numeric, text, text, uuid) is
  'Counts one batch to an absolute figure, or writes it off with reason expired. Absolute in, relative down, under a row lock — the same adapter set_stock is for an item.';

-- -----------------------------------------------------------------------------
-- 9 · Opening a batch by hand
--
-- For stock already on the shelf when tracking is switched on, and for the shop
-- that does not put its deliveries through Buying. Same shape as the delivery
-- path, one batch at a time.
-- -----------------------------------------------------------------------------
create or replace function public.open_batch(
  p_tenant uuid,
  p_item uuid,
  p_batch_no text,
  p_expires_on date,
  p_quantity numeric,
  p_unit_cost numeric,
  p_note text,
  p_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_batch uuid;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'a batch has to open with something in it'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.items i
    where i.id = p_item and i.tenant_id = p_tenant and i.tracks_batches
  ) then
    raise exception 'item % is not tracked by batch', p_item
      using errcode = 'restrict_violation';
  end if;

  v_batch := private.ensure_batch(
    p_tenant, p_item, p_batch_no, p_expires_on, p_unit_cost, null
  );

  if v_batch is null then
    raise exception 'a batch needs a number or an expiry date'
      using errcode = '22023';
  end if;

  perform private.move_stock(
    p_tenant, p_item, p_quantity, 'count', null, p_note, p_by, null, v_batch
  );

  return jsonb_build_object('batch_id', v_batch, 'quantity', p_quantity);
end;
$fn$;

revoke execute on function public.open_batch(uuid, uuid, text, date, numeric, numeric, text, uuid)
  from public, anon, authenticated;
grant execute on function public.open_batch(uuid, uuid, text, date, numeric, numeric, text, uuid)
  to service_role;

-- -----------------------------------------------------------------------------
-- 10 · A whole-item stocktake stops making sense
--
-- `set_stock` sets the item's total. For a batch-tracked item there is no
-- honest way to spread "there are nine" across three batches with three
-- expiries, and guessing would put stock into whichever batch the guess picked
-- — extending or shortening its life by whatever the difference was. So it
-- refuses and names the screen that does work.
--
-- Same signature, so this is a replace and every existing caller is unchanged.
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
begin
  if p_reason not in ('count', 'correction', 'opening', 'import') then
    raise exception 'a counted stock figure is not a %', p_reason
      using errcode = '22023';
  end if;

  select stock, tracks_batches into v_before, v_tracked
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
-- 11 · Who may read it
-- -----------------------------------------------------------------------------
revoke insert, update, delete, truncate on public.item_batches from anon, authenticated;

alter table public.item_batches enable row level security;
alter table public.item_batches force row level security;

drop policy if exists item_batches_read_own on public.item_batches;
create policy item_batches_read_own on public.item_batches for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_platform_admin()));

-- -----------------------------------------------------------------------------
-- 12 · The delivery opens the batch
--
-- Same signature as 0028's, so this is a replace. The only change is inside the
-- line loop: a batch-tracked item whose line carries a number or an expiry gets
-- a batch opened for it and the stock goes in there.
--
-- Capturing it here rather than anywhere else is the whole point. The moment
-- somebody is holding the carton is the moment the date printed on it is
-- readable, and any later screen is a screen where they are typing it from
-- memory.
--
-- A tracked item whose line carries neither is not refused. That is deliberate:
-- the person at the door has a queue behind them, and a delivery recorded
-- without a batch is worth more than a delivery not recorded. It lands in the
-- item's plain stock, the Products screen shows it as untracked, and somebody
-- puts it in a batch later.
-- -----------------------------------------------------------------------------
create or replace function public.record_receipt(
  p_tenant uuid,
  p_grn_id uuid,
  p_supplier uuid,
  p_order uuid,
  p_received_on date,
  p_invoice_no text,
  p_note text,
  p_freight numeric,
  p_other numeric,
  p_lines jsonb,
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
  v_line jsonb;
  v_lines jsonb[];
  v_count integer;
  v_index integer;
  v_subtotal numeric := 0;
  v_quantity_total numeric := 0;
  v_extra numeric;
  v_spread numeric := 0;
  v_share numeric;
  v_item uuid;
  v_quantity numeric;
  v_line_total numeric;
  v_landed_line numeric;
  v_landed_unit numeric;
  v_tracked boolean;
  v_batch uuid;
begin
  select gr.grn_number into v_number
    from public.goods_receipts gr
   where gr.id = p_grn_id and gr.tenant_id = p_tenant;

  if found then
    return jsonb_build_object('grn_number', v_number, 'replayed', true);
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'a delivery needs at least one line'
      using errcode = '22023';
  end if;

  if coalesce(p_freight, 0) < 0 or coalesce(p_other, 0) < 0 then
    raise exception 'freight and other costs cannot be negative'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.suppliers s
    where s.id = p_supplier and s.tenant_id = p_tenant
  ) then
    raise exception 'supplier % is not on this shop''s list', p_supplier
      using errcode = 'restrict_violation';
  end if;

  if p_order is not null and not exists (
    select 1 from public.purchase_orders po
    where po.id = p_order
      and po.tenant_id = p_tenant
      and po.supplier_id = p_supplier
  ) then
    raise exception 'order % is not this shop''s order with that supplier', p_order
      using errcode = 'restrict_violation';
  end if;

  select b.id into v_branch
    from public.branches b
   where b.tenant_id = p_tenant and b.is_primary
   limit 1;

  if v_branch is null then
    raise exception 'this shop has no branch, so a delivery has nowhere to land'
      using errcode = 'restrict_violation';
  end if;

  select array_agg(elem), count(*)
    into v_lines, v_count
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
    raise exception 'a delivery has to bring something in'
      using errcode = '22023';
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
      p_tenant,
      p_grn_id,
      nullif(v_line->>'po_line_id', '')::uuid,
      v_item,
      v_line->>'name',
      v_line->>'unit',
      v_quantity,
      (v_line->>'unit_cost')::numeric,
      v_line_total,
      v_landed_unit
    );

    v_batch := null;
    v_tracked := false;

    if v_item is not null then
      select i.tracks_batches into v_tracked
        from public.items i
       where i.id = v_item and i.tenant_id = p_tenant;

      if coalesce(v_tracked, false) then
        -- The landed cost, not the invoice cost: what this batch is worth on
        -- the shelf includes the bhaara that brought it here.
        v_batch := private.ensure_batch(
          p_tenant,
          v_item,
          v_line->>'batch_no',
          nullif(v_line->>'expires_on', '')::date,
          v_landed_unit,
          p_grn_id
        );
      end if;
    end if;

    perform private.move_stock(
      p_tenant, v_item, v_quantity, 'purchase', null, null, p_by, p_grn_id, v_batch
    );

    if v_item is not null then
      update public.items
         set cost_price = round(v_landed_unit, 2)
       where id = v_item and tenant_id = p_tenant;
    end if;
  end loop;

  return jsonb_build_object(
    'grn_number', v_number,
    'replayed', false,
    'total', v_subtotal + v_extra
  );
end;
$fn$;

revoke execute on function public.record_receipt(uuid, uuid, uuid, uuid, date, text, text, numeric, numeric, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.record_receipt(uuid, uuid, uuid, uuid, date, text, text, numeric, numeric, jsonb, uuid)
  to service_role;

-- -----------------------------------------------------------------------------
-- 13 · The till sells the oldest date first
--
-- Same signature as 0026's, so this is a replace. Two changes inside the line
-- loop, and nothing else in the function moves.
--
-- The item's `tracks_batches` and `cost_price` are read together in one go
-- rather than the cost being a subselect inside the insert — it is the same
-- round trip either way and the branch below needs the flag anyway.
--
-- `p_business_day` is what an expiry is compared against, not `current_date`.
-- A dhaba that shuts at 1 am is still trading on yesterday's books, and a strip
-- that expires today should not become unsellable an hour before the shutter
-- comes down. The shop's own day is the one the whole console reports on.
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
  p_customer uuid,
  p_discount numeric default 0,
  p_ceiling_pct numeric default 0
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
  v_gross numeric;
  v_discount numeric;
  v_left numeric;
  v_share numeric;
  v_index integer := 0;
  v_count integer;
  v_shift uuid;
  v_tracked boolean;
  v_cost numeric;
begin
  select receipt_number into v_receipt
  from public.sales
  where id = p_sale_id and tenant_id = p_tenant;

  if found then
    return jsonb_build_object('receipt_number', v_receipt, 'replayed', true);
  end if;

  v_count := jsonb_array_length(p_lines);

  if p_total < 0 or p_subtotal < 0 or v_count = 0 then
    raise exception 'a sale needs at least one line and a total of zero or more'
      using errcode = '22023';
  end if;

  select coalesce(sum((value->>'line_total')::numeric), 0)
    into v_gross
    from jsonb_array_elements(p_lines);

  v_discount := round(coalesce(p_discount, 0), 2);

  if v_discount < 0 then
    raise exception 'a discount cannot be negative'
      using errcode = '22023';
  end if;

  if v_discount > v_gross then
    raise exception 'a discount of % is more than the bill of %', v_discount, v_gross
      using errcode = '22023';
  end if;

  if v_discount > 0 and v_discount > ceil(v_gross * coalesce(p_ceiling_pct, 0)) / 100 then
    raise exception 'a discount of % is over this cashier''s ceiling of %%%',
      v_discount, p_ceiling_pct
      using errcode = 'restrict_violation';
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

  select id into v_shift
    from public.shifts
   where tenant_id = p_tenant
     and counter_id = p_counter
     and status = 'open';

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
    v_cost := 0;

    if v_item is not null then
      select i.tracks_batches, i.cost_price into v_tracked, v_cost
        from public.items i
       where i.id = v_item and i.tenant_id = p_tenant;
    end if;

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
      v_share,
      (v_line->>'line_total')::numeric - v_share,
      coalesce(v_cost, 0)
    );

    if coalesce(v_tracked, false) then
      -- Soonest to expire first, skipping anything already out of date. This
      -- raises rather than warning if what is in date does not cover the line,
      -- which fails the whole sale — see the header.
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

    update public.sales
       set discount_total = v_discount,
           total = v_gross - v_discount
     where id = p_sale_id;
  end if;

  insert into public.sale_tenders (tenant_id, sale_id, method, amount)
  values (p_tenant, p_sale_id, p_tender, v_gross - v_discount);

  return jsonb_build_object(
    'receipt_number', v_receipt,
    'replayed', false,
    'discount', v_discount,
    'total', v_gross - v_discount,
    'shift_id', v_shift
  );
end;
$fn$;

revoke execute on function public.record_sale(uuid, uuid, uuid, date, uuid, numeric, numeric, text, jsonb, uuid, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.record_sale(uuid, uuid, uuid, date, uuid, numeric, numeric, text, jsonb, uuid, numeric, numeric)
  to service_role;

-- -----------------------------------------------------------------------------
-- 14 · A return goes back into its own batch
--
-- Same signature as 0026's, so this is a replace. The only change is the
-- restock branch: a batch-tracked item goes back into the batches that sale
-- took it out of, read off the movements the sale itself wrote.
--
-- Guessing FEFO here would be actively wrong. The customer is handing back a
-- strip with a date on it, and putting June's stock into December's batch
-- quietly extends its life by six months — which is the precise failure this
-- whole migration exists to prevent, arriving through the back door.
-- -----------------------------------------------------------------------------
create or replace function public.record_return(
  p_tenant uuid,
  p_counter uuid,
  p_return_id uuid,
  p_business_day date,
  p_created_by uuid,
  p_sale_id uuid,
  p_lines jsonb,
  p_tender text,
  p_restock boolean,
  p_note text
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
  v_original public.sale_lines%rowtype;
  v_want numeric;
  v_done numeric;
  v_unit_net numeric;
  v_unit_discount numeric;
  v_amount numeric;
  v_discount numeric;
  v_gross numeric := 0;
  v_off numeric := 0;
  v_net numeric := 0;
  v_sale public.sales%rowtype;
  v_shift uuid;
  v_tracked boolean;
begin
  select receipt_number into v_receipt
  from public.sales
  where id = p_return_id and tenant_id = p_tenant;

  if found then
    return jsonb_build_object('receipt_number', v_receipt, 'replayed', true);
  end if;

  if jsonb_array_length(p_lines) = 0 then
    raise exception 'a return needs at least one line'
      using errcode = '22023';
  end if;

  select * into v_sale
    from public.sales
   where id = p_sale_id
     and tenant_id = p_tenant
     for update;

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
   where id = p_counter
     and tenant_id = p_tenant
     and is_active
  returning branch_id, receipt_prefix, receipt_serial
       into v_branch, v_prefix, v_serial;

  if not found then
    raise exception 'counter % is not an open counter for this shop', p_counter
      using errcode = 'restrict_violation';
  end if;

  select id into v_shift
    from public.shifts
   where tenant_id = p_tenant
     and counter_id = p_counter
     and status = 'open';

  v_receipt := v_prefix || '-' || to_char(p_business_day, 'YYMMDD') || '-' || lpad(v_serial::text, 4, '0');

  insert into public.sales (
    id, tenant_id, branch_id, counter_id, customer_id, receipt_number,
    business_day, status, subtotal, discount_total, total, created_by,
    refunds_sale_id, note, shift_id
  )
  values (
    p_return_id, p_tenant, v_branch, p_counter,
    v_sale.customer_id, v_receipt,
    p_business_day, 'refund', 0, 0, 0, p_created_by,
    p_sale_id, nullif(btrim(coalesce(p_note, '')), ''), v_shift
  );

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    select * into v_original
      from public.sale_lines
     where id = (v_line->>'line_id')::uuid
       and sale_id = p_sale_id
       and tenant_id = p_tenant
       for update;

    if not found then
      raise exception 'that line is not on bill %', p_sale_id
        using errcode = 'restrict_violation';
    end if;

    v_want := (v_line->>'quantity')::numeric;

    if v_want is null or v_want <= 0 then
      raise exception 'a return of % is not a quantity', v_want
        using errcode = '22023';
    end if;

    select coalesce(-sum(l.quantity), 0) into v_done
      from public.sale_lines l
     where l.refunds_line_id = v_original.id
       and l.tenant_id = p_tenant;

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
      tenant_id, sale_id, item_id, name_snapshot, unit,
      quantity, unit_price, discount, line_total, cost_snapshot,
      refunds_line_id
    )
    values (
      p_tenant,
      p_return_id,
      v_original.item_id,
      v_original.name_snapshot,
      v_original.unit,
      -v_want,
      v_original.unit_price,
      -v_discount,
      -v_amount,
      v_original.cost_snapshot,
      v_original.id
    );

    v_gross := v_gross + round(v_original.unit_price * v_want, 2);
    v_off := v_off + v_discount;
    v_net := v_net + v_amount;

    if p_restock and v_original.item_id is not null then
      select i.tracks_batches into v_tracked
        from public.items i
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
  end loop;

  update public.sales
     set subtotal = -v_gross,
         discount_total = -v_off,
         total = -v_net
   where id = p_return_id;

  insert into public.sale_tenders (tenant_id, sale_id, method, amount)
  values (p_tenant, p_return_id, p_tender, -v_net);

  return jsonb_build_object(
    'receipt_number', v_receipt,
    'replayed', false,
    'total', v_net
  );
end;
$fn$;

revoke execute on function public.record_return(uuid, uuid, uuid, date, uuid, uuid, jsonb, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.record_return(uuid, uuid, uuid, date, uuid, uuid, jsonb, text, boolean, text)
  to service_role;
