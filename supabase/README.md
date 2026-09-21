# Database

Plain SQL migrations, applied in filename order. Load the
`supabase-postgres-best-practices` skill before changing anything in here.

```
migrations/0001_init.sql        platform tables, RLS, access-token hook
migrations/0002_seed_plans.sql  Standard (Rs 5,000) and Premium (Rs 10,000)
migrations/0003_storage.sql     private payment-proofs bucket, no policies
config.toml                     local stack; signup off, MFA on, hook enabled
```

## Applying one

There is no Docker on the development machine, so the local stack does not run
and neither does pgTAP. Migrations go to the hosted project through the
**Supabase MCP** (`apply_migration`), and the file under `migrations/` is
written in the same step — a migration that exists in one place and not the
other is the drift every header in here complains about.

**There is no `tests/`.** `rls.test.sql` was a 1,700-line pgTAP suite covering
tenant isolation, the select-only rule and the read-only platform admin, and it
needed a local Postgres to run. With none available it could only be edited and
hoped over, so it was removed rather than left standing as a gate nobody can
open. It is in git history. Nothing verifies the five rules in `0001`'s header
automatically now — read a new migration against them by hand.

With Docker, the CLI still works as it always did:

```bash
supabase start          # applies every migration
supabase db reset       # wipe and re-apply from scratch
supabase gen types typescript --local > lib/database.types.ts
```

The CLI is not a project dependency — install it once
(`npm i -g supabase`, `scoop install supabase`, or `brew install supabase/tap/supabase`).

## Checking it

```bash
npm run doctor                                    # env, schema, bucket, admins
npm run doctor -- you@example.com 'password'      # also checks the JWT claims
```

Run this before blaming the app. The expensive failure below is silent, and
`doctor` is the only thing that names it.

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

No route, form, or Server Action can create a platform admin. It takes the
service-role key and a deliberate command, after the migrations are applied:

```bash
npm run create-admin -- you@example.com 'your-password'

# or, to keep it out of shell history
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... npm run create-admin
```

Idempotent — run it again to reset the password or re-assert the role. Pass
`ADMIN_ROLE=support` for someone you hire later, who gets no billing rights.

Sign out and back in afterwards: `platform_role` is stamped at token issue, so
an existing session will keep 404ing on `/admin`.
