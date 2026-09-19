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
   'authenticated', 'authenticated', 'you@flo.pk', now(), now()),
  -- Staff, added in 0012. Work emails rather than real ones, because that is
  -- what `app/(app)/app/employees/actions.ts` mints and what the sign-in gate
  -- recognises by its domain.
  ('00000000-0000-0000-0000-000000000000', '44444444-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'bilal@almadina.flopos.pk', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '55555555-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'sana@almadina.flopos.pk', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '66666666-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'imran@bundukhan.flopos.pk', now(), now());

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

-- Tenant A hires two, tenant B one. The point of these rows is that a cashier
-- is an auth user now (0012) rather than a PIN, so every leak test above has to
-- hold for a JWT that is inside the shop and below the owner — which is the
-- account an actual attacker is most likely to be holding.
insert into public.profiles (id, tenant_id, tenant_role, full_name, email, is_active)
values
  ('44444444-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   'cashier', 'Bilal Ahmed', 'bilal@almadina.flopos.pk', true),
  ('55555555-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   'manager', 'Sana Tariq', 'sana@almadina.flopos.pk', true),
  ('66666666-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001',
   'cashier', 'Imran Shah', 'imran@bundukhan.flopos.pk', true);

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

-- 0009 backfills these for every tenant that existed when it ran; A and B are
-- created inside this transaction, so they need their own rows.
insert into public.tenant_settings (tenant_id, currency, day_ends_at)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'PKR', '00:00'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'PKR', '02:00');

insert into public.role_permissions (tenant_id, access_level, discount_ceiling_pct)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'cashier', 5),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'manager', 15),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'cashier', 5);

-- 0010 backfills nothing, so the counters are created here. Tenant A has two,
-- which is the whole point of 0011; B's single one is switched off, the state a
-- shop that has never opened Settings is in.
insert into public.counters (id, tenant_id, branch_id, name, is_active, receipt_prefix, sort_order)
select
  v.id, v.tenant_id, b.id, v.name, v.is_active, v.prefix, v.sort_order
