-- =============================================================================
-- 0047_team_screens — a team member is the screens the owner ticked
--
-- `0041` gave the console two levels: full access, and support, which read
-- every screen and wrote nothing that touched money. In practice the owner
-- wants to hand somebody *the leads* or *the orders queue* — a list of tabs, not
-- a level. So:
--
-- * `platform_admins.screens` — which of the console's shared screens a
--   `support` row may open and work. A ticked screen is the whole screen, reads
--   and writes, because a tab you may look at and not use is a tab somebody
--   rings the owner about. `super_admin` ignores the column: the Flo owner gets
--   everything, including the screens no member can ever be given (Team, the
--   audit trail, Plans, Payment accounts, their own shop). The list is checked
--   against the five grantable keys so a typo cannot become a screen.
--   Every existing `support` row gets all five, which is what it could read
--   before; there are none at the time of writing.
--
-- * `public.operator_credentials` — the member's minted password, sealed with
--   AES-256-GCM in the Server Action before it is written, so the owner can
--   press Reveal on `/admin/team` instead of resetting it every time somebody
--   loses a WhatsApp message. This reverses `0041`'s "stored nowhere", at the
--   owner's call. What keeps it tolerable: the database only ever holds
--   ciphertext (the key lives in the app, derived from the service-role key),
--   the table has RLS forced and **no policy at all** — the `document_series`
--   treatment — so no JWT can read it, and every reveal is an audit row.
--   A login that also runs a shop never gets a row: its password is the
--   shopkeeper's own. Cascades from `auth.users`, so deleting a member deletes
--   their secret.
--
-- * `audit_log` is readable by the Flo owner alone. The trail is where a
--   member's own actions are written; a member who can read it can read who
--   watched them.
--
-- Rules 1-5 of `0001_init.sql`: neither table is a tenant's business table, so
-- neither carries `tenant_id` (platform data, like `plans`). RLS is enabled and
-- forced on the new one in this migration, nothing is granted to `anon` or
-- `authenticated`, and every write stays on the service role in
-- `/admin/team/actions.ts`. No function is added.
-- =============================================================================

alter table public.platform_admins
  add column screens text[] not null default '{}'
    check (screens <@ array['overview', 'clients', 'orders', 'payments', 'leads']::text[]);

update public.platform_admins
   set screens = array['overview', 'clients', 'orders', 'payments', 'leads']
 where platform_role = 'support';

create table public.operator_credentials (
  user_id uuid primary key references auth.users (id) on delete cascade,
  sealed text not null,
  updated_at timestamptz not null default now()
);

alter table public.operator_credentials enable row level security;
alter table public.operator_credentials force row level security;

revoke all on public.operator_credentials from anon, authenticated;

drop policy audit_log_read_platform on public.audit_log;

create policy audit_log_read_owner on public.audit_log
  for select to authenticated
  using ((select private.is_super_admin()));
