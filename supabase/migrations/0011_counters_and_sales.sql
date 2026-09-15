-- =============================================================================
-- 0011_counters_and_sales — many counters, and sales that are actually recorded
--
-- Apply manually after 0010_counter.sql. Two changes that only make sense
-- together: a shop gets more than one counter, and the register starts writing
-- what it rings up. The second is forced by the first — "what did counter 2
-- take today" cannot be answered from a receipt that was only ever printed.
--
-- `counters` was one row per shop in 0010, keyed by tenant_id. It becomes a
-- real table with its own id here. The existing row survives the change and
-- keeps everything on it; it simply gains an id, a branch, and its own receipt
-- series.
--
-- Everything still obeys 0001: tenant_id not null, RLS enabled and forced,
-- select-only for tenant JWTs. Sales are written by `public.record_sale`, a
-- security-definer function the service role calls from a Server Action — the
-- same shape as `public.consume_rate_limit` in 0006, and for the same reason:
-- the work has to be one atomic statement or the receipt number and the sale
-- can come apart.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · Counters, plural
-- -----------------------------------------------------------------------------
alter table public.counters drop constraint counters_pkey;

alter table public.counters
  add column id uuid not null default gen_random_uuid(),
  -- Which till in which shop. Nullable only so the backfill below can run in
  -- two steps; `record_sale` refuses a counter that has none, because
  -- `sales.branch_id` is not-null and a sale has to land somewhere.
  add column branch_id uuid references public.branches (id) on delete restrict,
  -- The counter's own receipt series. Kept here rather than in the browser so
  -- that two tablets pointed at the same counter cannot issue the same number,
  -- which is exactly what 0010's localStorage serial could do.
  add column receipt_day date,
  add column receipt_serial integer not null default 0 check (receipt_serial >= 0),
  -- The order they are listed and picked in. A shop names its tills by where
  -- they stand, not alphabetically.
  add column sort_order smallint not null default 1;

alter table public.counters add constraint counters_pkey primary key (id);

-- The prefix is what tells two counters' receipts apart, so it has to be
-- unique within the shop or the series is decoration. It is already
-- upper-case-only by check constraint, so no case folding is needed here.
create unique index counters_tenant_prefix_idx
  on public.counters (tenant_id, receipt_prefix);
create index counters_tenant_active_idx
  on public.counters (tenant_id, is_active, sort_order);

-- -----------------------------------------------------------------------------
-- 2 · Every shop gets a branch
--
-- Nothing has read `branches` until now and no screen creates one, but
-- `sales.branch_id` has been not-null since 0008 and a register cannot open
-- against a table with no rows. One primary branch per shop, named after the
-- shop's own city, is the honest default for a business that has exactly one.
-- -----------------------------------------------------------------------------
insert into public.branches (tenant_id, name, city, is_primary)
select t.id, 'Main branch', t.city, true
from public.tenants t
where not exists (
  select 1 from public.branches b where b.tenant_id = t.id
);

update public.counters c
   set branch_id = (
     select b.id
     from public.branches b
     where b.tenant_id = c.tenant_id
     -- Primary first, then oldest. A shop that somehow has branches but none
     -- marked primary still gets a deterministic answer.
     order by b.is_primary desc, b.created_at
     limit 1
   )
 where c.branch_id is null;

-- -----------------------------------------------------------------------------
-- 3 · Sales know which counter rang them, and which trading day they belong to
--
-- `business_day` is stored rather than derived at read time. The day a shop
-- closes its books on is `tenant_settings.day_ends_at` — a dhaba that shuts at
-- 1 am wants that sale on the day it opened — and deriving that from
-- `created_at` at every read means every report has to agree about a setting
-- that can change. Stamped once, by the register, at the moment of sale.
-- -----------------------------------------------------------------------------
alter table public.sales
  add column counter_id uuid references public.counters (id) on delete restrict,
  add column business_day date;

update public.sales
   set business_day = (created_at at time zone 'Asia/Karachi')::date
 where business_day is null;

alter table public.sales alter column business_day set not null;

create index sales_tenant_day_idx on public.sales (tenant_id, business_day);
create index sales_counter_day_idx on public.sales (counter_id, business_day);

-- -----------------------------------------------------------------------------
-- 4 · Units the catalog actually uses
--
-- 0008 allowed four. `lib/pos/catalog.ts` has eight, because a kiryana sells
-- masala by the packet and eggs by the dozen. 'kilo' stays on the list so that
-- anything written under the old constraint is still valid.
-- -----------------------------------------------------------------------------
alter table public.items drop constraint if exists items_unit_check;
alter table public.items add constraint items_unit_check
  check (unit in ('piece', 'kg', 'gram', 'litre', 'dozen', 'packet', 'carton', 'plate', 'kilo'));

alter table public.sale_lines drop constraint if exists sale_lines_unit_check;
alter table public.sale_lines add constraint sale_lines_unit_check
  check (unit in ('piece', 'kg', 'gram', 'litre', 'dozen', 'packet', 'carton', 'plate', 'kilo'));

-- -----------------------------------------------------------------------------
-- 5 · Recording a sale
--
-- One function, one transaction. Splitting this across three statements from
-- the Server Action would mean a receipt number claimed against a sale that
-- then failed to insert — a hole in the shop's series that nobody can account
-- for, which is the first thing an auditor asks about.
--
-- It is deliberately NOT the authority on prices. The Server Action re-prices
-- every line from the catalog before calling this, so the amounts below are
-- already server-computed; what this owns is the series, the atomicity, and
-- the check that the counter is one of this tenant's open ones.
--
-- `p_sale_id` is generated by the browser so that a retry after a dropped
-- connection replays rather than double-records. A second call with the same
-- id returns the receipt the first one issued and claims no new number.
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
  p_lines jsonb
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
    id, tenant_id, branch_id, counter_id, receipt_number, business_day,
    status, subtotal, discount_total, total, created_by
  )
  values (
    p_sale_id, p_tenant, v_branch, p_counter, v_receipt, p_business_day,
    'completed', p_subtotal, 0, p_total, p_created_by
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
      -- Null until the catalog is real rows rather than sample constants.
      -- `name_snapshot` is what the receipt was printed from either way, which
      -- is why 0008 made it not-null and the item reference nullable.
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

revoke execute on function public.record_sale(uuid, uuid, uuid, date, uuid, numeric, numeric, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_sale(uuid, uuid, uuid, date, uuid, numeric, numeric, text, jsonb)
  to service_role;

comment on function public.record_sale(uuid, uuid, uuid, date, uuid, numeric, numeric, text, jsonb) is
  'Records one register sale and claims its counter receipt number atomically. Replays safely on a repeated sale id.';