from (values
  ('ccccccc1-0000-4000-8000-000000000001'::uuid, 'aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'Front counter', true, 'ALM', 1::smallint),
  ('ccccccc2-0000-4000-8000-000000000001'::uuid, 'aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'Back counter', true, 'ALM2', 2::smallint),
  ('ccccccc3-0000-4000-8000-000000000001'::uuid, 'bbbbbbbb-0000-4000-8000-000000000001'::uuid, 'Counter 1', false, 'BKK', 1::smallint)
) as v (id, tenant_id, name, is_active, prefix, sort_order)
join public.branches b on b.tenant_id = v.tenant_id and b.is_primary;

-- The catalog tree. Nothing seeds it — 0017 dropped the trigger that used to,
-- because a shop's departments are the shop's — so the rows are created here
-- like the counters above them. Tenant A has two departments and three
-- categories; B has one of each, to be leaked.
insert into public.departments (id, tenant_id, name, sort_order)
values
  ('eeeeeee1-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', 'Grocery', 1),
  ('eeeeeee2-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', 'Beverages', 2),
  ('eeeeeee3-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000001', 'Karahi', 1);

insert into public.categories (tenant_id, department_id, name, sort_order)
values
  ('aaaaaaaa-0000-4000-8000-000000000001',
   'eeeeeee1-0000-4000-8000-000000000001', 'Atta, rice & pulses', 1),
  ('aaaaaaaa-0000-4000-8000-000000000001',
   'eeeeeee1-0000-4000-8000-000000000001', 'Masala & spices', 2),
  ('aaaaaaaa-0000-4000-8000-000000000001',
   'eeeeeee2-0000-4000-8000-000000000001', 'Soft drinks', 1),
  ('bbbbbbbb-0000-4000-8000-000000000001',
   'eeeeeee3-0000-4000-8000-000000000001', 'Mutton', 1);

-- A category cannot hang under another shop's department. The composite foreign
-- key on (department_id, tenant_id) is the only thing enforcing that, and it is
-- worth one assertion here because RLS would not catch it: the service role
-- writes this table and bypasses policies entirely.
select throws_ok(
  $$ insert into public.categories (tenant_id, department_id, name)
     values ('bbbbbbbb-0000-4000-8000-000000000001',
             'eeeeeee1-0000-4000-8000-000000000001', 'Stolen') $$,
  '23503', null,
  'a category cannot be filed under another tenant''s department'
);

-- The customer list, added in 0018. Tenant A knows two people, tenant B one —
-- and B's is the row that must never appear in A's list. A shop's customer list
-- is names and mobile numbers, which is the one table here a competitor would
-- pay for outright.
insert into public.customers (id, tenant_id, name, phone, is_active)
values
  ('fffffff1-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', 'Bilal Ahmed', '03001234567', true),
  ('fffffff2-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', 'Ayesha Khan', null, false),
  ('fffffff3-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000001', 'Imran Sheikh', '03211234567', true);

-- One number is one customer, per shop. The partial unique index is what stops
-- the same regular being entered three times over, which is the one way a
-- customer list rots.
select throws_ok(
  $$ insert into public.customers (tenant_id, name, phone)
     values ('aaaaaaaa-0000-4000-8000-000000000001', 'Bilal again', '03001234567') $$,
  '23505', null,
  'two customers in one shop cannot share a phone number'
);

-- ...and two shops can. Tenant B's customer carries a number tenant A already
-- has, because two kiryanas on one street share a customer and always will.
select lives_ok(
  $$ insert into public.customers (tenant_id, name, phone)
     values ('bbbbbbbb-0000-4000-8000-000000000001', 'Bilal Ahmed', '03001234567') $$,
  'two shops may each hold the same customer phone number'
);

-- One recorded sale each, so the read tests have something to leak.
insert into public.sales (id, tenant_id, branch_id, counter_id, customer_id, receipt_number, business_day, subtotal, total)
select
  v.id, v.tenant_id, b.id, v.counter_id, v.customer_id, v.receipt_number, current_date, v.total, v.total
from (values
  ('dddddddd-0000-4000-8000-000000000001'::uuid, 'aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'ccccccc1-0000-4000-8000-000000000001'::uuid, 'fffffff1-0000-4000-8000-000000000001'::uuid, 'ALM-260916-0001', 450.00),
  ('dddddddd-0000-4000-8000-000000000002'::uuid, 'bbbbbbbb-0000-4000-8000-000000000001'::uuid, 'ccccccc3-0000-4000-8000-000000000001'::uuid, null::uuid, 'BKK-260916-0001', 1200.00)
) as v (id, tenant_id, counter_id, customer_id, receipt_number, total)
join public.branches b on b.tenant_id = v.tenant_id and b.is_primary;

insert into public.sale_tenders (tenant_id, sale_id, method, amount)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001', 'cash', 450.00),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000002', 'card', 1200.00);

-- Something for each sale to have been a sale *of*, so the dashboard has a
-- department to group by and a best seller to rank.
--
-- Note the cost: the catalog says 999 and the line says 300. That gap is the
-- whole of 0019 — the shop raised what it pays for cooking oil after it sold
-- this bottle, and last week's margin must not move with it.
insert into public.items (id, tenant_id, name, unit, selling_price, cost_price, department, category)
values
  ('0a0a0a0a-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', 'Sufi cooking oil 5L', 'piece',
   450.00, 999.00, 'Grocery', 'Atta, rice & pulses'),
  ('0b0b0b0b-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000001', 'Mutton karahi', 'plate',
   1200.00, 800.00, 'Karahi', 'Mutton');

insert into public.sale_lines
  (tenant_id, sale_id, item_id, name_snapshot, unit, quantity, unit_price, line_total, cost_snapshot)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001',
   '0a0a0a0a-0000-4000-8000-000000000001', 'Sufi cooking oil 5L', 'piece',
   1, 450.00, 450.00, 300.00),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000002',
   '0b0b0b0b-0000-4000-8000-000000000001', 'Mutton karahi', 'plate',
   1, 1200.00, 1200.00, 900.00);

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

