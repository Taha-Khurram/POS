-- =============================================================================
-- 0034_no_restaurant — Flo is a supermarket till, and only that
--
-- Apply manually after 0033_restaurant.sql.
--
-- Two things, and they are one decision.
--
-- **The dining room goes.** `0033` built a floor map, an order per table, a
-- kitchen ticket and modifiers, and said in its own header that a restaurant is
-- "a different product from a retail counter". It is, and it is not the product
-- being built: Flo is a supermarket till — aisles, barcodes, a trolley at a
-- counter. Six tables and seven functions are dropped rather than left standing
-- unread, for the reason `0018` gave when it took the khata out of the schema
-- instead of off the screen, and `0016` gave when it dropped
-- `items.subcategory`: a table nothing writes is how a product ends up claiming
-- something it cannot do, and the next person to read the schema cannot tell a
-- dead branch from a quiet one.
--
-- Nothing is lost that anybody had. Every one of the six tables is empty at the
-- time of writing — the module shipped days ago into a private preview and no
-- shop ever laid a floor out. Were that not true this migration would have to
-- be an export first, because a settled order is a receipt somebody holds.
--
-- **The shop type narrows to one value.** `tenants.shop_type` offered seven
-- trades since `0001` and the console served one of them. A dhaba needs the
-- floor this migration deletes and a cloth house needs a size/colour grid at
-- the till, so the word on the dropdown was a promise nothing kept. The check
-- constraint is the control and `SHOP_TYPES` in `lib/pos/settings-options.ts` is
-- the same list written for the browser; both now hold exactly 'supermarket'.
--
-- `orders.shop_type` and `leads.shop_type` are deliberately NOT rewritten. They
-- are free text with no constraint, and they record what somebody said about
-- their own shop when they asked for a demo. Rewriting that is rewriting the
-- lead, not migrating a schema — and whoever turns an order into a tenant will
-- be refused by the constraint above, which is the correct place to find out
-- that Flo does not run a dhaba.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · The shop type
--
-- Constraint off, rows across, constraint back on — in that order, because the
-- old check allowed seven trades and 'supermarket' was not one of them. Writing
-- the update first reads like the careful way round and is refused by the very
-- constraint being replaced, which is how a migration is applied at midnight
-- and rolled back at five past.
-- -----------------------------------------------------------------------------

alter table public.tenants drop constraint if exists tenants_shop_type_check;

update public.tenants
   set shop_type = 'supermarket', updated_at = now()
 where shop_type <> 'supermarket';

alter table public.tenants add constraint tenants_shop_type_check
  check (shop_type in ('supermarket'));

comment on column public.tenants.shop_type is
  'One value, matching SHOP_TYPES in lib/pos/settings-options.ts. Flo is a supermarket till; a trade that needs a floor map or a variant grid is not served by adding a word here.';

-- -----------------------------------------------------------------------------
-- 2 · The floor
--
-- Functions before tables, because each one names the tables in its body and a
-- dropped table leaves a function that fails on first call rather than at
-- migration time. Signatures in full: these are overload-addressed and a bare
-- name would refuse to resolve.
-- -----------------------------------------------------------------------------

drop function if exists public.settle_table_order(uuid, uuid, uuid, uuid, date, jsonb, numeric, numeric, uuid);
drop function if exists public.cancel_table_order(uuid, uuid, text, uuid);
drop function if exists public.move_table_order(uuid, uuid, uuid);
drop function if exists public.void_order_line(uuid, uuid, text, uuid);
drop function if exists public.send_to_kitchen(uuid, uuid, uuid, text);
drop function if exists public.add_order_lines(uuid, uuid, jsonb, uuid);
drop function if exists public.open_table_order(uuid, uuid, uuid, text, smallint, uuid, uuid);

-- Children before parents, so no `cascade` is needed anywhere. A `cascade` on a
-- drop this size is how a migration takes something with it that nobody listed
-- — `table_order_lines.kot_id` points at `kots`, and the order below is the one
-- that never has to find that out.
drop table if exists public.table_order_line_modifiers;
drop table if exists public.table_order_lines;
drop table if exists public.kots;
drop table if exists public.table_orders;
drop table if exists public.item_modifiers;
drop table if exists public.dining_tables;

-- -----------------------------------------------------------------------------
-- 3 · The numbering
--
-- `document_series` goes back to the two kinds `0028` gave it. The rows go
-- before the constraint narrows, or a shop that had claimed T-00001 fails it.
-- Deleting a counter is safe here and nowhere else: the orders it numbered are
-- gone too, so there is no receipt left pointing at a number that could be
-- claimed twice.
-- -----------------------------------------------------------------------------

delete from public.document_series where kind in ('table_order', 'kot');

alter table public.document_series drop constraint if exists document_series_kind_check;
alter table public.document_series add constraint document_series_kind_check
  check (kind in ('purchase_order', 'goods_receipt'));

-- -----------------------------------------------------------------------------
-- 4 · The switch
--
-- `tenant_settings.restaurant_mode` was the one setting that decided which
-- *modules* a shop had rather than how a figure was written. There are no
-- modules behind it now, and `moduleAccess` no longer takes the shop at all —
-- which hands the owner's rail back the read it used to cost.
-- -----------------------------------------------------------------------------

alter table public.tenant_settings drop column if exists restaurant_mode;

-- -----------------------------------------------------------------------------
-- 5 · The plans
--
-- `0020`'s rule was that a flag is a promise the console can be held to, and
-- `0033` raised this one on both plans in the same migration that landed the
-- feature. The feature is gone, so the flag is removed outright rather than set
-- back to false: false says "not yet, and on a tier we may sell you", and the
-- honest answer is on /roadmap under what Flo will never build.
-- -----------------------------------------------------------------------------

update public.plans
   set features = features - 'restaurant_mode',
       updated_at = now()
 where features ? 'restaurant_mode';
