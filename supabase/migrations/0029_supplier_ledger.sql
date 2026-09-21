-- =============================================================================
-- 0029_supplier_ledger — what the shop owes, and to whom
--
-- Apply manually after 0028_purchasing.sql.
--
-- `0028` records what a delivery cost. It records nothing about whether it was
-- paid for, which means the one question a shopkeeper asks about a supplier —
-- *kitna dena hai* — is the one the console cannot answer. Every shop already
-- answers it, on a page at the back of a register book with the distributor's
-- name at the top, and that page is what this migration is.
--
-- **It is a running account, not invoice matching.** A payment is not applied
-- to a particular delivery, because that is not how anybody here pays: Ravi
-- Trading's man comes on a Thursday and takes fifty thousand rupees against the
-- account, not against invoice 4821. Proper accounts-payable allocation would
-- mean a join table, a screen for it, and a shopkeeper reconciling line by line
-- — for a number they already keep in their head as one figure.
--
-- **Ageing is derived, never stored.** The oldest unpaid delivery is worked out
-- by walking the deliveries oldest first and spending the payments against them
-- until they run out. That is exactly how the shopkeeper reads the same page,
-- it needs no allocation table, and — because nothing is stored — it cannot
-- drift away from the payments it was derived from. `ageOf` in
-- `lib/pos/ledger.ts` is that walk.
--
-- **The opening balance is what makes day one believable.** A shop that owes
-- Ravi Trading eighty thousand rupees on the morning it starts using Flo and
-- sees a balance of nought will never trust the figure again. So the supplier
-- row carries what was owed and the date it was owed as at, and everything
-- after that is arithmetic.
--
-- What this is deliberately *not*: a khata. It is the other direction — money
-- the shop owes its suppliers, not money customers owe the shop. `0018` removed
-- every trace of customer credit and nothing here brings it back.
--
-- Everything obeys 0001: `tenant_id not null`, RLS enabled and forced, select
-- only for tenant JWTs, every write through a Server Action on the service
-- role.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · What was already owed
--
-- Two columns rather than one. A balance with no date on it is a figure nobody
-- can check against anything: "we owed him 80,000" is only useful beside "as at
-- the 1st of July", because that is the day the shop's own book and Flo's have
-- to agree.
--
-- The date is nullable and the amount defaults to nought, so every supplier
-- that `0027` lifted out of the item list starts at zero — which is the honest
-- answer for a shop that has not told us otherwise.
-- -----------------------------------------------------------------------------
alter table public.suppliers
  add column if not exists opening_balance numeric(12, 2) not null default 0,
  add column if not exists opening_balance_on date;

comment on column public.suppliers.opening_balance is
  'What the shop already owed this supplier before Flo. Positive is owed to them; a negative figure is an advance the shop has paid.';

