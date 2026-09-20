-- =============================================================================
-- 0028_purchasing — the order, the delivery, and what it actually cost
--
-- Apply manually after 0027_suppliers.sql.
--
-- `items.cost_price` has been a number an owner typed since 0015. Every margin
-- on Reports, every profit figure on the dashboard and every `cost_snapshot`
-- stamped on a sale line is worked out from it — and nothing in the product has
-- ever put a real invoice behind it. A shopkeeper who pays Rs 148 a bottle in
-- January and Rs 161 in June has to remember to go and retype it, and the month
-- they forget is the month the console quietly tells them they are making 22%
-- when they are making 14%.
--
-- Three things land here, and they are one decision.
--
-- **The order.** `purchase_orders` is what was asked for: a supplier, a date
-- you expect it, and lines. It is an intention, not a fact — nothing about it
-- moves stock or money.
--
-- **The delivery.** `goods_receipts` is what actually turned up, and it is the
-- fact. It may point at an order or at nothing at all, because most kiryana
-- buying is a van arriving on a Tuesday with no paperwork in front of it, and a
-- system that demands an order first is a system the shop works around.
--
-- **The landed cost.** The freight and the labour are not free and they are not
-- on the invoice lines. `record_receipt` apportions them across the lines pro
-- rata and writes the remainder onto the last one, so
-- `sum(landed_unit_cost × quantity)` equals the receipt total exactly — the
-- same arithmetic, and the same reason, as `record_sale` apportioning a bill's
-- discount. Then it sets `items.cost_price` from that figure, which is the
-- whole point: the margin column stops being a memory.
--
-- **Stock moves inside the receipt's own transaction**, through
-- `private.move_stock` and nothing else, exactly as a sale takes it off. A
-- delivery recorded and a shelf that does not know is the same hole 0022 exists
-- to close, one direction over.
--
-- What is deliberately *not* here: no partial-receipt status column, and no
-- `received_quantity` on an order line. Both are derived by counting the
-- receipt lines that point at the order line — the same call `0024` made for
-- `returned`, and for the same reason: a stored counter is a second copy of the
-- truth, and the copy that drifts is the one that says a shop is still owed
-- forty bottles it took delivery of last week.
--
-- Everything obeys 0001: `tenant_id not null`, RLS enabled and forced, select
-- only for tenant JWTs, every write through a security-definer function.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · The numbering
--
-- A purchase order and a goods-received note each need a number a human quotes
-- down a phone line, and it has to be unique per shop and gapless enough to be
-- believed. `counters.receipt_serial` does this for the till, but a receipt
-- series is per counter and restarts every trading day; a PO series is per shop
-- and runs all year, because an accountant asking for PO-00214 does not know
-- which day it was raised.
--
-- Its own table rather than two more columns on `tenant_settings`: that table
-- is the shop's preferences, a settings form writes it, and a running counter
-- claimed inside a delivery's transaction has no business queueing behind
-- somebody changing the timezone. `kind` is open-ended for the same reason —
-- the day a supplier invoice or a stock-transfer note needs a series, it is a
-- row here and not another migration like this one.
-- -----------------------------------------------------------------------------
create table if not exists public.document_series (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null check (kind in ('purchase_order', 'goods_receipt')),
  -- The last number handed out. Zero means none yet, so the first claim is 1.
  last_number integer not null default 0 check (last_number >= 0),
  primary key (tenant_id, kind)
);

comment on table public.document_series is
  'One running number per shop per document kind, claimed under a row lock inside the transaction that uses it. Separate from tenant_settings because a counter is not a preference.';

/**
 * The next number in a series, claimed atomically.
 *
 * The `on conflict do update` is what makes this safe *and* what makes a shop
 * with no row work on its first order: the insert and the increment are one
 * statement, so two tablets raising an order at the same instant queue on the
 * row rather than both reading 14 and both writing 15.
 */