-- Staff, added in 0012. An owner reads their own roster — that is the screen —
-- and cannot hire, promote or sack anybody with their own JWT, because every
-- one of those goes through a Server Action on the service role.
select is(
  (select count(*) from public.profiles), 3::bigint,
  'tenant A sees its owner and its two staff, and nobody else'
);

select is_empty(
  $$ select 1 from public.profiles where email like '%bundukhan%' $$,
  'tenant A cannot read tenant B staff work emails'
);

select throws_ok(
  $$ insert into public.profiles (id, tenant_id, tenant_role, full_name)
     values ('33333333-0000-4000-8000-000000000001',
             'aaaaaaaa-0000-4000-8000-000000000001', 'cashier', 'Forged hire') $$,
  '42501', null,
  'tenant owner cannot hire staff directly'
);

select throws_ok(
  $$ update public.profiles set tenant_role = 'owner'
      where id = '55555555-0000-4000-8000-000000000001' $$,
  '42501', null,
  'tenant owner cannot change a role directly'
);

select throws_ok(
  $$ delete from public.profiles
      where id = '44444444-0000-4000-8000-000000000001' $$,
  '42501', null,
  'tenant owner cannot delete a staff row directly'
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

-- Settings, added in 0009. Same shape as everything else: readable by its own
-- tenant, invisible to the other, and writable by neither.
select is(
  (select count(*) from public.tenant_settings), 1::bigint,
  'tenant A sees only its own currency and clock settings'
);

select is_empty(
  $$ select 1 from public.tenant_settings
     where tenant_id = 'bbbbbbbb-0000-4000-8000-000000000001' $$,
  'tenant A cannot read tenant B settings'
);

select is(
  (select count(*) from public.role_permissions), 2::bigint,
  'tenant A sees only its own two access levels'
);

select is_empty(
  $$ select 1 from public.role_permissions
     where tenant_id = 'bbbbbbbb-0000-4000-8000-000000000001' $$,
  'tenant A cannot read tenant B permissions'
);

select throws_ok(
  $$ update public.role_permissions set discount_ceiling_pct = 100 $$,
  '42501',
  null,
  'tenant user cannot raise its own discount ceiling directly'
);

select throws_ok(
  $$ update public.tenant_settings set currency = 'USD' $$,
  '42501',
  null,
  'tenant user cannot change its own currency directly'
);

-- The counter, added in 0010. The one that matters commercially: a tenant that
-- could switch its own counter on could bill without the owner ever agreeing
-- the prices, and one that could read another's would read its receipt series.
select is(
  (select count(*) from public.counters), 2::bigint,
  'tenant A sees both of its own counters and nothing else'
);

select is_empty(
  $$ select 1 from public.counters
     where tenant_id = 'bbbbbbbb-0000-4000-8000-000000000001' $$,
  'tenant A cannot read tenant B counter'
);

select throws_ok(
  $$ update public.counters set is_active = true $$,
  '42501',
  null,
  'tenant user cannot open its own counter directly'
);

-- The catalog tree, added in 0016. A shop's departments are the shop's own, so
-- the leak that matters is one kiryana reading another's aisle list — which is
-- its shelf layout, and half of what a competitor would want.
select is(
  (select count(*) from public.departments), 2::bigint,
  'tenant A sees its own two departments and nothing else'
);

select is(
  (select count(*) from public.categories), 3::bigint,
  'tenant A sees its own categories and none of tenant B''s'
);

select is_empty(
  $$ select 1 from public.departments
     where tenant_id = 'bbbbbbbb-0000-4000-8000-000000000001' $$,
  'tenant A cannot read tenant B departments'
);

select is_empty(
  $$ select 1 from public.categories
     where tenant_id = 'bbbbbbbb-0000-4000-8000-000000000001' $$,
  'tenant A cannot read tenant B categories'
);

-- Rule 3: the tree is written by a Server Action on the service role, never
-- from a browser. A tenant that could insert its own department could file an
-- item behind a tile nobody agreed to.
select throws_ok(
  $$ insert into public.departments (tenant_id, name)
     values ('aaaaaaaa-0000-4000-8000-000000000001', 'Forged') $$,
  '42501', null,
  'tenant user cannot add a department directly'
);

select throws_ok(
  $$ delete from public.categories $$,
  '42501', null,
  'tenant user cannot delete its own categories directly'
);

-- The customer list, added in 0018. One shop reading another's customers is
-- reading their names and their mobile numbers — the most directly saleable
-- thing in this schema, and the leak a shopkeeper would never forgive.
select is(
  (select count(*) from public.customers), 2::bigint,
  'tenant A sees its own two customers and neither of tenant B''s'
);

select is_empty(
  $$ select 1 from public.customers
     where tenant_id = 'bbbbbbbb-0000-4000-8000-000000000001' $$,
  'tenant A cannot read tenant B customers'
);

-- A switched-off customer is still tenant A's own row: `is_active` is what the
-- till filters on, never a policy, so the editor can still reach them.
select is(
  (select count(*) from public.customers where not is_active), 1::bigint,
  'a switched-off customer is still readable by their own shop'
);

-- Rule 3: written by a Server Action on the service role and nowhere else. A
-- tenant that could insert its own customers could also edit somebody else's
-- phone number the moment a policy was widened by accident.
select throws_ok(
  $$ insert into public.customers (tenant_id, name)
     values ('aaaaaaaa-0000-4000-8000-000000000001', 'Forged') $$,
  '42501', null,
  'tenant user cannot add a customer directly'
);

select throws_ok(
  $$ update public.customers set phone = '03009999999' $$,
  '42501', null,
  'tenant user cannot edit a customer directly'
);

select throws_ok(
  $$ delete from public.customers $$,
  '42501', null,
  'tenant user cannot delete its own customers directly'
);

-- Takings, added in 0011. The commercially expensive leak: one shop reading
-- another's day, or writing itself a sale that never happened.
select is(
  (select count(*) from public.sales), 1::bigint,
  'tenant A sees only its own sales'
);

select is(
  (select count(*) from public.sale_tenders), 1::bigint,
  'tenant A sees only its own tenders'
);

select is_empty(
  $$ select 1 from public.sales
     where tenant_id = 'bbbbbbbb-0000-4000-8000-000000000001' $$,
  'tenant A cannot read tenant B takings'
);

-- The dashboard, added in 0019. `dashboard_summary` is the one function here
-- granted to `authenticated` rather than kept for the service role, because it
-- is `security invoker`: it runs under the caller's own JWT and every table it
-- touches is behind a policy scoped to the `tenant_id` claim. That makes
-- `p_tenant` a filter and not a permission, which is a claim worth proving
-- rather than asserting in a comment.
select is(
  (public.dashboard_summary(
     'aaaaaaaa-0000-4000-8000-000000000001',
     current_date, current_date, current_date - 1, current_date - 1,
     'Asia/Karachi') #>> '{totals,sales}')::numeric,
  450.00::numeric,
  'the dashboard totals tenant A own takings'
);

-- The point of the cost snapshot. `items.cost_price` on this item is 999 and
-- the line was rung up at 300; a dashboard that joined to the catalog would
-- report this bill as a loss.
select is(
  (public.dashboard_summary(
     'aaaaaaaa-0000-4000-8000-000000000001',
     current_date, current_date, current_date - 1, current_date - 1,
     'Asia/Karachi') #>> '{totals,cost}')::numeric,
  300.00::numeric,
  'the dashboard costs a sale at what the line was stamped with, not at today''s price'
);

select is(
  public.dashboard_summary(
    'aaaaaaaa-0000-4000-8000-000000000001',
    current_date, current_date, current_date - 1, current_date - 1,
    'Asia/Karachi') #>> '{departments,0,name}',
  'Grocery',
  'the dashboard groups a shop sales under its own departments'
);

-- Naming another shop does not fetch it. The policies refuse every row, so the
-- answer is an empty shop rather than tenant B's day.
select is(
  public.dashboard_summary(
    'bbbbbbbb-0000-4000-8000-000000000001',
    current_date, current_date, current_date - 1, current_date - 1,
    'Asia/Karachi') #> '{totals}',
  '{}'::jsonb,
  'tenant A cannot read tenant B figures by naming them to dashboard_summary'
);

-- Reports, added in 0021. `reports_summary` is the second `security invoker`
-- function granted to `authenticated`, and it inherits the whole of the claim
-- above: it runs under the caller's own JWT, so `p_tenant` filters rows a
-- policy has already decided the caller may see.
select is(
  (public.reports_summary(
     'aaaaaaaa-0000-4000-8000-000000000001',
     current_date, current_date, current_date - 1, current_date - 1,
     'Asia/Karachi') #>> '{totals,sales}')::numeric,
  450.00::numeric,
  'reports total tenant A own takings'
);

-- The two aggregates are read by two screens and have to agree to the rupee,
-- or an owner who checks the dashboard against the report has found a bug in
-- one of them and no way to tell which.
select is(
  public.reports_summary(
    'aaaaaaaa-0000-4000-8000-000000000001',
    current_date, current_date, current_date - 1, current_date - 1,
    'Asia/Karachi') #> '{totals,cost}',
  public.dashboard_summary(
    'aaaaaaaa-0000-4000-8000-000000000001',
    current_date, current_date, current_date - 1, current_date - 1,
    'Asia/Karachi') #> '{totals,cost}',
  'reports and the dashboard cost the same window identically'
);

select is(
  public.reports_summary(
    'aaaaaaaa-0000-4000-8000-000000000001',
    current_date, current_date, current_date - 1, current_date - 1,
    'Asia/Karachi') #>> '{departments,0,name}',
  'Grocery',
  'reports group a shop sales under its own departments'
);

-- Naming another shop does not fetch it, exactly as with the dashboard.
select is(
  public.reports_summary(
    'bbbbbbbb-0000-4000-8000-000000000001',
    current_date, current_date, current_date - 1, current_date - 1,
    'Asia/Karachi') #> '{totals}',
  '{}'::jsonb,
  'tenant A cannot read tenant B figures by naming them to reports_summary'
);

-- Rule 3 again, one column along: the cost snapshot is a Server Action write on
-- the service role, and a tenant that could edit it could make its own books
-- say anything.
select throws_ok(
  $$ update public.sale_lines set cost_snapshot = 0 $$,
  '42501', null,
  'tenant user cannot rewrite what a sale cost the shop'
);

select throws_ok(
  $$ insert into public.sales (id, tenant_id, branch_id, receipt_number, business_day, subtotal, total)
     select gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', b.id, 'FORGED-1', current_date, 0, 0
     from public.branches b where b.tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001' limit 1 $$,
  '42501', null,
  'tenant user cannot write itself a sale'
);

select throws_ok(
  $$ update public.sales set total = 1 $$,
  '42501', null,
  'tenant user cannot rewrite what a sale was worth'
);

-- record_sale is the one write path, and it belongs to the service role. A
-- tenant that could call it directly could claim receipt numbers on any counter
-- it could name.
select throws_ok(
  $$ select public.record_sale(
       'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
       'ccccccc1-0000-4000-8000-000000000001'::uuid,
       gen_random_uuid(), current_date, null, 0, 0, 'cash', '[]'::jsonb, null) $$,
  '42501', null,
  'tenant user cannot call record_sale'
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
-- A cashier at tenant A — the account the shop hands out most, and therefore
-- the one whose JWT is most likely to end up somewhere it should not. Nothing
-- below is gated on being the owner: the role checks that stop a cashier
-- editing staff or raising a ceiling live in the Server Actions, and this
-- asserts the database refuses them anyway.
-- =============================================================================
set local request.jwt.claims = '{"sub":"44444444-0000-4000-8000-000000000001","role":"authenticated","tenant_id":"aaaaaaaa-0000-4000-8000-000000000001","tenant_role":"cashier","platform_role":null}';

select is(
  (select count(*) from public.tenants), 1::bigint,
  'a cashier sees the shop they work at'
);

select is_empty(
  $$ select 1 from public.profiles
     where tenant_id = 'bbbbbbbb-0000-4000-8000-000000000001' $$,
  'a cashier cannot read another shop''s staff'
);

select throws_ok(
  $$ update public.profiles set tenant_role = 'owner'
      where id = '44444444-0000-4000-8000-000000000001' $$,
  '42501', null,
  'a cashier cannot promote themselves to owner'
);

select throws_ok(
  $$ update public.profiles set is_active = false
      where id = '55555555-0000-4000-8000-000000000001' $$,
  '42501', null,
  'a cashier cannot suspend their manager'
);

select throws_ok(
  $$ update public.role_permissions set discount_ceiling_pct = 100
      where access_level = 'cashier' $$,
  '42501', null,
  'a cashier cannot raise their own discount ceiling'
);

select throws_ok(
  $$ update public.sales set total = 1 $$,
  '42501', null,
  'a cashier cannot rewrite what a sale was worth'
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
select is_empty($$ select 1 from public.tenant_settings $$,
  'a user with no tenant sees no settings');
select is_empty($$ select 1 from public.role_permissions $$,
  'a user with no tenant sees no permissions');
select is_empty($$ select 1 from public.counters $$,
  'a user with no tenant sees no counter');
select is_empty($$ select 1 from public.sales $$,
  'a user with no tenant sees no sales');
select is_empty($$ select 1 from public.departments $$,
  'a user with no tenant sees no departments');
select is_empty($$ select 1 from public.categories $$,
  'a user with no tenant sees no categories');
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
select throws_ok($$ select 1 from public.tenant_settings $$, '42501', null,
  'anon cannot read shop settings');
select throws_ok($$ select 1 from public.role_permissions $$, '42501', null,
  'anon cannot read what a cashier is allowed to do');
select throws_ok($$ select 1 from public.counters $$, '42501', null,
  'anon cannot read the counters or their receipt series');
select throws_ok($$ select 1 from public.sales $$, '42501', null,
  'anon cannot read a shop''s takings');
select throws_ok($$ select 1 from public.departments $$, '42501', null,
  'anon cannot read a shop''s departments');
select throws_ok($$ select 1 from public.categories $$, '42501', null,
  'anon cannot read a shop''s categories');

-- =============================================================================
-- audit_log is append-only for everyone, including the role that writes it
-- =============================================================================
reset role;

-- =============================================================================
-- Work emails are one per person, enforced by the index rather than by the
-- action that goes looking for a free one. Two staff sharing a login is two
-- staff one password away from each other's shift.
-- =============================================================================
select throws_ok(
  $$ update public.profiles set email = 'bilal@almadina.flopos.pk'
      where id = '55555555-0000-4000-8000-000000000001' $$,
  '23505', null,
  'two staff cannot share a work email'
);

select throws_ok(
  $$ update public.profiles set tenant_role = 'accountant'
      where id = '44444444-0000-4000-8000-000000000001' $$,
  '23514', null,
  'a role that is not owner, manager or cashier is refused'
);

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

-- =============================================================================
-- Append-only must not mean nobody can ever be removed
--
-- 0014's regression. `audit_log.actor_id` used to reference `auth.users`
-- `on delete set null`, so deleting an account made Postgres run an update
-- against the log — and the append-only trigger is statement-level, so it
-- refused that update whether or not the account had ever appeared in it. Every
-- staff removal in the console failed on it.
--
-- Both halves are asserted here: the account goes, and the entry it left behind
-- still says who did it.
-- =============================================================================
insert into public.audit_log (actor_id, actor_kind, action, tenant_id)
values ('66666666-0000-4000-8000-000000000001', 'tenant_user',
        'staff.created', 'bbbbbbbb-0000-4000-8000-000000000001');

select lives_ok(
  $$ delete from auth.users where id = '66666666-0000-4000-8000-000000000001' $$,
  'a staff account that appears in audit_log can still be deleted'
);

select isnt_empty(
  $$ select 1 from public.audit_log
      where actor_id = '66666666-0000-4000-8000-000000000001'
        and action = 'staff.created' $$,
  'the audit entry keeps its actor after the account is gone'
);

select * from finish();

rollback;
