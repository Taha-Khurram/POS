-- =============================================================================
-- 0044_payment_accounts — where a buyer sends the money
--
-- `/order/[reference]` told a buyer to "send the exact amount to your Flo
-- payment account" and then showed no account: the only line under it said the
-- details would come from support on WhatsApp. So every self-serve order
-- stalled on a message somebody had to answer before the buyer could pay, and
-- the one screen whose whole job is taking money could not take any.
--
-- The accounts are rows rather than constants for the reason `plans` is: a
-- wallet hits its monthly ceiling, a bank account is changed, and either of
-- those should be a form on `/admin/payment-accounts` and not a deploy. It also
-- keeps real account numbers out of the site's source.
--
-- **Platform data, not a shop's**, so no `tenant_id` — the same standing as
-- `plans`. Rule 1 of `0001_init.sql` is about business tables; this is Flo's
-- own till. The other four rules hold:
--
--   * RLS enabled and forced here, in the migration that creates it.
--   * Select only, for a platform JWT, through `private.is_platform_admin()`
--     wrapped in `(select …)`. No tenant reads it and neither does `anon`: the
--     order page reads it server-side on the service role, exactly as it
--     already reads the order, and prints only the rows that are switched on.
--   * insert/update/delete/truncate revoked from `anon` and `authenticated`.
--     Every write is a service-role Server Action behind `requireBilling()`.
--   * No platform-admin escape on a write path, because there is no write
--     policy at all.
--
-- **Only the three ways a buyer can actually send money from home.** Cash and
-- card are ways a payment is *recorded* on `/admin/payments`, not accounts a
-- stranger can transfer into.
--
-- A bank account needs its bank named; a wallet needs nothing but the title and
-- the number, which for Easypaisa and JazzCash is a mobile number. The IBAN is
-- optional, because some shopkeepers only ever send by account number — but
-- when it is there it is checked, because one wrong character in an IBAN is
-- somebody's Rs 5,000 in a stranger's account.
-- =============================================================================

create table public.payment_accounts (
  id uuid primary key default gen_random_uuid(),
  method text not null check (method in ('bank_transfer', 'easypaisa', 'jazzcash')),
  account_title text not null check (length(btrim(account_title)) between 1 and 80),
  bank_name text check (bank_name is null or length(btrim(bank_name)) between 1 and 60),
  account_number text not null check (length(btrim(account_number)) between 4 and 34),
  iban text check (iban is null or iban ~ '^PK[0-9]{2}[A-Z]{4}[0-9]{16}$'),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint payment_accounts_bank_named
    check (method <> 'bank_transfer' or bank_name is not null),
  -- A wallet has no IBAN; one stored against it would print on the order page
  -- as a second number to send to.
  constraint payment_accounts_iban_is_a_bank
    check (method = 'bank_transfer' or iban is null)
);

comment on table public.payment_accounts is
  'Where a self-serve buyer sends the money. Printed on /order/[reference] when active; edited on /admin/payment-accounts.';

create trigger payment_accounts_set_updated_at before update on public.payment_accounts
  for each row execute function private.set_updated_at();

revoke insert, update, delete, truncate on public.payment_accounts from anon, authenticated;
revoke select on public.payment_accounts from anon;

alter table public.payment_accounts enable row level security;
alter table public.payment_accounts force row level security;

create policy payment_accounts_read_platform on public.payment_accounts
  for select to authenticated
  using ((select private.is_platform_admin()));
