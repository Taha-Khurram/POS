-- =============================================================================
-- 0017_no_seeded_tree — a shop's tree starts empty
--
-- Apply manually after 0016_catalog_tree.sql.
--
-- 0016 planted six departments in every shop on the theory that an empty tree
-- is an onboarding wall. It is not; it is a blank page, and the six were worse
-- than nothing. "Beverages, Grocery, Dairy & bakery, Snacks & confectionery,
-- Household, Personal care" is a supermarket's aisle list. A cloth house opens
-- Products & stock and sees six departments it will never use and has to delete
-- one at a time before it can type "Lawn" — which is more work than starting
-- from nothing, and it teaches the owner on their first screen that the
-- software does not know what shop they run.
--
-- So the seed goes, the trigger that plants it on every new tenant goes, and
-- the rows it already planted go with them.
--
-- What this costs: an item that was filed under one of the six is unfiled by
-- this migration — `department` and `category` go back to null rather than
-- pointing at a department that is no longer in the tree. Nothing else about
-- the item changes: its price, its stock, its barcode and every receipt it is
-- already on are untouched, and the owner picks a department the next time they
-- open it. A dangling name would have been the worse answer — `tree-actions.ts`
-- refuses to delete a department with items under it precisely so that this
-- cannot happen by accident, and a migration should not do behind the screen
-- what the screen forbids.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · No new shop gets a tree it did not ask for
-- -----------------------------------------------------------------------------
drop trigger if exists tenants_seed_catalog_tree on public.tenants;
drop function if exists private.seed_catalog_tree_on_tenant();
drop function if exists private.seed_catalog_tree(uuid);

-- -----------------------------------------------------------------------------
-- 2 · The rows 0016 already planted
--
-- Matched on the name *and* on the sort order, which is the tight predicate: the
-- seed wrote 1–6, 0016's backfill of names it found on existing items wrote 90,
-- and anything an owner has added since gets last+1. A shop that has genuinely
-- named a department "Grocery" of its own accord since applying 0016 therefore
-- keeps it.
--
-- The categories under each one go through the composite foreign key. They are
-- 0016's too — no shop has had time to add its own underneath a department it
-- is about to be shown for the first time.
-- -----------------------------------------------------------------------------
-- Two statements and no temporary table: a migration applied by hand in the SQL
-- editor is not always inside a transaction, and `on commit drop` needs one.

-- Unfile first, while the tree still names them. Scoped by tenant as well as by
-- name, so one shop's items are never touched by another shop's tree.
update public.items i
set department = null,
    category = null
where i.department is not null
  and exists (
    select 1
    from public.departments d
    where d.tenant_id = i.tenant_id
      and d.name = i.department
      and d.sort_order between 1 and 6
      and d.name in (
        'Beverages',
        'Grocery',
        'Dairy & bakery',
        'Snacks & confectionery',
        'Household',
        'Personal care'
      )
  );

delete from public.departments d
where d.sort_order between 1 and 6
  and d.name in (
    'Beverages',
    'Grocery',
    'Dairy & bakery',
    'Snacks & confectionery',
    'Household',
    'Personal care'
  );

-- -----------------------------------------------------------------------------
-- 3 · What the screen says instead
--
-- Nothing to do here; the Categories tab already draws an empty tree as an
-- invitation rather than as an error, and the add-product sheet refuses to save
-- an item until there is a department to put it in. This comment exists so that
-- the next person to wonder why a fresh shop has no departments finds the
-- answer in the migration that made it so.
-- -----------------------------------------------------------------------------
comment on table public.departments is
  'The shop''s own top level, drawn as tiles on the register''s home grid. Starts empty: 0017 removed the seeded six.';
