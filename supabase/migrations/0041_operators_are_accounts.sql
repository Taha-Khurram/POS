-- =============================================================================
-- 0041_operators_are_accounts — the console makes the people who work it
--
-- Until now an operator was an existing login granted a row here: the person
-- signed up somewhere, told the owner their email, and `/admin/team` upserted
-- `platform_admins`. In practice nobody but the owner could ever sign in at
-- all, because the preview allow-list in `login/actions.ts` names one address.
--
-- `/admin/team` now creates the auth account itself, with a minted password
-- handed over once — the same bargain `/app/employees` strikes for a cashier —
-- and can switch an operator off or remove them. That needs two columns:
--
-- * `email` — what the login allow-list checks *before* Supabase is asked for
--   the password. Copied from `auth.users` when the row is written rather than
--   joined at sign-in, because the allow-list runs for anonymous callers and
--   `auth.users` is not a table the login path should be reading. It is a
--   lookup key, not the identity: `user_id` still is.
-- * `is_active` — switched off, not deleted. The row stays so the roster still
--   says who they were and the audit trail still has a name to point at.
--
-- The hook stamps `platform_role` only for an active row, so a deactivated
-- operator's next token carries no role. The token already in their browser is
-- not the gate either way: `requirePlatform` re-reads this row on every
-- `/admin` request, which is what makes switching somebody off immediate.
--
-- No table is created and no policy is added. `platform_admins` keeps its RLS
-- (select-only, `platform_admins_read_self`) and every write is still the
-- service role in `/admin/team/actions.ts`, so rules 1-5 of `0001_init.sql`
-- stand. The hook keeps its `0001` grants exactly: `supabase_auth_admin` only.
-- =============================================================================

alter table public.platform_admins
  add column email text,
  add column is_active boolean not null default true;

update public.platform_admins pa
   set email = lower(u.email)
  from auth.users u
 where u.id = pa.user_id;

-- Lower-cased on write by the action and matched lower-cased at sign-in, so the
-- index is on the column itself rather than an expression.
create unique index platform_admins_email_idx
  on public.platform_admins (email)
  where email is not null;

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  claims jsonb;
  v_user_id uuid;
  v_tenant_id uuid;
  v_branch_id uuid;
  v_tenant_role text;
  v_platform_role text;
begin
  claims := coalesce(event -> 'claims', '{}'::jsonb);
  v_user_id := (event ->> 'user_id')::uuid;

  select p.tenant_id, p.branch_id, p.tenant_role
    into v_tenant_id, v_branch_id, v_tenant_role
  from public.profiles p
  where p.id = v_user_id;

  -- A switched-off operator gets no role at all, not a lesser one.
  select pa.platform_role
    into v_platform_role
  from public.platform_admins pa
  where pa.user_id = v_user_id
    and pa.is_active;

  claims := jsonb_set(claims, '{tenant_id}',
    coalesce(to_jsonb(v_tenant_id::text), 'null'::jsonb), true);
  claims := jsonb_set(claims, '{branch_id}',
    coalesce(to_jsonb(v_branch_id::text), 'null'::jsonb), true);
  claims := jsonb_set(claims, '{tenant_role}',
    coalesce(to_jsonb(v_tenant_role), 'null'::jsonb), true);
  claims := jsonb_set(claims, '{platform_role}',
    coalesce(to_jsonb(v_platform_role), 'null'::jsonb), true);

  return jsonb_set(event, '{claims}', claims);
end;
$fn$;
