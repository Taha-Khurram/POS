-- =============================================================================
-- rls.test.sql — the test that has to stay green forever
--
-- A tenant-leak bug found by a customer ends the business, so this file is a
-- CI gate rather than a nicety. Run it with:
--
--     supabase test db
--
-- It asserts the four things Part 0's Definition of Done names: tenant A cannot
-- read tenant B; a tenant user cannot read platform_admins, plans, or another
-- tenant's subscriptions; a tenant user cannot write platform data at all; and
-- audit_log is append-only even to the role that writes it.
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

-- -----------------------------------------------------------------------------
-- Fixtures. Fixed UUIDs so the JWT claim literals below stay readable.
-- Inserted as the migration role, which bypasses RLS — the point of the test is
-- what `authenticated` and `anon` can see afterwards.
-- -----------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'owner.a@example.com', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'owner.b@example.com', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'orphan@example.com', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '99999999-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'you@flo.pk', now(), now());

insert into public.tenants (id, shop_name, owner_name, phone, city, shop_type)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Al-Madina Kiryana', 'Owner A',
   '03001112222', 'Lahore', 'kiryana'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'Bundu Khan Karahi', 'Owner B',
   '03003334444', 'Karachi', 'restaurant');

insert into public.branches (tenant_id, name, city, is_primary)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Main branch', 'Lahore', true),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'Main branch', 'Karachi', true);

insert into public.profiles (id, tenant_id, tenant_role, full_name)
values
  ('11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   'owner', 'Owner A'),
  ('22222222-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001',
   'owner', 'Owner B'),
  -- Signed up, never activated. Should be able to see nothing whatsoever.
  ('33333333-0000-4000-8000-000000000001', null, null, 'Orphan');

insert into public.platform_admins (user_id, platform_role, full_name)
values ('99999999-0000-4000-8000-000000000001', 'super_admin', 'You');

insert into public.subscriptions
  (tenant_id, plan_id, status, agreed_price, current_period_end)
select
  t.id,
  (select id from public.plans where code = 'standard'),
  'active',
  case when t.id = 'aaaaaaaa-0000-4000-8000-000000000001' then 8500 else 5000 end,
  now() + interval '30 days'
from public.tenants t;

insert into public.payments (tenant_id, amount, method, reference)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 8500, 'easypaisa', 'A-PAY-1'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 5000, 'bank_transfer', 'B-PAY-1');

insert into public.invites (tenant_id, token_hash, expires_at)
values
  ('aaaaaaaa-0000-4000-8000-000000000001',
   repeat('a', 64), now() + interval '72 hours');

insert into public.leads (contact_name, phone, city)
values ('Walk-in enquiry', '03005556666', 'Multan');

insert into public.audit_log (actor_id, actor_kind, action, tenant_id)
values ('99999999-0000-4000-8000-000000000001', 'platform_admin',
        'tenant.activated', 'aaaaaaaa-0000-4000-8000-000000000001');

insert into public.tenant_notes (tenant_id, author_id, body)
values ('aaaaaaaa-0000-4000-8000-000000000001',
  '99999999-0000-4000-8000-000000000001', 'Test support note');

insert into public.tenant_health (tenant_id, last_sale_at, staff_count, item_count)
values ('aaaaaaaa-0000-4000-8000-000000000001', now() - interval '1 hour', 2, 14);

insert into public.renewal_reminders (tenant_id, subscription_id, reminder_date, days_until_expiry)
select tenant_id, id, current_date, 7
from public.subscriptions
where tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001';

-- =============================================================================
-- Tenant A's owner
-- =============================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-0000-4000-8000-000000000001","role":"authenticated","tenant_id":"aaaaaaaa-0000-4000-8000-000000000001","tenant_role":"owner","platform_role":null}';

select is(
  (select count(*) from public.tenants), 1::bigint,
  'tenant A sees exactly one tenant — its own'
);

select is_empty(
  $$ select 1 from public.tenants where id = 'bbbbbbbb-0000-4000-8000-000000000001' $$,
  'tenant A cannot read tenant B'
);

select is_empty(
  $$ select 1 from public.branches
     where tenant_id = 'bbbbbbbb-0000-4000-8000-000000000001' $$,
  'tenant A cannot read tenant B branches'
);

select is_empty(
  $$ select 1 from public.subscriptions
     where tenant_id = 'bbbbbbbb-0000-4000-8000-000000000001' $$,
  'tenant A cannot read tenant B subscription'
);

select is(
  (select count(*) from public.subscriptions), 1::bigint,
  'tenant A sees only its own subscription'
);

select is_empty(
  $$ select 1 from public.payments
     where tenant_id = 'bbbbbbbb-0000-4000-8000-000000000001' $$,
  'tenant A cannot read tenant B payments'
);

select is_empty(
  $$ select 1 from public.profiles
     where tenant_id = 'bbbbbbbb-0000-4000-8000-000000000001' $$,
  'tenant A cannot read tenant B profiles'
);

-- The platform's own tables. Entitlements are resolved server-side, so a shop
-- never needs to read a plan row — and must not be able to.
select is_empty(
  $$ select 1 from public.plans $$,
  'tenant user cannot read plans'
);

select is_empty(
  $$ select 1 from public.platform_admins $$,
  'tenant user cannot read platform_admins'
);

select is_empty(
  $$ select 1 from public.audit_log $$,
  'tenant user cannot read audit_log'
);

select is_empty(
  $$ select 1 from public.invites $$,
  'tenant user cannot read invite hashes'
);

select is_empty(
  $$ select 1 from public.leads $$,
  'tenant user cannot read the lead list'
);

