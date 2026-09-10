# Database

Plain SQL migrations, applied in filename order. Load the
`supabase-postgres-best-practices` skill before changing anything in here.

```
migrations/0001_init.sql        platform tables, RLS, access-token hook
migrations/0002_seed_plans.sql  Standard (Rs 5,000) and Premium (Rs 10,000)
migrations/0003_storage.sql     private payment-proofs bucket, no policies
tests/rls.test.sql              pgTAP tenant-isolation gate — runs in CI
config.toml                     local stack; signup off, MFA on, hook enabled
```

## Local

```bash
supabase start          # applies every migration
supabase test db        # runs tests/rls.test.sql
supabase db reset       # wipe and re-apply from scratch
supabase gen types typescript --local > lib/database.types.ts
```

The CLI is not a project dependency — install it once
(`npm i -g supabase`, `scoop install supabase`, or `brew install supabase/tap/supabase`).

## Hosted project — four steps that no migration can do

These have to be done once per project in the Dashboard. The first two are the
actual locks in §3.3; everything in the migrations is defence in depth behind
them.

1. **Authentication → Sign In / Providers → disable "Allow new users to sign
   up."** With this off, `POST /auth/v1/signup` returns 422 even when called
   directly with the publishable key. This, not application code, is what makes
   the console the only way in.
2. **Authentication → Hooks → Customize Access Token (JWT) Claims →
   `public.custom_access_token_hook`.** Until this is enabled the JWT carries no
   `tenant_id` or `platform_role`, so every RLS policy sees null and every user
   — including you — reads nothing. If `/admin` 404s for an account that is in
   `platform_admins`, this is why.
3. **Authentication → MFA → enable TOTP, and enrol your own account.** This
   console can activate paid accounts and read every client's sales.
4. **Project Settings → API keys → copy the service-role key** into
   `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` and in the host's environment.
   Not `NEXT_PUBLIC_*`, and not in git.

## Seeding your own admin account

There is deliberately no code path that creates a platform admin. Do it by hand,
once, after signing yourself up while signup is still enabled — or via
`supabase.auth.admin.createUser` from a one-off script — then:

```sql
insert into public.platform_admins (user_id, platform_role, full_name)
values ('<your auth.users id>', 'super_admin', 'Your name');
```

Sign out and back in afterwards: `platform_role` is stamped at token issue, so
an existing session will not have it.
