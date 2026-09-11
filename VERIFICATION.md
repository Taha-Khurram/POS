# Flo Verification Runbook

Use this document to verify the database, authentication, owner console, client activation, billing, and register foundation from a clean staging environment.

A green `npm run build` only proves the application compiles. This runbook also verifies the live Supabase configuration and the end-to-end flows.

## 1. Prerequisites

- Node.js and npm installed.
- A Supabase project with `.env.local` containing:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
- An admin email and password available locally.
- The Supabase Dashboard open for Auth, Storage, Database, and Cron checks.
- Use a staging project first. Do not run destructive tests against production data.

## 2. Apply Migrations

Apply these files in order. The SQL files are in `supabase/migrations/`.

```text
0001_init.sql
0002_seed_plans.sql
0003_storage.sql
0004_phase1_support.sql
0005_order_verification_lock.sql
0006_rate_limits.sql
0007_renewal_reminders.sql
0008_register_foundation.sql
```

After applying them, confirm these tables exist:

```text
tenants, branches, profiles, platform_admins, plans, subscriptions,
orders, payments, invites, leads, audit_log, tenant_notes, tenant_health,
request_rate_limits, renewal_reminders, items, register_devices, shifts,
sales, sale_lines, sale_tenders, sync_outbox
```

Confirm the `payment-proofs` Storage bucket is private.

## 3. Supabase Configuration

In Supabase Dashboard:

1. Disable public email signup.
2. Enable the custom access-token hook:
   `Authentication -> Hooks -> Customize Access Token (JWT) Claims -> public.custom_access_token_hook`.
3. Enable MFA for platform administrators.
4. Confirm the `pg_cron` extension is enabled.
5. Confirm the `flo-renewal-reminders` cron job exists and runs:
   `select private.enqueue_renewal_reminders();`.
6. Confirm `SUPABASE_SERVICE_ROLE_KEY` is never exposed as `NEXT_PUBLIC_*`.

Run the application preflight:

```bash
npm run doctor
npm run doctor -- admin@example.com "admin-password"
```

Expected result: environment, schema, plans, private storage, platform admin, JWT claims, and `role=authenticated` all pass.

## 4. Automated Gates

Run from the repository root:

```bash
npm install
npm run lint
npm run build
```

Expected result:

- ESLint exits with code 0.
- Next.js compiles successfully.
- TypeScript completes successfully.
- Routes include `/admin`, `/admin/clients`, `/admin/orders`, `/admin/payments`, `/checkout`, `/order/[reference]`, and `/signup`.

If the Supabase CLI is installed and linked to the local project:

```bash
supabase test db
```

Expected result: all pgTAP RLS assertions pass.

## 5. Authentication and Route Boundaries

### Platform admin

1. Sign in with a user in `platform_admins`.
2. Open `/admin`.
3. Confirm the overview loads.
4. Open every admin route from the navigation.
5. Confirm the user can read clients, plans, orders, payments, leads, audit, notes, and health snapshots.

### Tenant user

1. Create or use an activated tenant account.
2. Open `/app`.
3. Open `/admin`, `/admin/clients`, and `/admin/plans`.
4. Confirm every admin route returns the normal 404 response.
5. Confirm the tenant can only read its own tenant data.
6. Confirm the tenant cannot read plans, audit logs, leads, invite hashes, support notes, or health snapshots.

### Public user

1. Open `/admin` while signed out. Expect 404.
2. Call Supabase public signup directly. Expect signup disabled / HTTP 422.
3. Open `/signup` without a token. Confirm no account form is shown.

## 6. Direct Activation Flow

1. Open `/admin/clients/new` as a super admin.
2. Create a test client with:
   - Plan: Premium
   - Branches: 3
   - Registers: 2
   - Agreed price: Rs 8,500
   - Trial days: 0 or a chosen trial period
3. Submit the form.
4. Confirm the client list shows the new tenant.
5. Confirm the generated invite URL is visible and copyable.
6. Confirm database rows exist for exactly:
   - One tenant
   - One primary branch
   - One subscription
   - One live owner invite
   - One `tenant.activated` audit row
7. Open the client record and verify plan, price, branches, registers, and expiry.

## 7. Self-Serve Order Flow

1. Open `/pricing` while signed out.
2. Select `Get started`.
3. Submit `/checkout` with a test shop.
4. Confirm an order reference in the format `FLO-XXXXXX` is generated.
5. Open `/order/[reference]`.
6. Try an invalid file type and a file larger than 5 MB. Both must be rejected.
7. Upload a valid PNG, JPG, WEBP, or PDF under 5 MB.
8. Confirm order status becomes `proof_submitted`.
9. As admin, open `/admin/orders`.
10. Open the short-lived payment-proof link.
11. Verify the order.
12. Confirm:
    - Order status is `verified`.
    - One tenant was created.
    - One subscription and branch were created.
    - One invite was created.
    - `order.verified` and `tenant.activated` audit rows exist.