select is_empty(
  $$ select 1 from public.tenant_notes $$,
  'tenant user cannot read internal support notes'
);

select is_empty(
  $$ select 1 from public.tenant_health $$,
  'tenant user cannot read platform health snapshots'
);

select throws_ok(
  $$ insert into public.tenant_notes (tenant_id, body)
     values ('aaaaaaaa-0000-4000-8000-000000000001', 'Forged note') $$,
  '42501', null,
  'tenant user cannot write support notes'
);

-- No write policy exists anywhere, and the write privileges are revoked, so
-- these fail on privilege (42501) rather than on a policy — belt and braces.
select throws_ok(
  $$ insert into public.tenants (shop_name, owner_name, phone, city, shop_type)
     values ('Forged Shop', 'Nobody', '03000000000', 'Lahore', 'kiryana') $$,
  '42501',
  null,
  'tenant user cannot create a tenant'
);

select throws_ok(
  $$ update public.tenants set shop_name = 'Renamed' $$,
  '42501',
  null,
  'tenant user cannot rename its own tenant directly'
);

select throws_ok(
  $$ update public.subscriptions set max_registers = 99, agreed_price = 0 $$,
  '42501',
  null,
  'tenant user cannot raise its own entitlements'
);

select throws_ok(
  $$ delete from public.payments $$,
  '42501',
  null,
  'tenant user cannot erase its payment history'
);

select throws_ok(
  $$ insert into public.platform_admins (user_id, platform_role)
     values ('11111111-0000-4000-8000-000000000001', 'super_admin') $$,
  '42501',
  null,
  'tenant user cannot make itself a platform admin'
);

-- =============================================================================
-- A signed-up-but-never-activated user. §3.3 layer 5: inert, not dangerous.
-- =============================================================================
set local request.jwt.claims = '{"sub":"33333333-0000-4000-8000-000000000001","role":"authenticated","tenant_id":null,"tenant_role":null,"platform_role":null}';

select is_empty($$ select 1 from public.tenants $$,
  'a user with no tenant sees no tenants');
select is_empty($$ select 1 from public.branches $$,
  'a user with no tenant sees no branches');
select is_empty($$ select 1 from public.subscriptions $$,
  'a user with no tenant sees no subscriptions');
select is(
  (select count(*) from public.profiles), 1::bigint,
  'a user with no tenant still sees its own profile row, and only that'
);

-- =============================================================================
-- You, the platform admin
-- =============================================================================
set local request.jwt.claims = '{"sub":"99999999-0000-4000-8000-000000000001","role":"authenticated","tenant_id":null,"tenant_role":null,"platform_role":"super_admin"}';

select is((select count(*) from public.tenants), 2::bigint,
  'platform admin reads every tenant');
select is((select count(*) from public.subscriptions), 2::bigint,
  'platform admin reads every subscription');
select is((select count(*) from public.plans), 2::bigint,
  'platform admin reads the plan definitions');
select isnt_empty($$ select 1 from public.audit_log $$,
  'platform admin reads the audit trail');
select isnt_empty($$ select 1 from public.leads $$,
  'platform admin reads the lead queue');
select isnt_empty($$ select 1 from public.tenant_notes $$,
  'platform admin reads support notes');
select isnt_empty($$ select 1 from public.tenant_health $$,
  'platform admin reads health snapshots');
select isnt_empty($$ select 1 from public.renewal_reminders $$,
  'platform admin reads renewal reminders');

-- Impersonation is read-only. The console writes with the service role inside a
-- Server Action; an admin's own JWT must never be able to touch tenant data.
select throws_ok(
  $$ update public.tenants set shop_name = 'Admin was here' $$,
  '42501',
  null,
  'platform admin cannot write tenant data with their own JWT'
);

select throws_ok(
  $$ update public.subscriptions set status = 'active' $$,
  '42501',
  null,
  'platform admin cannot extend a subscription with their own JWT'
);

-- =============================================================================
-- anon — the publishable key with nobody signed in
-- =============================================================================
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select throws_ok($$ select 1 from public.tenants $$, '42501', null,
  'anon cannot read tenants');
select throws_ok($$ select 1 from public.orders $$, '42501', null,
  'anon cannot read the order queue');
select throws_ok($$ select 1 from public.invites $$, '42501', null,
  'anon cannot fish for invite hashes');
select throws_ok(
  $$ insert into public.leads (contact_name, phone) values ('Spam', '0300') $$,
  '42501', null,
  'anon cannot post to leads directly — the demo form goes through a Server Action'
);
select throws_ok($$ select 1 from public.tenant_notes $$, '42501', null,
  'anon cannot read support notes');
select throws_ok($$ select 1 from public.tenant_health $$, '42501', null,
  'anon cannot read health snapshots');
select throws_ok($$ select 1 from public.renewal_reminders $$, '42501', null,
  'anon cannot read renewal reminders');
select throws_ok($$ select 1 from public.request_rate_limits $$, '42501', null,
  'anon cannot inspect rate limits');

-- =============================================================================
-- audit_log is append-only for everyone, including the role that writes it
-- =============================================================================
reset role;

select lives_ok(
  $$ insert into public.audit_log (actor_kind, action) values ('system', 'test.append') $$,
  'audit_log accepts appends'
);

select throws_ok(
  $$ update public.audit_log set action = 'tampered' $$,
  '23001',
  null,
  'audit_log rejects updates even from the migration role'
);

select throws_ok(
  $$ delete from public.audit_log $$,
  '23001',
  null,
  'audit_log rejects deletes even from the migration role'
);

select * from finish();

rollback;
