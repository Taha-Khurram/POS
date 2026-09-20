-- =============================================================================
-- 0025_held_bills — the queue stops waiting for the dahi
--
-- Apply manually after 0024_returns.sql.
--
-- One customer goes back for dahi and the whole queue waits, because the till
-- holds exactly one bill and it is whichever one is on the screen. Every shop
-- with more than two people in it at 6 pm needs to be able to put a bill down
-- and pick it up again, and the cashier who cannot works around it the usual
-- way: they keep the shopping on the counter, ring up the next customer on a
-- second device, or write the first bill on paper. All three end with a sale
-- that is not what happened.
--
-- **A held bill is not a sale, so it is not on `sales`.** The column was there
-- — `status` has allowed 'held' since 0008 and nothing has ever written it —
-- and using it would have been the cheap thing to do and the wrong one.
-- `sales.receipt_number` is not null and unique per shop, so a held bill on
-- that table either burns a number out of the counter's series before anybody
-- has paid, or carries a fake one that some future query counts. A number that
-- was claimed and never settled is a hole in the shop's receipt book, which is
-- the exact thing `record_sale` was built in one transaction to avoid. And
-- every reader in the console would have to learn to exclude a status — the
-- takings, the dashboard, all five report tabs, the history — with the one
-- that forgets being the one that overstates the day.
--
-- So a parked bill is its own table, holding what the cashier had on the
-- screen and nothing more: item ids, quantities, who it was for, what was
-- agreed off it. No prices. **Resuming re-prices from the catalog**, the same
-- way `recordSale` does, because a bill parked before a rate change and settled
-- after it must be settled at the rate on the shelf — a stored price would be
-- a quiet way to sell at yesterday's cost.
--
-- 'held' therefore comes off `sales.status` in the same migration, rather than
-- being left standing as a value nothing writes. A column that allows a state
-- the software cannot produce is how the next person to read the schema builds
-- the wrong thing.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · The parked bill
--
-- `id` has no default: it is minted on the tablet like a sale's, so holding the
-- same bill twice through a flaky connection is one row rather than two.
--
-- `counter_id` cascades. A bill parked at a till that has since been deleted
-- has nowhere to be picked up — the counter is the whole of where it lives, and
-- an orphan row would show up under a till it was never taken at.
-- -----------------------------------------------------------------------------
create table if not exists public.held_bills (
  id uuid primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  counter_id uuid not null references public.counters (id) on delete cascade,
  -- What the cashier will recognise it by across a busy counter. "Blue shirt",
  -- "the aunty with the pram", "Bilal". Optional, because a shop in a rush will
  -- not type one and the screen can fall back to the time and the total.
  label text check (label is null or length(btrim(label)) <= 60),
  customer_id uuid references public.customers (id) on delete set null,
  -- [{ item_id, quantity }] and nothing else. No prices: resuming re-prices
  -- from the catalog, because a bill parked before a rate change and settled
  -- after it must be settled at the rate on the shelf.
  lines jsonb not null default '[]'::jsonb
    check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 200),
  -- What was agreed off it, as it was agreed: 'amount' or 'percent', and the
  -- figure. Stored as said rather than as rupees for the reason the lines carry
  -- no prices — "ten per cent" against a bill that changes is ten per cent of
  -- the new one, and the ceiling is checked again when it settles.
  discount_kind text not null default 'amount'
    check (discount_kind in ('amount', 'percent')),
  discount_value numeric(12, 2) not null default 0 check (discount_value >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The only question the screen asks: what is parked at this till, oldest first,
-- because the bill that has been waiting longest is the one somebody is about
-- to ask about.
create index if not exists held_bills_counter_idx
  on public.held_bills (tenant_id, counter_id, created_at);

drop trigger if exists held_bills_set_updated_at on public.held_bills;
create trigger held_bills_set_updated_at before update on public.held_bills
  for each row execute function private.set_updated_at();

comment on table public.held_bills is
  'A bill put down at a counter and not yet paid for. Deliberately not a row on sales: a held bill has no receipt number, and claiming one before anybody pays is a hole in the shop''s series.';
comment on column public.held_bills.lines is
  'Item ids and quantities only. Resuming re-prices from the catalog, so a bill parked before a rate change settles at the rate on the shelf.';

-- -----------------------------------------------------------------------------
-- 2 · `sales` stops allowing a state nothing can produce
--
-- 'held' was never written and now never will be. Dropping it is the same
-- decision `0024` made about 'returned' and `0016` made about
-- `items.subcategory`: a schema that allows what the software cannot do is how
-- the next person builds the wrong thing.
--
-- Safe by inspection — `record_sale` and `record_return` write 'completed' and
-- 'refund' and nothing else has ever been able to insert a sale — but written
-- as a guarded update anyway, because a constraint that fails halfway through a
-- migration on somebody's production data is a bad afternoon.
-- -----------------------------------------------------------------------------
update public.sales set status = 'completed' where status = 'held';

alter table public.sales drop constraint if exists sales_status_check;
alter table public.sales add constraint sales_status_check
  check (status in ('completed', 'refund'));

comment on column public.sales.status is
  'completed or refund. A parked bill lives on held_bills and never here, because it has no receipt number and claiming one before anybody pays is a hole in the series.';

-- -----------------------------------------------------------------------------
-- 3 · Who may read it
--
-- Rule 3 from 0001: a select policy for tenant JWTs and nothing else. The till
-- reads its own counter's parked bills through this; the writes go through
-- `app/(app)/app/register/hold-actions.ts` on the service role.
--
-- Scoped to the tenant and not to the counter. The counter is the screen's
-- filter, not a security boundary — one shop's staff may see one shop's parked
-- bills, and a manager looking at why counter 2 has eleven of them is doing
-- their job.
-- -----------------------------------------------------------------------------
revoke insert, update, delete, truncate on public.held_bills
  from anon, authenticated;

alter table public.held_bills enable row level security;
alter table public.held_bills force row level security;

drop policy if exists held_bills_read_own on public.held_bills;
create policy held_bills_read_own on public.held_bills for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_platform_admin()));
