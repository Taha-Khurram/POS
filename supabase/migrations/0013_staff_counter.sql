-- =============================================================================
-- 0013_staff_counter — the counter a staff member stands at
--
-- Apply manually after 0012_staff.sql.
--
-- Until now, which till a device bills from was purely a device preference: the
-- `flo_counter` cookie, on the reasoning that the till by the door is the till
-- by the door whoever is standing at it. That holds for a shop with one tablet
-- per counter, and stops holding the moment a cashier carries their own device
-- to whichever till is free — which is what a shop with a phone per person
-- actually looks like.
--
-- So this is a second, weaker answer and not a replacement. The cookie still
-- means "this device", and it is still what an owner sets when they set a
-- tablet up. This column means "this person", it is set by the owner on
-- `/app/employees`, and the register prefers it when there is one. Nobody loses
-- the old behaviour: a staff member with no assignment resolves exactly as
-- before, and the owner can never have an assignment at all, because the staff
-- editor refuses their own row.
--
-- `on delete set null`, not cascade: deleting a counter must not delete the
-- person who stood at it. They fall back to the cookie, which is what a cashier
-- whose till was removed should do.
-- =============================================================================

-- A counter is identified by its id alone, but the pair is what makes the
-- composite foreign key below possible. Redundant as a constraint, load-bearing
-- as a target.
alter table public.counters
  add constraint counters_id_tenant_key unique (id, tenant_id);

alter table public.profiles
  add column if not exists counter_id uuid;

-- The tenant goes into the key on purpose. Validating that a counter belongs to
-- the assigning shop is something `app/(app)/app/employees/actions.ts` does
-- too, but a check in an action is a check somebody can forget to write in the
-- next action — this one cannot be got around from any connection, service role
-- included.
--
-- MATCH SIMPLE, so a row whose tenant_id is null is exempt. That is the
-- half-created account from 0001, which has no shop to be assigned within.
alter table public.profiles
  add constraint profiles_counter_fkey
  foreign key (counter_id, tenant_id)
  references public.counters (id, tenant_id)
  on delete set null;

create index if not exists profiles_counter_id_idx
  on public.profiles (counter_id);

-- Privileges and RLS are untouched. `profiles` is already select-only for a
-- tenant JWT and the register reads the assignment off the signed-in person's
-- own row, which `profiles_read_own_tenant` has always allowed. The write is
-- the owner's, through a Server Action on the service role, like every other
-- write in the app.