-- -----------------------------------------------------------------------------
-- 2 · The payments
--
-- `on delete restrict` on the supplier, like `goods_receipts` and
-- `purchase_orders`: a payment with nobody on it is not a record of anything.
-- Switching a distributor off is the move, and `deleteSupplier` already says so.
--
-- `method` is a closed list because it is read by people and grouped by
-- reports. It is a note about how the money left, typed by whoever paid — not
-- an integration with any of them, and nothing in Flo talks to a bank or a
-- wallet. A future payments integration would write this column; today a person
-- does.
-- -----------------------------------------------------------------------------
create table if not exists public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  -- The day the money left, which is not always the day somebody typed it in.
  paid_on date not null,
  -- Strictly positive. Money coming *back* from a supplier — a credit note, a
  -- refund for short delivery — is not a negative payment, because it is not a
  -- payment. When that is built it is its own row with its own reason, for the
  -- reason `0024` made a refund a sale with a minus rather than a flag.
  amount numeric(12, 2) not null check (amount > 0),
  method text not null default 'cash'
    check (method in ('cash', 'bank', 'cheque', 'card', 'wallet')),
  -- The cheque number, the transfer id, the Easypaisa TID. What the shopkeeper
  -- quotes when the distributor says he never received it.
  reference text check (reference is null or length(btrim(reference)) <= 60),
  note text check (note is null or length(btrim(note)) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- "What did we pay out this month?" — the Payments tab, newest first.
create index if not exists supplier_payments_tenant_day_idx
  on public.supplier_payments (tenant_id, paid_on desc);

-- "What have we paid Ravi Trading?" — the supplier's own statement.
create index if not exists supplier_payments_tenant_supplier_idx
  on public.supplier_payments (tenant_id, supplier_id, paid_on desc);

comment on table public.supplier_payments is
  'Money paid to a supplier, against the running account rather than against a particular delivery — which is how shops here actually settle.';

-- -----------------------------------------------------------------------------
-- 3 · What every supplier is owed
--
-- One call, grouped in Postgres, for the reason `dashboard_summary` is one
-- call: a shop three years in has thousands of deliveries and payments between
-- them, and totalling that in a browser runtime over shop 3G to draw one column
-- of a table is the wrong trade. `purchaseTotals` in TypeScript is fine for the
-- few hundred rows a *screen* holds; a balance has to be over all of them or it
-- is not a balance.
--
-- `security invoker`, like `dashboard_summary` and `reports_summary`, so it
-- runs under the shop's own JWT: `p_tenant` is a filter and RLS is the
-- permission. A caller who names another shop gets that shop's rows refused by
-- the policy rather than returned. `rls.test.sql` proves it.
--
-- The opening balance is deliberately *not* added in here. It lives on the
-- supplier row, the reader adds it, and `lib/pos/ledger.ts` is the single place
-- the balance is defined — so the list, the statement and the tiles cannot each
-- arrive at a slightly different figure.
-- -----------------------------------------------------------------------------
create or replace function public.supplier_balances(p_tenant uuid)
returns table (
  supplier_id uuid,
  invoiced numeric,
  paid numeric,
  deliveries bigint,
  payments bigint,
  last_invoiced_on date,
  last_paid_on date
)
language sql
security invoker
set search_path = ''
as $fn$
  select
    s.id,
    coalesce(r.total, 0),
    coalesce(p.total, 0),
    coalesce(r.rows, 0),
    coalesce(p.rows, 0),
    r.last_on,
    p.last_on
  from public.suppliers s
  left join (
    select gr.supplier_id, sum(gr.total) as total, count(*) as rows,
           max(gr.received_on) as last_on
      from public.goods_receipts gr
     where gr.tenant_id = p_tenant
     group by gr.supplier_id
  ) r on r.supplier_id = s.id
  left join (
    select sp.supplier_id, sum(sp.amount) as total, count(*) as rows,
           max(sp.paid_on) as last_on
      from public.supplier_payments sp
     where sp.tenant_id = p_tenant
     group by sp.supplier_id
  ) p on p.supplier_id = s.id
  where s.tenant_id = p_tenant;
$fn$;

revoke execute on function public.supplier_balances(uuid) from public, anon;
grant execute on function public.supplier_balances(uuid) to authenticated, service_role;

comment on function public.supplier_balances(uuid) is
  'What each supplier has been invoiced and paid, grouped in Postgres. security invoker, so p_tenant is a filter and RLS is the gate. The opening balance is added by the reader.';

-- -----------------------------------------------------------------------------
-- 4 · Who may read it
--
-- Rule 3 from 0001: tenant JWTs get a select policy and nothing else. Writing a
-- payment is a Server Action on the service role — and that matters more here
-- than on most tables, because a row written straight into this one moves what
-- the shop believes it owes.
-- -----------------------------------------------------------------------------
revoke insert, update, delete, truncate on public.supplier_payments
  from anon, authenticated;

alter table public.supplier_payments enable row level security;
alter table public.supplier_payments force row level security;

drop policy if exists supplier_payments_read_own on public.supplier_payments;
create policy supplier_payments_read_own on public.supplier_payments for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_platform_admin()));
