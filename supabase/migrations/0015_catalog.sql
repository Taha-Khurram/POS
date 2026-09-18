-- =============================================================================
-- 0015_catalog — the item list becomes rows
--
-- Apply manually after 0014_audit_log_outlives_its_actor.sql.
--
-- `items` has existed since 0008, but only as much of an item as the register
-- needed to print a line: a name, a unit and a selling price. Everything else
-- Products & stock draws — the cost, the shelf count, the barcode, where it
-- sits in the tree — lived in `lib/pos/catalog.ts` as fourteen sample constants.
-- This migration gives those a column each, so the screen stops describing a
-- shop and starts describing this one.
--
-- Nothing here changes who may write. `items` was revoked from `anon` and
-- `authenticated` in 0008 and keeps its one select policy, so the catalog is
-- read through the shop's own JWT and written only by
-- `app/(app)/app/inventory/actions.ts` on the service role — rule 3 from 0001,
-- unchanged.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · The columns
--
-- `cost_price` is the one that earns the migration on its own: margin is the
-- number an owner opens this screen for, and it cannot be derived from a
-- selling price. Everything else is either what the shelf label says or what
-- decides whether the bell rings.
-- -----------------------------------------------------------------------------
alter table public.items
  -- The manufacturer's code, or the in-store EAN-13 Flo minted in the 200
  -- range. Null for a loose or handmade item that never had either.
  add column if not exists barcode text,
  -- The tree, stored flat. Three text columns rather than a `categories` table
  -- because the vocabulary is `lib/pos/catalog.ts`'s fixed six departments
  -- today; a shop that needs its own tree gets the table then, and these
  -- columns become the backfill.
  add column if not exists department text,
  add column if not exists category text,
  add column if not exists subcategory text,
  -- Pieces, a weight off a scale, or a grid of sizes. The register asks for a
  -- quantity differently for each.
  add column if not exists tracking text not null default 'unit',
  add column if not exists cost_price numeric(12, 2) not null default 0,
  -- Per cent, and inclusive: `selling_price` already contains it, which is how
  -- every price in a Pakistani shop is quoted.
  add column if not exists tax_rate numeric(5, 2) not null default 0,
  -- Decimal, because 84.5 kg of sugar is a legitimate count. Deliberately
  -- un-constrained at the bottom: a shop that sold twelve and had ten goes
  -- negative, and a database that refuses to record that is a database that
  -- hides a theft.
  add column if not exists stock numeric(12, 3) not null default 0,
  -- Per item, never one number for the whole shop: three bottles of shampoo is
  -- fine, three crates of Coke is not.
  add column if not exists low_at numeric(12, 3) not null default 0,
  add column if not exists supplier text,
  -- How many size/colour rows sit under this item. Null unless tracking is
  -- 'variant'; the rows themselves arrive with `item_variants`.
  add column if not exists variant_count smallint;

-- -----------------------------------------------------------------------------
-- 2 · What those columns may hold
--
-- Dropped first so the migration can be re-applied, the same way 0011 replaced
-- the unit check — Postgres has no `add constraint if not exists`.
-- -----------------------------------------------------------------------------
alter table public.items drop constraint if exists items_tracking_check;
alter table public.items add constraint items_tracking_check
  check (tracking in ('unit', 'weight', 'variant'));

alter table public.items drop constraint if exists items_cost_price_check;
alter table public.items add constraint items_cost_price_check
  check (cost_price >= 0);

alter table public.items drop constraint if exists items_tax_rate_check;
alter table public.items add constraint items_tax_rate_check
  check (tax_rate >= 0 and tax_rate <= 100);

alter table public.items drop constraint if exists items_low_at_check;
alter table public.items add constraint items_low_at_check
  check (low_at >= 0);

-- Loose on purpose. A barcode is checked for a UPC/EAN shape where it is typed,
-- and warned about rather than refused — plenty of shops carry legacy codes off
-- an old till that are neither, and a constraint that rejects them is a
-- constraint that stops an import of four hundred items over one row.
alter table public.items drop constraint if exists items_barcode_check;
alter table public.items add constraint items_barcode_check
  check (barcode is null or length(btrim(barcode)) > 0);

alter table public.items drop constraint if exists items_variant_count_check;
alter table public.items add constraint items_variant_count_check
  check (variant_count is null or variant_count > 0);

-- -----------------------------------------------------------------------------
-- 3 · One code, one item
--
-- The point of a barcode is that scanning it is unambiguous, so two items in
-- one shop carrying the same code is not a preference — it is a till that rings
-- up the wrong thing. Partial, because the shops that need this most are the
-- ones with a hundred loose items carrying no code at all, and nulls must not
-- collide with each other.
--
-- Scoped to the tenant, like `items_tenant_sku_idx` above it: two shops both
-- selling Coca-Cola share the manufacturer's code and always will.
-- -----------------------------------------------------------------------------
create unique index if not exists items_tenant_barcode_idx
  on public.items (tenant_id, barcode)
  where barcode is not null;

-- The list is read whole and sorted by name, and the tree counts group by
-- department. One index over the three keys serves both without a sort.
create index if not exists items_tenant_department_idx
  on public.items (tenant_id, department, category);

comment on table public.items is
  'The shop''s catalog. Read through the tenant JWT; written by Server Actions on the service role.';
comment on column public.items.stock is
  'Units on the shelf. May go negative — an oversold item is a fact, not an invalid row.';
comment on column public.items.tax_rate is
  'Per cent, inclusive: selling_price already contains it.';