create or replace function private.next_number(
  p_tenant uuid,
  p_kind text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_number integer;
begin
  insert into public.document_series (tenant_id, kind, last_number)
  values (p_tenant, p_kind, 1)
  on conflict (tenant_id, kind)
    do update set last_number = public.document_series.last_number + 1
  returning last_number into v_number;

  return v_number;
end;
$fn$;

revoke execute on function private.next_number(uuid, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2 · The order
--
-- `status` is the human lifecycle and nothing else. Whether an order has been
-- received in full is *not* in here — it is counted off the receipt lines that
-- point at it, so it cannot be wrong.
--
--   draft     — being built. Editable, and nobody has been rung.
--   placed    — the supplier has been told. Editable only until something lands.
--   closed    — done with. Used when the rest of an order is never coming and
--               the owner wants it off the open list.
--   cancelled — never happening. Kept rather than deleted, because "why did we
--               not get the sugar" is a question asked a month later.
--
-- `subtotal` and `total` are stored even though the lines sum to them, for the
-- reason `close_shift` stores its expected figure: the order is written whole
-- by one function that recomputes both in the same transaction, and the list
-- screen reads a hundred orders without a hundred sums under it.
-- -----------------------------------------------------------------------------
create table if not exists public.purchase_orders (
  id uuid primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  branch_id uuid not null references public.branches (id) on delete cascade,
  -- `restrict`, unlike every other pointer in this schema, and deliberately:
  -- an order with no supplier on it is not a record of anything. The Suppliers
  -- sheet says so — switching a distributor off is the move, not deleting one
  -- you have ordered from.
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  order_number text not null,
  status text not null default 'draft'
    check (status in ('draft', 'placed', 'closed', 'cancelled')),
  -- When the van was promised. Null for "when he comes", which is most of it.
  expected_on date,
  note text check (note is null or length(btrim(note)) <= 500),
  subtotal numeric(12, 2) not null default 0 check (subtotal >= 0),
  total numeric(12, 2) not null default 0 check (total >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists purchase_orders_tenant_number_idx
  on public.purchase_orders (tenant_id, order_number);

-- The list, newest first, which is the only order anybody reads it in.
create index if not exists purchase_orders_tenant_at_idx
  on public.purchase_orders (tenant_id, created_at desc);

-- "What is still open with Ravi Trading?" — the question the supplier record
-- asks, and the one behind every reorder.
create index if not exists purchase_orders_tenant_supplier_idx
  on public.purchase_orders (tenant_id, supplier_id, created_at desc);

drop trigger if exists purchase_orders_set_updated_at on public.purchase_orders;
create trigger purchase_orders_set_updated_at before update on public.purchase_orders
  for each row execute function private.set_updated_at();

/* `name_snapshot` not null beside a nullable `item_id`, exactly as `sale_lines`
   carries them and for the same reason: an order is a record of what was asked
   for, and deleting an item must not quietly empty last month's orders. What is
   lost is the ability to group purchases by that item, which is the trade the
   product sheet already names. */
create table if not exists public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  purchase_order_id uuid not null
    references public.purchase_orders (id) on delete cascade,
  item_id uuid references public.items (id) on delete set null,
  name_snapshot text not null check (length(btrim(name_snapshot)) between 1 and 160),
  unit text not null,
  quantity numeric(12, 3) not null check (quantity > 0),
  unit_cost numeric(12, 2) not null check (unit_cost >= 0),
  line_total numeric(12, 2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create index if not exists purchase_order_lines_order_idx
  on public.purchase_order_lines (purchase_order_id);

create index if not exists purchase_order_lines_tenant_item_idx
  on public.purchase_order_lines (tenant_id, item_id)
  where item_id is not null;

-- -----------------------------------------------------------------------------
-- 3 · The delivery
--
-- `purchase_order_id` is nullable and that is the important part. Most buying
-- in a kiryana is a van that turns up: no order was raised, and a screen that
-- insists on one is a screen the shop stops using and goes back to writing the
-- delivery in a notebook. An order is an optional thing to receive *against*,
-- not a precondition for receiving.
--
-- `freight` and `other_cost` are named separately rather than pooled, because
-- freight is the one every shop has and naming it is how an owner knows where
-- the bhaara goes. Both are apportioned into the lines identically.
--
-- `supplier_invoice_no` is the supplier's own number, not ours. It is what the
-- owner matches against when the distributor's man comes to settle.
-- -----------------------------------------------------------------------------
create table if not exists public.goods_receipts (
  id uuid primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  branch_id uuid not null references public.branches (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  purchase_order_id uuid
    references public.purchase_orders (id) on delete set null,
  grn_number text not null,
  -- The day the goods arrived, which is not always the day somebody typed it
  -- in. A delivery entered on Monday morning belonged to Saturday.
  received_on date not null,
  supplier_invoice_no text
    check (supplier_invoice_no is null or length(btrim(supplier_invoice_no)) <= 60),
  note text check (note is null or length(btrim(note)) <= 500),
  subtotal numeric(12, 2) not null default 0 check (subtotal >= 0),
  freight numeric(12, 2) not null default 0 check (freight >= 0),
  other_cost numeric(12, 2) not null default 0 check (other_cost >= 0),
  -- Always `subtotal + freight + other_cost`, written by the function. Stored
  -- rather than derived because it is what the supplier is owed for this
  -- delivery, and the ledger totals it.
  total numeric(12, 2) not null default 0 check (total >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists goods_receipts_tenant_number_idx
  on public.goods_receipts (tenant_id, grn_number);

create index if not exists goods_receipts_tenant_day_idx
  on public.goods_receipts (tenant_id, received_on desc);

create index if not exists goods_receipts_tenant_supplier_idx
  on public.goods_receipts (tenant_id, supplier_id, received_on desc);

create index if not exists goods_receipts_order_idx
  on public.goods_receipts (purchase_order_id)
  where purchase_order_id is not null;

/* `landed_unit_cost` is stored, and that is the column this whole migration is
   for.

   It is redundant — freight over the lines is arithmetic anybody can redo — and
   it is worth the column for the reason `sale_lines.cost_snapshot` is worth
   its column: this is what the delivery actually cost, on the day it arrived.
   Re-deriving it later, after somebody corrects the freight or the supplier
   sends a credit note, would silently rewrite what last month's stock cost and
   with it every margin already reported off it. */
create table if not exists public.goods_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  goods_receipt_id uuid not null
    references public.goods_receipts (id) on delete cascade,
  -- Which order line this satisfies, when there was one. `set null` rather than
  -- cascade: a cancelled order must not delete the record of goods that
  -- physically arrived.
  purchase_order_line_id uuid
    references public.purchase_order_lines (id) on delete set null,
  item_id uuid references public.items (id) on delete set null,
  name_snapshot text not null check (length(btrim(name_snapshot)) between 1 and 160),
  unit text not null,
  quantity numeric(12, 3) not null check (quantity > 0),
  -- What the invoice line says, before freight.
  unit_cost numeric(12, 2) not null check (unit_cost >= 0),
  line_total numeric(12, 2) not null check (line_total >= 0),
  -- What it cost to get one of them onto the shelf. This is what is written to
  -- `items.cost_price`.
  landed_unit_cost numeric(12, 4) not null check (landed_unit_cost >= 0),
  created_at timestamptz not null default now()
);

create index if not exists goods_receipt_lines_receipt_idx
  on public.goods_receipt_lines (goods_receipt_id);

-- "How much of this order has landed?" — counted off these rows rather than off
-- a column somebody has to maintain, which is why the index exists at all.
create index if not exists goods_receipt_lines_order_line_idx
  on public.goods_receipt_lines (purchase_order_line_id)
  where purchase_order_line_id is not null;

-- "What have I paid for this item over the year?" — the question that makes the
-- cost column defensible.
create index if not exists goods_receipt_lines_tenant_item_idx
  on public.goods_receipt_lines (tenant_id, item_id, created_at desc)
  where item_id is not null;

-- -----------------------------------------------------------------------------
-- 4 · Stock can arrive
--
-- `private.move_stock` is still the only writer of `items.stock`; this widens
-- the closed list of reasons by one. 'purchase' is a delivery landing, and it
-- is the first reason in the ledger that is *positive* by design — everything
-- before it either took stock off the shelf or corrected a count.
-- -----------------------------------------------------------------------------
alter table public.stock_movements drop constraint if exists stock_movements_reason_check;
alter table public.stock_movements add constraint stock_movements_reason_check
  check (reason in ('sale', 'return', 'count', 'correction', 'opening', 'import', 'purchase'));

-- Which delivery brought it in, so a shelf count can be read back to an
-- invoice. The same job `sale_id` does for the two reasons the register writes.
alter table public.stock_movements
  add column if not exists goods_receipt_id uuid
    references public.goods_receipts (id) on delete set null;

create index if not exists stock_movements_receipt_idx
  on public.stock_movements (goods_receipt_id)
  where goods_receipt_id is not null;

/**
 * `private.move_stock`, widened by one argument.
 *
 * Dropped and recreated rather than replaced: a new parameter is a new
 * signature, and a default would leave the old seven-argument function standing
 * beside this one as an overload that silently records no receipt. 0018 made
 * the same call when `record_sale` grew a customer.
 */
drop function if exists private.move_stock(uuid, uuid, numeric, text, uuid, text, uuid);

create or replace function private.move_stock(
  p_tenant uuid,
  p_item uuid,
  p_delta numeric,
  p_reason text,
  p_sale uuid,
  p_note text,
  p_by uuid,
  p_receipt uuid default null
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
  -- tablet's sale.
  update public.items
     set stock = stock + p_delta
   where id = p_item
     and tenant_id = p_tenant
  returning stock into v_after;

  -- Not this shop's item, or an item deleted since. Nothing to move.
  if not found then
    return null;
  end if;

  insert into public.stock_movements (
    tenant_id, item_id, reason, quantity, stock_after, sale_id,
    goods_receipt_id, note, created_by
  )
  values (
    p_tenant, p_item, p_reason, p_delta, v_after, p_sale,
    p_receipt, nullif(btrim(coalesce(p_note, '')), ''), p_by
  );

  return v_after;
end;
$fn$;

revoke execute on function private.move_stock(uuid, uuid, numeric, text, uuid, text, uuid, uuid)
  from public, anon, authenticated;

comment on function private.move_stock(uuid, uuid, numeric, text, uuid, text, uuid, uuid) is
  'The only writer of items.stock. Moves the count and records why, in the transaction that caused it. Returns the new count, or null for an item that is not this tenant''s.';

-- -----------------------------------------------------------------------------
-- 5 · Writing an order
--
-- Replay-safe on a client-minted id, like `record_sale`: a tablet that loses
-- the network mid-save and retries gets the same order back rather than a
-- second one with a second number.
--
-- **The lines are replaced wholesale, and only while nothing has been
-- received.** Once a delivery points at an order line, that line is frozen —
-- deleting it would orphan the receipt line that satisfied it, and a shop would
-- be looking at goods that arrived against an order that no longer asks for
-- them. An owner who needs to change a part-received order raises a new one,
-- which is also what they would do on paper.
-- -----------------------------------------------------------------------------
create or replace function public.save_purchase_order(
  p_tenant uuid,
  p_order_id uuid,
  p_supplier uuid,
  p_expected_on date,
  p_note text,
  p_status text,
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
  v_existing text;
  v_status text;
  v_line jsonb;
  v_subtotal numeric := 0;
  v_received integer;
begin
  if p_status not in ('draft', 'placed') then
    raise exception 'an order is saved as a draft or as placed, not as %', p_status
      using errcode = '22023';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'an order needs at least one line'
      using errcode = '22023';
  end if;

  -- The supplier is checked inside the transaction rather than taken on trust,
  -- exactly as `record_sale` checks its customer. The Server Action checks it
  -- too; this is the one that cannot be skipped.
  if not exists (
    select 1 from public.suppliers s
    where s.id = p_supplier and s.tenant_id = p_tenant
  ) then
    raise exception 'supplier % is not on this shop''s list', p_supplier
      using errcode = 'restrict_violation';
  end if;

  select b.id into v_branch
    from public.branches b
   where b.tenant_id = p_tenant and b.is_primary
   limit 1;

  if v_branch is null then
    raise exception 'this shop has no branch, so an order has nowhere to land'
      using errcode = 'restrict_violation';
  end if;

  select po.order_number, po.status into v_existing, v_status
    from public.purchase_orders po
   where po.id = p_order_id and po.tenant_id = p_tenant
     for update;

  if found then
    if v_status in ('closed', 'cancelled') then
      raise exception 'order % is %, so it cannot be changed', v_existing, v_status
        using errcode = 'restrict_violation';
    end if;

    -- Anything already delivered against this order freezes its lines.
    select count(*) into v_received
      from public.goods_receipt_lines grl
      join public.purchase_order_lines pol on pol.id = grl.purchase_order_line_id
     where pol.purchase_order_id = p_order_id;

    if v_received > 0 then
      raise exception 'order % has goods received against it, so its lines cannot be changed. Raise a new order for the rest.', v_existing
        using errcode = 'restrict_violation';
    end if;

    delete from public.purchase_order_lines
     where purchase_order_id = p_order_id and tenant_id = p_tenant;
    v_number := v_existing;
  else
    v_number := 'PO-' || lpad(private.next_number(p_tenant, 'purchase_order')::text, 5, '0');

    insert into public.purchase_orders (
      id, tenant_id, branch_id, supplier_id, order_number, status, created_by
    )
    values (p_order_id, p_tenant, v_branch, p_supplier, v_number, 'draft', p_by);
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    insert into public.purchase_order_lines (
      tenant_id, purchase_order_id, item_id, name_snapshot, unit, quantity,
      unit_cost, line_total
    )
    values (
      p_tenant,
      p_order_id,
      nullif(v_line->>'item_id', '')::uuid,
      v_line->>'name',
      v_line->>'unit',
      (v_line->>'quantity')::numeric,
      (v_line->>'unit_cost')::numeric,
      (v_line->>'line_total')::numeric
    );

    v_subtotal := v_subtotal + (v_line->>'line_total')::numeric;
  end loop;

  update public.purchase_orders
     set supplier_id = p_supplier,
         expected_on = p_expected_on,
         note = nullif(btrim(coalesce(p_note, '')), ''),
         status = p_status,
         subtotal = v_subtotal,
         -- Nothing is added to an order's total today. Freight is a fact about
         -- a delivery, not an intention, so it belongs on the receipt.
         total = v_subtotal
   where id = p_order_id and tenant_id = p_tenant;

  return jsonb_build_object('order_number', v_number, 'total', v_subtotal);
end;
$fn$;

revoke execute on function public.save_purchase_order(uuid, uuid, uuid, date, text, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.save_purchase_order(uuid, uuid, uuid, date, text, text, jsonb, uuid)
  to service_role;

comment on function public.save_purchase_order(uuid, uuid, uuid, date, text, text, jsonb, uuid) is
  'Writes one purchase order and its lines atomically, claiming a shop-wide number on first save. Refuses to change the lines of an order that has goods received against it.';

/**
 * Moving an order along without touching its lines.
 *
 * Separate from the save because closing or cancelling an order is something
 * you do to an order that is already part-received — and `save_purchase_order`
 * refuses to touch one of those, correctly.
 */
create or replace function public.set_purchase_order_status(
  p_tenant uuid,
  p_order uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_number text;
begin
  if p_status not in ('draft', 'placed', 'closed', 'cancelled') then
    raise exception '% is not a status an order can be in', p_status
      using errcode = '22023';
  end if;

  update public.purchase_orders
     set status = p_status
   where id = p_order and tenant_id = p_tenant
  returning order_number into v_number;

  if not found then
    raise exception 'order % is not this shop''s', p_order
      using errcode = 'restrict_violation';
  end if;

  return jsonb_build_object('order_number', v_number, 'status', p_status);
end;
$fn$;

revoke execute on function public.set_purchase_order_status(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_purchase_order_status(uuid, uuid, text)
  to service_role;

-- -----------------------------------------------------------------------------
-- 6 · Receiving a delivery
--
-- One function, one transaction: the number is claimed, the receipt and its
-- lines are written, the freight is apportioned, the shelf moves and the cost
-- price is set. Either all of it is true or none of it is — a receipt recorded
-- against a shelf that did not move is the hole 0022 closed for sales, and a
-- cost price updated without the receipt that justifies it is a margin nobody
-- can explain.
--
-- **The apportionment.** Freight and other costs are spread across the lines in
-- proportion to what each line is worth, and the rounding remainder goes onto
-- the last line — the identical arithmetic `record_sale` uses for a bill
-- discount, for the identical reason: `sum(landed_unit_cost × quantity)` must
-- come to the receipt total exactly, or the shop's stock valuation and its
-- purchase ledger disagree by a rupee that nobody can find.
--
-- Free goods are the edge that matters. A delivery of samples with a freight
-- charge has a subtotal of zero and no line value to spread against, so it is
-- spread by quantity instead. Refusing it would be wrong — the bhaara was
-- really paid, and it really is what those units cost.
--
-- **`items.cost_price` becomes the last landed cost**, not a moving average.
-- That is a deliberate product call: a shopkeeper quotes the rate off the last
-- invoice they were handed, and a weighted average is a number they cannot
-- check against any piece of paper in the shop. Past sales are untouched —
-- `sale_lines.cost_snapshot` stamped what each one cost at the time, which is
-- the whole reason that column exists.
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
begin
  -- Already recorded. The retry gets the same note back rather than a second
  -- one, and — the part that matters — does not put the delivery on the shelf
  -- twice.
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

  -- An order from a different supplier is not a typo, it is a crafted request
  -- or a genuine mix-up, and either way the delivery must not be filed under
  -- it: the order would then read as satisfied by goods somebody else sent.
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

  -- Materialised so the loop below can be indexed: the last line has to be told
  -- apart from the rest, because it carries the rounding remainder.
  select array_agg(elem), count(*)
    into v_lines, v_count
    from jsonb_array_elements(p_lines) as elem;

  for v_index in 1 .. v_count loop
    -- Checked here rather than left to the column constraint, because the
    -- landed cost is divided by this a few lines down and a zero would be a
    -- division error where the owner needs a sentence.
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
      -- The last line takes whatever is left, so the shares add to the extra
      -- exactly however the divisions rounded.
      v_share := v_extra - v_spread;
    elsif v_subtotal > 0 then
      v_share := round(v_extra * v_line_total / v_subtotal, 2);
    else
      -- Free goods with a real freight bill. Nothing to spread against but the
      -- units themselves, and the bhaara was still paid.
      v_share := round(v_extra * v_quantity / v_quantity_total, 2);
    end if;

    v_spread := v_spread + v_share;
    v_landed_line := v_line_total + v_share;
    -- Four decimals, matching the column: a carton of 48 sachets with Rs 300 of
    -- freight on it lands at a cost that two decimals would round away.
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

    -- Onto the shelf, in this transaction, with the delivery that brought it
    -- named. Null for a line whose item was deleted between the delivery being
    -- typed and saved: the receipt still stands and the supplier is still owed.
    perform private.move_stock(
      p_tenant, v_item, v_quantity, 'purchase', null, null, p_by, p_grn_id
    );

    -- And the cost column stops being a memory. Two decimals here because
    -- `items.cost_price` is numeric(12, 2) — the receipt line keeps the four.
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

comment on function public.record_receipt(uuid, uuid, uuid, uuid, date, text, text, numeric, numeric, jsonb, uuid) is
  'Records one delivery: claims its number, writes its lines, apportions freight into a landed unit cost, puts the stock on the shelf and updates items.cost_price — atomically. Replays safely on a repeated receipt id.';

-- -----------------------------------------------------------------------------
-- 7 · Who may read it
--
-- Rule 3 from 0001, five more times: tenant JWTs get a select policy and
-- nothing else, and every write above is a security-definer function granted to
-- the service role alone.
-- -----------------------------------------------------------------------------
revoke insert, update, delete, truncate on public.document_series from anon, authenticated;
revoke insert, update, delete, truncate on public.purchase_orders from anon, authenticated;
revoke insert, update, delete, truncate on public.purchase_order_lines from anon, authenticated;
revoke insert, update, delete, truncate on public.goods_receipts from anon, authenticated;
revoke insert, update, delete, truncate on public.goods_receipt_lines from anon, authenticated;

alter table public.document_series enable row level security;
alter table public.document_series force row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_orders force row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.purchase_order_lines force row level security;
alter table public.goods_receipts enable row level security;
alter table public.goods_receipts force row level security;
alter table public.goods_receipt_lines enable row level security;
alter table public.goods_receipt_lines force row level security;

-- The series is the one table here with no read policy at all. Nothing in the
-- console draws it — a shop reads its order numbers off the orders — and a
-- counter that leaks is a counter that tells a competitor how much a shop buys.
drop policy if exists purchase_orders_read_own on public.purchase_orders;
create policy purchase_orders_read_own on public.purchase_orders for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_platform_admin()));

drop policy if exists purchase_order_lines_read_own on public.purchase_order_lines;
create policy purchase_order_lines_read_own on public.purchase_order_lines for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_platform_admin()));

drop policy if exists goods_receipts_read_own on public.goods_receipts;
create policy goods_receipts_read_own on public.goods_receipts for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_platform_admin()));

drop policy if exists goods_receipt_lines_read_own on public.goods_receipt_lines;
create policy goods_receipt_lines_read_own on public.goods_receipt_lines for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_platform_admin()));

-- -----------------------------------------------------------------------------
-- 8 · The flag stops lying
--
-- 0020's rule, honoured: `purchase_orders` was false because there were none,
-- and it goes true in the migration that lands them. Both plans, because a shop
-- that cannot record what it paid for its stock has no cost control at all —
-- which is not a tier, it is a defect, the same argument 0022 made for the
-- stock ledger.
-- -----------------------------------------------------------------------------
update public.plans
   set features = features || jsonb_build_object('purchase_orders', true)
 where code in ('standard', 'premium');
