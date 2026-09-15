-- =============================================================================
-- 0010_counter — the counter a shop actually bills from
--
-- Apply manually after 0009_shop_settings.sql. `register_devices` in 0008 is
-- the offline-sync end of this: one row per physical tablet, keyed to a branch,
-- written by the sync endpoint. This is the other end — the single counter the
-- owner switches on in Settings and the register reads on every load. It
-- carries no branch, for the same reason nothing else in /app does: a shop
-- cannot have a second branch yet, and a not-null column pointing at a table
-- with no rows is a register that cannot open.
--
-- One row per shop, so `tenant_id` is the primary key exactly as it is on
-- `tenant_settings`. When a plan's `max_registers` means anything (there is a
-- counters list to go with it) this becomes a surrogate key and a unique index;
-- until then a second row would only be a second thing to keep in step.
--
-- Same rules as everything since 0001: RLS enabled and forced, select-only for
-- tenant JWTs, every write through a Server Action on the service role.
-- =============================================================================

create table public.counters (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  name text not null default 'Counter 1' check (length(btrim(name)) > 0),
  -- The switch this table exists for. Off is the default: a shop that has not
  -- been through Settings has not told us its prices are right yet, and a
  -- register that opens anyway is a register that sells at the wrong ones.
  is_active boolean not null default false,
  -- Printed in front of every receipt number. Upper-case and short because it
  -- is read down a phone line and has to fit an 80 mm roll.
  receipt_prefix text not null default 'INV'
    check (receipt_prefix ~ '^[A-Z0-9][A-Z0-9-]{0,7}$'),
  -- What the counter can take. A shop with no card machine turns card off and
  -- the register stops offering a tender it cannot honour.
  accepts_cash boolean not null default true,
  accepts_card boolean not null default false,
  -- The two lines under the shop's name at the foot of the receipt: the return
  -- policy, or the WhatsApp number for udhaar. Nullable — most shops print
  -- neither, and an empty string on a thermal roll is a wasted line of paper.
  receipt_footer text,
  -- Ask before printing, or print the moment the sale is tendered. A dhaba at
  -- dinner wants the second; a cloth house that bills once an hour does not.
  auto_print boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger counters_set_updated_at before update on public.counters
  for each row execute function private.set_updated_at();

-- No backfill. An absent row and `is_active = false` mean the same thing to the
-- register, and the application reads the defaults above when there is nothing
-- to read — so a shop gets its row on the first save and not before.

-- -----------------------------------------------------------------------------
-- Privileges and RLS
-- -----------------------------------------------------------------------------
revoke insert, update, delete, truncate on public.counters from anon, authenticated;
revoke select on public.counters from anon;
grant select on public.counters to authenticated;

alter table public.counters enable row level security;
alter table public.counters force row level security;

create policy counters_read_own on public.counters for select to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_platform_admin()));
