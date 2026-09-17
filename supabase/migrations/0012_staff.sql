-----------------------------------------------------------------------------
alter table public.profiles
  drop constraint if exists profiles_tenant_role_check;

alter table public.profiles
  add constraint profiles_tenant_role_check
  check (tenant_role in ('owner', 'manager', 'cashier'));

-- -----------------------------------------------------------------------------
-- Columns.
-- -----------------------------------------------------------------------------
alter table public.profiles
  -- Lower-cased at the one place that writes it, so the unique index below is a
  -- real guarantee rather than one that Bilal@ and bilal@ walk straight past.
  add column if not exists email text
    check (email is null or email = lower(email)),
  add column if not exists is_active boolean not null default true,
  -- Who hired them. `on delete set null` because an owner's account going away
  -- must not take the cashier's row with it.
  add column if not exists created_by uuid
    references auth.users (id) on delete set null;

-- Partial: the owner and the manager rows that predate this migration have no
-- mirrored email, and two nulls are not a conflict anyway.
create unique index if not exists profiles_email_key
  on public.profiles (email) where email is not null;

create index if not exists profiles_tenant_role_idx
  on public.profiles (tenant_id, tenant_role);

-- -----------------------------------------------------------------------------
-- Backfill the two roles that already existed, so the roster shows the owner
-- their own address on the first visit instead of a dash.
-- -----------------------------------------------------------------------------
update public.profiles p
   set email = lower(u.email)
  from auth.users u
 where u.id = p.id
   and p.email is null
   and u.email is not null
   -- Skip an address already mirrored onto some other row rather than fail the
   -- whole migration on the unique index.
   and not exists (
     select 1 from public.profiles other
      where other.email = lower(u.email) and other.id <> p.id
   );

-- -----------------------------------------------------------------------------
-- Privileges and RLS are unchanged, and that is the point: `profiles` already
-- carries `profiles_read_own_tenant`, so an owner can read their colleagues and
-- nobody else's, and 0001 revoked insert/update/delete from `authenticated`
-- outright. Creating, editing and deleting staff goes through
-- `app/(app)/app/employees/actions.ts` on the service role, like every other
-- write in the app.
--
-- The one thing worth re-stating: the access-token hook already reads
-- `tenant_role` off this table, so a cashier who signs in gets
-- `tenant_role: 'cashier'` stamped into their JWT with no change to the hook.
-- Every `= 'owner'` check in the app therefore closes against them by default,
-- which is the right direction for a constraint to fail in.
-- -----------------------------------------------------------------------------
