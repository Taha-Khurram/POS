-- =============================================================================
-- 0014_audit_log_outlives_its_actor — remove somebody without rewriting history
--
-- Apply manually after 0013_staff_counter.sql.
--
-- Removing a cashier on /app/employees always failed, on every account, with
-- "We could not remove that account". The cause is two rules from 0001 meeting:
--
--   * `audit_log.actor_id` referenced `auth.users` `on delete set null`.
--   * `audit_log_append_only` denies UPDATE and DELETE on that table, and it is
--     a FOR EACH STATEMENT trigger.
--
-- Deleting the auth user makes Postgres run the referential action itself —
-- `update public.audit_log set actor_id = null where actor_id = $1` — and a
-- statement-level trigger fires on that statement whether or not it matches a
-- single row. So the append-only rule refused the update, the update took the
-- delete down with it, and GoTrue returned a database error. Nobody could be
-- deleted, including a cashier hired an hour ago who had never done anything
-- worth auditing.
--
-- The fix is to stop pointing at the account. An audit entry is a record of
-- something that happened, not a live reference to somebody who still exists:
-- `actor_email` is already stored beside `actor_id` for exactly that reason, and
-- an entry whose actor is blanked out the day they leave is an entry that has
-- lost the one thing it was kept for. Dropping the constraint leaves the id in
-- place for good, and leaves nothing for a user deletion to update.
--
-- `tenant_id` goes the same way and for the same reason — it is the identifier
-- of the shop the action happened in, and `on delete set null` against the same
-- trigger would make deleting a tenant impossible in exactly the same manner.
--
-- What this does not do is weaken append-only. The trigger is untouched: the
-- table still refuses every update and delete, from the service role and from
-- the migration role, which is what `supabase/tests/rls.test.sql` asserts. It
-- only stops Postgres from being asked to rewrite the log behind everyone's
-- back.
-- =============================================================================

alter table public.audit_log
  drop constraint if exists audit_log_actor_id_fkey;

alter table public.audit_log
  drop constraint if exists audit_log_tenant_id_fkey;

comment on column public.audit_log.actor_id is
  'Who did it. Deliberately not a foreign key: the entry outlives the account, '
  'and an append-only table cannot survive an ON DELETE action being run on it.';

comment on column public.audit_log.tenant_id is
  'The shop it happened in. Not a foreign key, for the reason actor_id is not.';
