-- =============================================================================
-- 0027_suppliers — the party you buy from becomes a row
--
-- Apply manually after 0026_shifts.sql.
--
-- `items.supplier` has been a text column since 0015, and for a list of four
-- hundred items that is four hundred independently typed spellings of the same
-- six distributors. "Shan Foods", "Shan foods", "SHAN" and "Shan Foods (Ravi
-- Rd)" are one man with one phone number and one running account, and a text
-- column cannot be asked any of the questions a shop actually has: what do I
-- owe him, what did I last pay for the masala, who do I ring when the shelf is
-- empty on a Friday.
--
-- So the supplier becomes a row, the way the customer did in 0018, and for the
-- same reason: everything purchasing needs afterwards — an order, a delivery, a
-- landed cost, a balance — has to hang off something with an identity.
--
-- **The name is the identity here, and the phone is not.** That is the opposite
-- of `customers`, deliberately. A customer is a person and two of them are
-- called Bilal; a supplier is a business, you know it by its name, and the man
-- who answers the phone changes twice a year. Two rows called Ravi Trading is
-- two ledgers for one party and neither of them balances.
--
-- **`items.supplier` is dropped, not left beside the new column.** A text
-- column and a foreign key holding the same fact is the drift 0018's header
-- complains about — the first correction that only lands on one of them makes
-- the item list and the purchase history disagree about who supplies the sugar.
-- The distinct spellings are lifted into rows first, inside this migration, so
-- no shop loses what it typed. `Product.supplier` stays a name in TypeScript,
-- read through the join, so the screens that only ever wanted the word do not
-- have to change.
--
-- Everything obeys 0001: `tenant_id not null`, RLS enabled and forced, select
-- only for tenant JWTs, every write through a Server Action on the service
-- role.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · The suppliers
-- -----------------------------------------------------------------------------
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 80),
  -- The person you actually ring, who is not the business. "Asif bhai" against
  -- "Ravi Trading" — a shop keeps both and dials the first.
  contact_name text check (contact_name is null or length(btrim(contact_name)) <= 80),
  -- Stored normalised by the same `normalisePhone` the customer list uses, so a
  -- number typed as +92 300 1234567 here and 0300-1234567 on an invoice are one
  -- number. Not unique, unlike a customer's: one distributor's office number is
  -- on the card of all four of his salesmen.
  phone text check (phone is null or phone ~ '^\+?[0-9]{7,15}$'),
  email text check (email is null or length(btrim(email)) between 3 and 160),
  -- One field, for the reason `customers.address` is one field. A shop writes
  -- "Godown 12, Akbari Mandi" and no amount of modelling improves on it.
  address text check (address is null or length(btrim(address)) <= 200),
  -- The tax number, because the moment a shop claims input tax the invoice has
  -- to carry the supplier's NTN or STRN and nobody remembers it.
  tax_number text check (tax_number is null or length(btrim(tax_number)) <= 40),
  -- How long you get to pay. Zero is cash on delivery, which is most of a
  -- kiryana's buying. It is a note to the owner and not a rule the console
  -- enforces: a supplier who gives thirty days does not mind the thirty-first.
  payment_terms_days integer not null default 0
    check (payment_terms_days between 0 and 365),
  notes text check (notes is null or length(btrim(notes)) <= 500),
  -- Off takes them out of every picker and keeps every order and delivery they
  -- are on — the same bargain `items.is_active` and `customers.is_active`
  -- strike. A distributor who has shut down is not a distributor whose last two
  -- years of purchases should stop grouping.
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One name, one supplier. Trimmed, single-spaced and lower-cased, because the
-- whole point of the table is that "Shan Foods", "shan foods " and "Shan  Foods"
-- were always one party — an index that let any of them in alongside the others
-- would rebuild the problem this migration exists to fix, one row at a time.
--
-- Those are exactly the three things `foldName` in `lib/pos/supplier.ts` does,
-- and they have to stay exactly those three: the sheet folds a name that way to
-- warn before the save, and a browser that folded harder than the index would
-- refuse a name the database would happily take.
create unique index if not exists suppliers_tenant_name_idx
  on public.suppliers (tenant_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')));

-- The list is read whole and sorted by name, and every picker reads the active
-- ones the same way. One index over both, exactly like `customers`.
create index if not exists suppliers_tenant_active_name_idx
  on public.suppliers (tenant_id, is_active, name);

drop trigger if exists suppliers_set_updated_at on public.suppliers;
create trigger suppliers_set_updated_at before update on public.suppliers
  for each row execute function private.set_updated_at();

comment on table public.suppliers is
  'Who the shop buys from. The name is the identity — unlike customers, where the phone is — because a supplier is a business and the man who answers its phone changes.';

-- -----------------------------------------------------------------------------
-- 2 · The item points at one
--
-- `on delete set null`, so retiring a supplier never takes an item off the
-- shelf with it. The item keeps selling; it just stops saying where it came
-- from, which is the honest state of affairs.
-- -----------------------------------------------------------------------------
alter table public.items
  add column if not exists supplier_id uuid
    references public.suppliers (id) on delete set null;

-- "What does this supplier supply?" is the one question the supplier record
-- asks of `items`, and an unindexed foreign key makes the delete above scan the
-- whole catalog as well.
create index if not exists items_tenant_supplier_idx
  on public.items (tenant_id, supplier_id)
  where supplier_id is not null;

-- -----------------------------------------------------------------------------
-- 3 · What every shop already typed
--
-- One row per distinct spelling that survives folding — trimmed, single-spaced
-- and compared without case, which is the same normalisation the unique index
-- above enforces from here on. A shop with "Shan Foods" on ninety items and
-- "shan foods" on eleven gets one supplier and a hundred and one items pointing
-- at it, which is the whole gain.
--
-- `distinct on` keeps the first spelling in alphabetical order as the stored
-- name. There is no right answer between two spellings of the same word, and
-- picking one deterministically beats picking one at random, because the owner
-- is going to correct it once on the supplier record and be done.
-- -----------------------------------------------------------------------------
insert into public.suppliers (tenant_id, name)
select distinct on (i.tenant_id, lower(regexp_replace(btrim(i.supplier), '\s+', ' ', 'g')))
       i.tenant_id,
       regexp_replace(btrim(i.supplier), '\s+', ' ', 'g')
  from public.items i
 where i.supplier is not null
   and length(btrim(i.supplier)) between 2 and 80
 order by i.tenant_id,
          lower(regexp_replace(btrim(i.supplier), '\s+', ' ', 'g')),
          regexp_replace(btrim(i.supplier), '\s+', ' ', 'g')
on conflict do nothing;

update public.items i
   set supplier_id = s.id
  from public.suppliers s
 where s.tenant_id = i.tenant_id
   and i.supplier is not null
   and lower(regexp_replace(btrim(s.name), '\s+', ' ', 'g'))
       = lower(regexp_replace(btrim(i.supplier), '\s+', ' ', 'g'))
   and i.supplier_id is null;

-- The one source of truth is the foreign key from here on. A supplier spelling
-- shorter than two characters or longer than eighty had no row made for it and
-- goes with the column — it was never a supplier, it was a stray keystroke in a
-- spreadsheet cell.
alter table public.items drop column if exists supplier;

-- -----------------------------------------------------------------------------
-- 4 · Who may read it
--
-- Rule 3 from 0001: tenant JWTs get a select policy and nothing else. Every
-- write is a Server Action on the service role.
-- -----------------------------------------------------------------------------
revoke insert, update, delete, truncate on public.suppliers
  from anon, authenticated;

alter table public.suppliers enable row level security;
alter table public.suppliers force row level security;

drop policy if exists suppliers_read_own on public.suppliers;
create policy suppliers_read_own on public.suppliers for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_platform_admin()));

-- -----------------------------------------------------------------------------
-- 5 · Who may change it
--
-- One permission for the whole of purchasing — suppliers, orders and the
-- deliveries against them — rather than three switches for one job. A shop that
-- lets somebody receive a delivery lets them say who it came from; the owner is
-- choosing a person here, not assembling a role out of parts.
--
-- It is deliberately *not* `can_edit_items`, even though receiving a delivery
-- moves stock and changes a cost price. Buying is the owner's or the manager's
-- side of the shop: the cashier who is trusted to correct a shelf count at the
-- counter is not thereby trusted to enter what the shop paid for it.
--
-- Default off for a cashier and on for a manager — the same shape
-- `can_edit_items` and `can_view_reports` already carry.
-- -----------------------------------------------------------------------------
alter table public.role_permissions
  add column if not exists can_manage_purchasing boolean not null default false;

update public.role_permissions
   set can_manage_purchasing = true
 where access_level = 'manager';