13. Click Verify twice quickly. Confirm no duplicate tenant is created.
14. Create a second order and reject it with a reason. Confirm `rejected` status and `order.rejected` audit row.

## 8. Invite Signup Flow

1. Open a fresh generated invite URL.
2. Submit a valid name, email, and password of at least 8 characters.
3. Confirm redirect to login.
4. Sign in with the new account.
5. Confirm the account reaches `/app` and sees the correct tenant.
6. Confirm `profiles` contains the correct tenant, branch, and owner role.
7. Reuse the same invite. It must fail.
8. Revoke or expire another invite. It must fail.
9. Change one character in a valid token. It must fail.
10. Confirm the invite has `used_at` and `used_by` after successful redemption.

## 9. Client Support Operations

From `/admin/clients/[id]`:

1. Change plan, agreed price, max branches, and max registers.
2. Add a feature override as valid JSON.
3. Submit invalid JSON and confirm it is rejected.
4. Change lifecycle status to active, past due, suspended, and cancelled.
5. Extend the subscription period.
6. Record a payment from `/admin/payments`.
7. Confirm payment history and subscription expiry change.
8. Regenerate an invite and confirm the previous pending invite is revoked.
9. Revoke a pending invite.
10. Add a timestamped internal support note.
11. Confirm the note appears with a timestamp.
12. Confirm each mutation creates an audit entry.
13. Confirm a support-role user cannot record payments or edit entitlements.

## 10. Leads, Plans, and Audit

### Leads

1. Submit the public `/demo` form.
2. Confirm the form shows its success state.
3. Open `/admin/leads`.
4. Confirm the lead appears with contact details.
5. Open the WhatsApp link.
6. Change the lead through new, contacted, qualified, won, or lost.
7. Confirm the update is audited.

### Plans

1. Open `/admin/plans` as super admin.
2. Edit price, pitch, active state, sort order, and feature JSON.
3. Save valid JSON and confirm the plan changes.
4. Save malformed JSON and confirm rejection.
5. Confirm support users cannot edit plans.

### Audit

1. Open `/admin/audit`.
2. Confirm activation, payment, order, invite, plan, lead, lifecycle, entitlement, and note actions appear.
3. Expand a row and verify before/after values.
4. Confirm audit rows cannot be updated or deleted.

## 11. Rate Limits

After applying `0006_rate_limits.sql`:

1. Submit `/checkout` more than five times from the same client address in one hour.
2. Confirm later attempts are rejected.
3. Submit more than ten payment-proof uploads in one hour.
4. Confirm later uploads are rejected.
5. Submit `/signup` more than five times in one hour.
6. Confirm later attempts are rejected.
7. Confirm anonymous users cannot read `request_rate_limits`.

## 12. Renewal Queue

After applying `0007_renewal_reminders.sql`:

1. Create a test subscription expiring in 7 days.
2. Run:

```sql
select private.enqueue_renewal_reminders();
```

3. Confirm one `renewal_reminders` row exists with `days_until_expiry = 7`.
4. Run the function again. Confirm no duplicate row is created.
5. Repeat with 3 and 1 days.
6. Confirm cancelled subscriptions do not create reminders.
7. Confirm anonymous and tenant users cannot read the reminder queue.

## 13. Register Foundation Database Checks

After applying `0008_register_foundation.sql`, confirm:

- Tenant users can read only their own catalog, shifts, sales, tenders, and outbox rows.
- Anonymous users cannot read any register table.
- Tenant JWTs cannot insert, update, or delete register rows directly.
- Two open shifts cannot exist for the same device.
- Duplicate tenant SKUs are rejected.
- Duplicate active outbox operations for the same entity are rejected.
- Sales with the same tenant and receipt number are rejected.
- Sale lines and tenders cannot exist without a valid sale.

The interactive offline register is the next implementation stage. This migration only establishes its database contract; Dexie storage, item search, cart, tendering, shifts, sync, and service-worker behavior still need browser-level testing.

## 14. Evidence to Record

For a release candidate, save:

- Output from `npm run doctor`.
- Output from `npm run lint`.
- Output from `npm run build`.
- Output from `supabase test db`.
- Screenshots of `/admin/orders`, `/admin/clients/[id]`, `/admin/audit`, and `/app`.
- One test order reference and its final status.
- One test tenant ID and its audit trail.
- The Supabase Dashboard confirmation for disabled public signup, MFA, private Storage, JWT hook, and `pg_cron`.

A release is ready only when the automated gates pass and the manual sections above have no unresolved failures.
