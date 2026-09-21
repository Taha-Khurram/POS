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

-- The supplier list, added in 0027. Tenant A buys from two distributors and
-- tenant B from one. Who a shop buys from — and at what terms — is as saleable
-- as its customer list: it is the whole of a competitor's sourcing.
insert into public.suppliers (id, tenant_id, name, phone, is_active)
values
  ('f5555551-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', 'Ravi Trading', '03004445555', true),
  ('f5555552-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', 'Shan Foods', null, false),
  ('f5555553-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000001', 'Karachi Wholesale', '03211112222', true);

-- The name is the identity, folded for case and spacing — which is the whole
-- point of the table. "Ravi Trading" and "ravi  trading" were always one party,
-- and an index that let both in would rebuild, one row at a time, the mess of
-- spellings 0027 existed to undo.
select throws_ok(
  $$ insert into public.suppliers (tenant_id, name)
     values ('aaaaaaaa-0000-4000-8000-000000000001', 'ravi  trading') $$,
  '23505', null,
  'two suppliers in one shop cannot share a name, whatever the case or spacing'
);

-- ...and two shops can. Two kiryanas on one street buy from the same
-- distributor and always will.
select lives_ok(
  $$ insert into public.suppliers (tenant_id, name)
     values ('bbbbbbbb-0000-4000-8000-000000000001', 'Ravi Trading') $$,
  'two shops may each buy from a supplier of the same name'
);

-- One order and one delivery each, so the buying read tests have something to
-- leak. Written directly here because the fixtures run before the role switch;
-- in the product both only ever arrive through `save_purchase_order` and
-- `record_receipt`, which is what the write tests further down prove.
insert into public.purchase_orders (id, tenant_id, branch_id, supplier_id, order_number, status, subtotal, total)
select v.id, v.tenant_id, b.id, v.supplier_id, v.order_number, 'placed', v.total, v.total
  from (values
    ('f6666661-0000-4000-8000-000000000001'::uuid,
     'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
     'f5555551-0000-4000-8000-000000000001'::uuid, 'PO-00001', 6240.00),
    ('f6666662-0000-4000-8000-000000000001'::uuid,
     'bbbbbbbb-0000-4000-8000-000000000001'::uuid,
     'f5555553-0000-4000-8000-000000000001'::uuid, 'PO-00001', 990.00)
  ) as v (id, tenant_id, supplier_id, order_number, total)
  join public.branches b on b.tenant_id = v.tenant_id and b.is_primary;

insert into public.purchase_order_lines (id, tenant_id, purchase_order_id, name_snapshot, unit, quantity, unit_cost, line_total)
values
  ('f7777771-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001',
   'f6666661-0000-4000-8000-000000000001', 'Coca-Cola 1.5 L', 'piece', 24, 260, 6240),
  ('f7777772-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000001',
   'f6666662-0000-4000-8000-000000000001', 'Chai patti 1 kg', 'packet', 3, 330, 990);

insert into public.goods_receipts (id, tenant_id, branch_id, supplier_id, purchase_order_id, grn_number, received_on, subtotal, freight, total)
select v.id, v.tenant_id, b.id, v.supplier_id, v.order_id, v.grn_number, current_date,
       v.subtotal, v.freight, v.subtotal + v.freight
  from (values
    ('f8888881-0000-4000-8000-000000000001'::uuid,
     'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
     'f5555551-0000-4000-8000-000000000001'::uuid,
     'f6666661-0000-4000-8000-000000000001'::uuid, 'GRN-00001', 3120.00, 200.00),
    ('f8888882-0000-4000-8000-000000000001'::uuid,
     'bbbbbbbb-0000-4000-8000-000000000001'::uuid,
     'f5555553-0000-4000-8000-000000000001'::uuid,
     'f6666662-0000-4000-8000-000000000001'::uuid, 'GRN-00001', 990.00, 0.00)
  ) as v (id, tenant_id, supplier_id, order_id, grn_number, subtotal, freight)
  join public.branches b on b.tenant_id = v.tenant_id and b.is_primary;

-- The landed cost carries the freight: 3120 of goods plus 200 of bhaara over 12
-- units is 276.6667 each, and 276.6667 x 12 is 3320 — the receipt total to the
-- paisa. That identity is what `record_receipt`'s apportionment exists to hold,
-- and the fixture states it so a future change to the arithmetic has something
-- concrete to be wrong against.
insert into public.goods_receipt_lines (tenant_id, goods_receipt_id, purchase_order_line_id, name_snapshot, unit, quantity, unit_cost, line_total, landed_unit_cost)
values
  ('aaaaaaaa-0000-4000-8000-000000000001',
   'f8888881-0000-4000-8000-000000000001',
   'f7777771-0000-4000-8000-000000000001', 'Coca-Cola 1.5 L', 'piece', 12, 260, 3120, 276.6667),
  ('bbbbbbbb-0000-4000-8000-000000000001',
   'f8888882-0000-4000-8000-000000000001',
   'f7777772-0000-4000-8000-000000000001', 'Chai patti 1 kg', 'packet', 3, 330, 990, 330.0000);

-- Variants, added in 0031. Tenant B sells one item by size and colour. Its
-- grid is its price list and its stock depth in one table.
update public.items
   set tracking = 'variant',
       variant_axes = array['Size','Colour'],
       -- Given a code so the cross-table trigger below has something real to
       -- collide with. Without it that assertion would pass for the wrong
       -- reason and prove nothing.
       barcode = 'BKK-CODE-1'
 where id = '0b0b0b0b-0000-4000-8000-000000000001';

insert into public.item_variants (id, tenant_id, item_id, option_a, option_b, barcode, quantity)
values
  ('fa0a0a01-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000001',
   '0b0b0b0b-0000-4000-8000-000000000001', 'Half', 'Plain', 'V-1', 4),
  ('fa0a0a02-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000001',
   '0b0b0b0b-0000-4000-8000-000000000001', 'Full', 'Plain', 'V-2', 2);

-- One row per combination, folded for case: "Plain" and "plain" are one thing
-- on one shelf and two rows would be two stock figures for it.
select throws_ok(
  $$ insert into public.item_variants (tenant_id, item_id, option_a, option_b)
     values ('bbbbbbbb-0000-4000-8000-000000000001',
             '0b0b0b0b-0000-4000-8000-000000000001', 'half', 'PLAIN') $$,
  '23505', null,
  'one item cannot hold the same combination twice, whatever the case'
);

-- An item is split by batch or by variant, never both. Batches-per-variant is a
-- third level for a shop that does not exist.
select throws_ok(
  $$ update public.items set tracks_batches = true
      where id = '0b0b0b0b-0000-4000-8000-000000000001' $$,
  '23514', null,
  'an item cannot be counted by batch and sold by variant at once'
);

-- A barcode means exactly one thing. Two tables, so no single index can say it
-- — the trigger in 0031 does, in both directions.
select throws_ok(
  $$ insert into public.item_variants (tenant_id, item_id, option_a, barcode)
     values ('bbbbbbbb-0000-4000-8000-000000000001',
             '0b0b0b0b-0000-4000-8000-000000000001', 'Extra', 'BKK-CODE-1') $$,
  '23505', null,
  'a variant cannot take a barcode an item already carries'
);

-- One payment each, and an opening balance on tenant A's supplier, so the
-- ledger read tests have something to leak. What a shop owes and to whom is its
-- cash position — the one thing a competitor could use directly.
update public.suppliers
   set opening_balance = 50000, opening_balance_on = current_date - 90
 where id = 'f5555551-0000-4000-8000-000000000001';

insert into public.supplier_payments (tenant_id, supplier_id, paid_on, amount, method, reference)
values
  ('aaaaaaaa-0000-4000-8000-000000000001',
   'f5555551-0000-4000-8000-000000000001', current_date - 10, 20000, 'bank', 'IBFT-1'),
  ('bbbbbbbb-0000-4000-8000-000000000001',
   'f5555553-0000-4000-8000-000000000001', current_date - 5, 900, 'cash', null);

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

-- Batches, added in 0030. Tenant A tracks one item by batch: two live batches,
-- one of them already out of date. What a shop holds and when it goes off is
-- both commercially sensitive and, for a pharmacy, regulated.
update public.items
   set tracks_batches = true
 where id = '0a0a0a0a-0000-4000-8000-000000000001';

insert into public.item_batches (id, tenant_id, item_id, batch_no, expires_on, quantity, unit_cost)
values
  ('f9999991-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001',
   '0a0a0a0a-0000-4000-8000-000000000001', 'B-GOOD', current_date + 90, 12, 148),
  ('f9999992-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001',
   '0a0a0a0a-0000-4000-8000-000000000001', 'B-OLD', current_date - 3, 4, 140);

-- One batch per item per number-and-expiry. A second delivery of the same batch
-- tops the row up; a second row would be two expiry dates for one carton.
select throws_ok(
  $$ insert into public.item_batches (tenant_id, item_id, batch_no, expires_on, quantity)
     values ('aaaaaaaa-0000-4000-8000-000000000001',
             '0a0a0a0a-0000-4000-8000-000000000001', 'B-GOOD', current_date + 90, 1) $$,
  '23505', null,
  'one item cannot hold the same batch number and expiry twice'
);

-- A batch is a number, a date, or both. Neither is not a batch — it is the
-- item's ordinary stock, and there is already a column for that.
select throws_ok(
  $$ insert into public.item_batches (tenant_id, item_id, quantity)
     values ('aaaaaaaa-0000-4000-8000-000000000001',
             '0a0a0a0a-0000-4000-8000-000000000001', 5) $$,
  '23514', null,
  'a batch with neither a number nor an expiry is refused'
);

insert into public.sale_lines
  (tenant_id, sale_id, item_id, name_snapshot, unit, quantity, unit_price, line_total, cost_snapshot)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001',
   '0a0a0a0a-0000-4000-8000-000000000001', 'Sufi cooking oil 5L', 'piece',
   1, 450.00, 450.00, 300.00),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000002',
   '0b0b0b0b-0000-4000-8000-000000000001', 'Mutton karahi', 'plate',
   1, 1200.00, 1200.00, 900.00);

-- The stock ledger, added in 0022. One movement each, so the read tests have
-- something to leak and the sign convention has something to assert against.
insert into public.stock_movements
  (id, tenant_id, item_id, reason, quantity, stock_after, sale_id)
values
  ('5a5a5a5a-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', '0a0a0a0a-0000-4000-8000-000000000001',
   'sale', -1, 47, 'dddddddd-0000-4000-8000-000000000001'),
  ('5b5b5b5b-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000001', '0b0b0b0b-0000-4000-8000-000000000001',
   'sale', -1, 12, 'dddddddd-0000-4000-8000-000000000002');

-- A bill parked at each shop's counter, added in 0025. Deliberately not on
-- `sales`: a held bill has no receipt number, and the whole point of the
-- separate table is that it never claims one.
insert into public.held_bills (id, tenant_id, counter_id, label, lines)
values
  ('6a6a6a6a-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', 'ccccccc1-0000-4000-8000-000000000001',
   'Blue shirt',
   '[{"item_id":"0a0a0a0a-0000-4000-8000-000000000001","quantity":2}]'::jsonb),
  ('6b6b6b6b-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000001', 'ccccccc3-0000-4000-8000-000000000001',
   'Table 4',
   '[{"item_id":"0b0b0b0b-0000-4000-8000-000000000001","quantity":1}]'::jsonb);

-- A drawer open at each shop, added in 0026.
insert into public.shifts
  (id, tenant_id, branch_id, counter_id, opened_by, opening_float, status)
select
  v.id, v.tenant_id, b.id, v.counter_id, v.opened_by, v.opening_float, 'open'
from (values
  ('7a7a7a7a-0000-4000-8000-000000000001'::uuid, 'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
   'ccccccc1-0000-4000-8000-000000000001'::uuid,
   '44444444-0000-4000-8000-000000000001'::uuid, 2000.00),
  ('7b7b7b7b-0000-4000-8000-000000000001'::uuid, 'bbbbbbbb-0000-4000-8000-000000000001'::uuid,
   'ccccccc3-0000-4000-8000-000000000001'::uuid,
   null::uuid, 500.00)
) as v (id, tenant_id, counter_id, opened_by, opening_float)
join public.branches b on b.tenant_id = v.tenant_id and b.is_primary;

-- Tenders, widened by 0032. Tenant A's front counter takes the wallets; B's
-- takes cash only, which is the state a shop that has never opened Settings is
-- in. The column replaced two booleans, so an accepted method is a value in a
-- list now and not a column somebody forgot to add.
update public.counters
   set accepted_tenders = array['cash','card','easypaisa','jazzcash']
 where id = 'ccccccc1-0000-4000-8000-000000000001';

-- A reference against a wallet payment. Sensitive in its own right: an
-- Easypaisa transaction id is a handle on somebody's account, and it is the
-- one field on a tender that identifies a person.
insert into public.sale_tenders (tenant_id, sale_id, method, amount, reference)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001',
   'easypaisa', 0.01, 'EP-9912345');

-- Restaurant mode, added in 0033. Tenant B is the karahi house and the only one
-- of the two that seats anybody — which is also what makes these tables a
-- clean leak test: tenant A must see an empty floor, not a filtered one.
update public.tenant_settings
   set restaurant_mode = true
 where tenant_id = 'bbbbbbbb-0000-4000-8000-000000000001';

insert into public.dining_tables (id, tenant_id, branch_id, name, area, seats, sort_order)
select
  v.id, v.tenant_id, b.id, v.name, v.area, v.seats, v.sort_order
from (values
  ('fb0b0b01-0000-4000-8000-000000000001'::uuid, 'bbbbbbbb-0000-4000-8000-000000000001'::uuid,
   'T1', 'Family hall', 6::smallint, 1),
  ('fb0b0b02-0000-4000-8000-000000000001'::uuid, 'bbbbbbbb-0000-4000-8000-000000000001'::uuid,
   'T2', 'Terrace', 4::smallint, 2)
) as v (id, tenant_id, name, area, seats, sort_order)
join public.branches b on b.tenant_id = v.tenant_id and b.is_primary;

-- One name per shop, whatever the case: "t1" and "T1" are two rows nobody can
-- tell apart on a kitchen ticket, which is the whole point of the index.
select throws_ok(
  $$ insert into public.dining_tables (tenant_id, branch_id, name)
     select 'bbbbbbbb-0000-4000-8000-000000000001', b.id, 't1'
       from public.branches b
      where b.tenant_id = 'bbbbbbbb-0000-4000-8000-000000000001' and b.is_primary $$,
  '23505', null,
  'one shop cannot have two tables called T1'
);

insert into public.table_orders
  (id, tenant_id, branch_id, table_id, order_number, service, covers, opened_by)
select
  'fb1b1b01-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001',
  b.id, 'fb0b0b01-0000-4000-8000-000000000001', 'T-00001', 'dine_in', 4::smallint, null
from public.branches b
where b.tenant_id = 'bbbbbbbb-0000-4000-8000-000000000001' and b.is_primary;

-- **One open bill per table.** The index and not a Server Action, because two
-- waiters opening T1 in the same second is the ordinary way a restaurant ends
-- up charging one party twice.
select throws_ok(
  $$ insert into public.table_orders
       (id, tenant_id, branch_id, table_id, order_number, service)
     select gen_random_uuid(), 'bbbbbbbb-0000-4000-8000-000000000001', b.id,
            'fb0b0b01-0000-4000-8000-000000000001', 'T-00002', 'dine_in'
       from public.branches b
      where b.tenant_id = 'bbbbbbbb-0000-4000-8000-000000000001' and b.is_primary $$,
  '23505', null,
  'a table cannot carry two open bills at once'
);

-- A dine-in is at a table and a parcel is not. An order with neither is one
-- nobody can find; an order with both is one two waiters will serve.
select throws_ok(
  $$ insert into public.table_orders
       (id, tenant_id, branch_id, order_number, service)
     select gen_random_uuid(), 'bbbbbbbb-0000-4000-8000-000000000001', b.id,
            'T-00003', 'dine_in'
       from public.branches b
      where b.tenant_id = 'bbbbbbbb-0000-4000-8000-000000000001' and b.is_primary $$,
  '23514', null,
  'a dine-in order with no table is refused'
);

insert into public.item_modifiers (id, tenant_id, item_id, group_name, name, price_delta)
values
  ('fb2b2b01-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000001',
   '0b0b0b0b-0000-4000-8000-000000000001', 'Add-ons', 'Extra raita', 80);

insert into public.kots (id, tenant_id, order_id, kot_number)
values
  ('fb3b3b01-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000001',
   'fb1b1b01-0000-4000-8000-000000000001', 'KOT-00001');

insert into public.table_order_lines
  (id, tenant_id, order_id, item_id, name_snapshot, unit, quantity, unit_price, course, status, kot_id)
values
  ('fb4b4b01-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000001', 'fb1b1b01-0000-4000-8000-000000000001',
   '0b0b0b0b-0000-4000-8000-000000000001', 'Mutton karahi', 'plate',
   1, 1200.00, 'main', 'sent', 'fb3b3b01-0000-4000-8000-000000000001');

insert into public.table_order_line_modifiers
  (tenant_id, line_id, modifier_id, name_snapshot, price_delta)
values
  ('bbbbbbbb-0000-4000-8000-000000000001',
   'fb4b4b01-0000-4000-8000-000000000001',
   'fb2b2b01-0000-4000-8000-000000000001', 'Extra raita', 80);

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

-- The supplier list, added in 0027. Reading another shop's suppliers is reading
-- where they source and what they pay — which is the one thing a competitor
-- wants more than the customer list.
select is(
  (select count(*) from public.suppliers), 2::bigint,
  'tenant A sees its own two suppliers and neither of tenant B''s'
);

select is_empty(
  $$ select 1 from public.suppliers
     where tenant_id = 'bbbbbbbb-0000-4000-8000-000000000001' $$,
  'tenant A cannot read tenant B suppliers'
);

-- A switched-off supplier is still tenant A's own row: `is_active` is what the
-- pickers filter on, never a policy, so the editor can still reach them.
select is(
  (select count(*) from public.suppliers where not is_active), 1::bigint,
  'a switched-off supplier is still readable by their own shop'
);

-- Rule 3 again: every write is a Server Action on the service role.
select throws_ok(
  $$ insert into public.suppliers (tenant_id, name)
     values ('aaaaaaaa-0000-4000-8000-000000000001', 'Forged Distributors') $$,
  '42501', null,
  'tenant user cannot add a supplier directly'
);

select throws_ok(
  $$ update public.suppliers set payment_terms_days = 365 $$,
  '42501', null,
  'tenant user cannot edit a supplier directly'
);

select throws_ok(
  $$ delete from public.suppliers $$,
  '42501', null,
  'tenant user cannot delete its own suppliers directly'
);

-- Buying, added in 0028. An order and a delivery are the two documents that say
-- what a shop pays for its stock — which is its margin, its sourcing and its
-- negotiating position in three tables. One shop reading another's is worse
-- than reading its sales: a competitor learns what to undercut and by how much.
select is(
  (select count(*) from public.purchase_orders), 1::bigint,
  'tenant A sees only its own purchase orders'
);

select is_empty(
  $$ select 1 from public.purchase_orders
     where tenant_id = 'bbbbbbbb-0000-4000-8000-000000000001' $$,
  'tenant A cannot read tenant B purchase orders'
);

select is(
  (select count(*) from public.purchase_order_lines), 1::bigint,
  'tenant A sees only its own order lines'
);

select is(
  (select count(*) from public.goods_receipts), 1::bigint,
  'tenant A sees only its own deliveries'
);

select is_empty(
  $$ select 1 from public.goods_receipts
     where tenant_id = 'bbbbbbbb-0000-4000-8000-000000000001' $$,
  'tenant A cannot read tenant B deliveries'
);

-- `landed_unit_cost` is the single most sensitive number in this schema: it is
-- what a shop really pays once carriage is in, which is the floor under every
-- price it can quote.
select is(
  (select count(*) from public.goods_receipt_lines), 1::bigint,
  'tenant A sees only its own delivery lines, landed cost and all'
);

-- The document series is the one table in 0028 with no read policy at all.
-- Nothing in the console draws it, and a running count of a shop's orders tells
-- a competitor how much it buys.
select is_empty(
  $$ select 1 from public.document_series $$,
  'no tenant user can read the document series, not even its own'
);

-- Rule 3, five more times. Every write is a security-definer function granted
-- to the service role, so a tenant JWT has no insert path at all — which is
-- what stops somebody writing themselves a delivery and moving their own cost
-- price to whatever makes the margin look right.
select throws_ok(
  $$ insert into public.purchase_orders (id, tenant_id, branch_id, supplier_id, order_number)
     select gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', b.id,
            'f5555551-0000-4000-8000-000000000001', 'PO-FORGED'
       from public.branches b
      where b.tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001' and b.is_primary $$,
  '42501', null,
  'tenant user cannot raise a purchase order directly'
);

select throws_ok(
  $$ insert into public.goods_receipts (id, tenant_id, branch_id, supplier_id, grn_number, received_on)
     select gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', b.id,
            'f5555551-0000-4000-8000-000000000001', 'GRN-FORGED', current_date
       from public.branches b
      where b.tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001' and b.is_primary $$,
  '42501', null,
  'tenant user cannot record a delivery directly'
);

select throws_ok(
  $$ update public.goods_receipt_lines set landed_unit_cost = 1 $$,
  '42501', null,
  'tenant user cannot rewrite what a delivery cost'
);

select throws_ok(
  $$ delete from public.purchase_orders $$,
  '42501', null,
  'tenant user cannot delete its own purchase orders directly'
);

-- Neither of the two purchasing functions is reachable from a tenant JWT. They
-- are `security definer` and granted to `service_role` alone, so a caller who
-- found the names could otherwise stock their own shelf and move their own
-- costs without a Server Action in the way.
select throws_ok(
  $$ select public.record_receipt(
       'aaaaaaaa-0000-4000-8000-000000000001', gen_random_uuid(),
       'f5555551-0000-4000-8000-000000000001', null, current_date,
       null, null, 0, 0, '[]'::jsonb, null) $$,
  '42501', null,
  'tenant user cannot call record_receipt'
);

select throws_ok(
  $$ select public.save_purchase_order(
       'aaaaaaaa-0000-4000-8000-000000000001', gen_random_uuid(),
       'f5555551-0000-4000-8000-000000000001', null, null, 'draft', '[]'::jsonb, null) $$,
  '42501', null,
  'tenant user cannot call save_purchase_order'
);

-- The supplier ledger, added in 0029. A balance is the shop's cash position
-- seen from the other side, and the payments under it name its bank references.
select is(
  (select count(*) from public.supplier_payments), 1::bigint,
  'tenant A sees only its own supplier payments'
);

select is_empty(
  $$ select 1 from public.supplier_payments
     where tenant_id = 'bbbbbbbb-0000-4000-8000-000000000001' $$,
  'tenant A cannot read tenant B supplier payments'
);

select throws_ok(
  $$ insert into public.supplier_payments (tenant_id, supplier_id, paid_on, amount)
     values ('aaaaaaaa-0000-4000-8000-000000000001',
             'f5555551-0000-4000-8000-000000000001', current_date, 1) $$,
  '42501', null,
  'tenant user cannot record a supplier payment directly'
);

select throws_ok(
  $$ update public.supplier_payments set amount = 1 $$,
  '42501', null,
  'tenant user cannot change what was paid'
);

-- `supplier_balances` is the one purchasing function granted to `authenticated`,
-- like `dashboard_summary` and `reports_summary`. It is `security invoker`, so
-- naming another shop is a filter that RLS then empties rather than a way in —
-- which is the property that has to be proven, not assumed.
select is(
  (select count(*) from public.supplier_balances('aaaaaaaa-0000-4000-8000-000000000001')),
  2::bigint,
  'supplier_balances returns tenant A''s own two suppliers'
);

select is_empty(
  $$ select 1 from public.supplier_balances('bbbbbbbb-0000-4000-8000-000000000001') $$,
  'supplier_balances names another tenant and gets nothing, because RLS is the gate'
);

-- The invoiced figure is the deliveries' own totals, carriage included: 3120
-- of goods plus 200 of bhaara on tenant A's single receipt.
select is(
  (select invoiced from public.supplier_balances('aaaaaaaa-0000-4000-8000-000000000001')
    where supplier_id = 'f5555551-0000-4000-8000-000000000001'),
  3320::numeric,
  'a supplier''s invoiced total counts the freight on the delivery'
);

-- Batches, added in 0030. A shop's expiry dates are its regulatory exposure and
-- its markdown schedule in one table.
select is(
  (select count(*) from public.item_batches), 2::bigint,
  'tenant A sees its own two batches'
);

select is_empty(
  $$ select 1 from public.item_batches
     where tenant_id = 'bbbbbbbb-0000-4000-8000-000000000001' $$,
  'tenant A cannot read tenant B batches'
);

-- Rule 3. `private.move_stock` is the only writer of item_batches.quantity
-- anywhere, and it is revoked from everybody — which is what stops the two
-- counts drifting, not a policy.
select throws_ok(
  $$ update public.item_batches set quantity = 999 $$,
  '42501', null,
  'tenant user cannot move a batch count directly'
);

select throws_ok(
  $$ insert into public.item_batches (tenant_id, item_id, batch_no, quantity)
     values ('aaaaaaaa-0000-4000-8000-000000000001',
             '0a0a0a0a-0000-4000-8000-000000000001', 'FORGED', 100) $$,
  '42501', null,
  'tenant user cannot open a batch directly'
);

select throws_ok(
  $$ select public.adjust_batch('aaaaaaaa-0000-4000-8000-000000000001',
       'f9999991-0000-4000-8000-000000000001', 0, 'expired', null, null) $$,
  '42501', null,
  'tenant user cannot write a batch off'
);

select throws_ok(
  $$ select public.open_batch('aaaaaaaa-0000-4000-8000-000000000001',
       '0a0a0a0a-0000-4000-8000-000000000001', 'X', null, 1, 0, null, null) $$,
  '42501', null,
  'tenant user cannot call open_batch'
);

-- Variants, added in 0031. A shop's grid is its price list and its stock depth,
-- and tenant A must see none of tenant B's.
select is_empty(
  $$ select 1 from public.item_variants $$,
  'tenant A has no variants of its own and sees none of tenant B''s'
);

-- Rule 3. `private.move_stock` is the only writer of item_variants.quantity and
-- `public.save_variants` the only writer of the grid — which is what keeps the
-- rows and items.stock in step, not a policy.
select throws_ok(
  $$ update public.item_variants set quantity = 999 $$,
  '42501', null,
  'tenant user cannot move a variant count directly'
);

select throws_ok(
  $$ select public.save_variants('aaaaaaaa-0000-4000-8000-000000000001',
       '0a0a0a0a-0000-4000-8000-000000000001', array['Size'], '[]'::jsonb, null) $$,
  '42501', null,
  'tenant user cannot call save_variants'
);

select throws_ok(
  $$ select public.adjust_variant('aaaaaaaa-0000-4000-8000-000000000001',
       'fa0a0a01-0000-4000-8000-000000000001', 1, 'count', null, null) $$,
  '42501', null,
  'tenant user cannot call adjust_variant'
);

-- Tenders, widened by 0032. The reference is the sensitive half: a wallet
-- transaction id is a handle on the customer's own account.
select is(
  (select count(*) from public.sale_tenders where reference is not null), 1::bigint,
  'tenant A sees the reference on its own wallet payment'
);

select is_empty(
  $$ select 1 from public.sale_tenders
     where tenant_id = 'bbbbbbbb-0000-4000-8000-000000000001' $$,
  'tenant A cannot read how tenant B was paid'
);

-- Which methods a counter takes is a setting, and Rule 3 holds: the shop reads
-- it and the Server Action writes it. A till that could widen its own list is a
-- till that can take a method the shop never agreed to reconcile.
select throws_ok(
  $$ update public.counters set accepted_tenders = array['cash'] $$,
  '42501', null,
  'tenant user cannot change which tenders a counter takes'
);

-- Restaurant mode, added in 0033. Tenant A is a kiryana and seats nobody, so
-- each of these is empty for the right reason and the wrong one at once —
-- which is why B's own session asserts the other half further down.
select is_empty(
  $$ select 1 from public.dining_tables $$,
  'tenant A has no floor of its own and cannot see tenant B''s'
);

select is_empty(
  $$ select 1 from public.table_orders $$,
  'tenant A cannot read who is sitting at tenant B''s tables'
);

select is_empty(
  $$ select 1 from public.table_order_lines $$,
  'tenant A cannot read what tenant B''s tables ordered'
);

select is_empty(
  $$ select 1 from public.table_order_line_modifiers $$,
  'tenant A cannot read what tenant B''s tables asked for on the side'
);

select is_empty(
  $$ select 1 from public.kots $$,
  'tenant A cannot read tenant B''s kitchen tickets'
);

select is_empty(
  $$ select 1 from public.item_modifiers $$,
  'tenant A cannot read tenant B''s add-ons and what they cost'
);

-- Rule 3 again, across the floor. Every one of these is a security-definer
-- function for the reason `record_sale` is: a ticket and the lines it fired
-- have to become true together, and a settle claims a receipt number.
select throws_ok(
  $$ insert into public.table_orders (id, tenant_id, branch_id, order_number, service)
     select gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', b.id,
            'T-00001', 'parcel'
       from public.branches b
      where b.tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001' and b.is_primary $$,
  '42501', null,
  'tenant user cannot open a table order directly'
);

select throws_ok(
  $$ update public.table_order_lines set status = 'void' $$,
  '42501', null,
  'tenant user cannot void a line off a bill directly'
);

select throws_ok(
  $$ select public.open_table_order('aaaaaaaa-0000-4000-8000-000000000001',
       gen_random_uuid(), null, 'parcel', null, null, null) $$,
  '42501', null,
  'tenant user cannot call open_table_order'
);

select throws_ok(
  $$ select public.add_order_lines('aaaaaaaa-0000-4000-8000-000000000001',
       'fb1b1b01-0000-4000-8000-000000000001', '[]'::jsonb, null) $$,
  '42501', null,
  'tenant user cannot call add_order_lines'
);

select throws_ok(
  $$ select public.send_to_kitchen('aaaaaaaa-0000-4000-8000-000000000001',
       'fb1b1b01-0000-4000-8000-000000000001', null) $$,
  '42501', null,
  'tenant user cannot call send_to_kitchen'
);

select throws_ok(
  $$ select public.void_order_line('aaaaaaaa-0000-4000-8000-000000000001',
       'fb4b4b01-0000-4000-8000-000000000001', 'changed their mind', null) $$,
  '42501', null,
  'tenant user cannot call void_order_line'
);

select throws_ok(
  $$ select public.move_table_order('aaaaaaaa-0000-4000-8000-000000000001',
       'fb1b1b01-0000-4000-8000-000000000001',
       'fb0b0b02-0000-4000-8000-000000000001') $$,
  '42501', null,
  'tenant user cannot call move_table_order'
);

select throws_ok(
  $$ select public.cancel_table_order('aaaaaaaa-0000-4000-8000-000000000001',
       'fb1b1b01-0000-4000-8000-000000000001', 'walked out', null) $$,
  '42501', null,
  'tenant user cannot call cancel_table_order'
);

-- The one that claims a receipt number. A tenant that could call it could mint
-- a sale against any counter it could name.
select throws_ok(
  $$ select public.settle_table_order('aaaaaaaa-0000-4000-8000-000000000001',
       'fb1b1b01-0000-4000-8000-000000000001',
       'ccccccc1-0000-4000-8000-000000000001', gen_random_uuid(),
       current_date, '[]'::jsonb, 0, 0, null) $$,
  '42501', null,
  'tenant user cannot call settle_table_order'
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
-- The stock ledger, returns, held bills and shifts — 0022 through 0026
--
-- Everything here is still tenant A's owner. Four tables and three functions
-- landed together, and each of them is one more surface that could hand one
-- shop another's numbers: what is on somebody's shelf, what came back over
-- their counter, what is sitting parked at their till, and what their drawer
-- was short by. The last of those is the most sensitive thing in the schema
-- after the payment history.
-- =============================================================================
set local request.jwt.claims = '{"sub":"11111111-0000-4000-8000-000000000001","role":"authenticated","tenant_id":"aaaaaaaa-0000-4000-8000-000000000001","tenant_role":"owner","platform_role":null}';

select is(
  (select count(*) from public.stock_movements), 1::bigint,
  'tenant A sees only its own stock movements'
);

select is_empty(
  $$ select 1 from public.stock_movements
     where tenant_id = 'bbbbbbbb-0000-4000-8000-000000000001' $$,
  'tenant A cannot read what moved on tenant B''s shelves'
);

select is(
  (select count(*) from public.held_bills), 1::bigint,
  'tenant A sees only its own parked bills'
);

select is_empty(
  $$ select 1 from public.held_bills
     where tenant_id = 'bbbbbbbb-0000-4000-8000-000000000001' $$,
  'tenant A cannot read what is parked at tenant B''s counter'
);

select is(
  (select count(*) from public.shifts), 1::bigint,
  'tenant A sees only its own shifts'
);

select is_empty(
  $$ select 1 from public.shifts
     where tenant_id = 'bbbbbbbb-0000-4000-8000-000000000001' $$,
  'tenant A cannot read tenant B''s drawer counts'
);

-- Rule 3 from 0001: select policies only. The ledger is the one that matters
-- most here — a shelf count a tenant could edit is a stocktake that can be made
-- to agree with anything, which is the whole reason the movements exist.
select throws_ok(
  $$ insert into public.stock_movements (tenant_id, item_id, reason, quantity, stock_after)
     values ('aaaaaaaa-0000-4000-8000-000000000001',
             '0a0a0a0a-0000-4000-8000-000000000001', 'count', 100, 100) $$,
  '42501', null,
  'tenant user cannot write its own stock movement'
);

select throws_ok(
  $$ update public.stock_movements set quantity = 0 $$,
  '42501', null,
  'tenant user cannot rewrite a stock movement'
);

select throws_ok(
  $$ update public.items set stock = 9999 $$,
  '42501', null,
  'tenant user cannot set a shelf count directly — private.move_stock is the only writer'
);

select throws_ok(
  $$ insert into public.held_bills (id, tenant_id, counter_id, lines)
     values (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001',
             'ccccccc1-0000-4000-8000-000000000001', '[]'::jsonb) $$,
  '42501', null,
  'tenant user cannot park a bill directly'
);

-- The over-or-short is the figure the whole shift mechanism exists to produce.
-- A cashier who could write it could close a short drawer as balanced.
select throws_ok(
  $$ update public.shifts set over_short = 0, closing_cash = 0 $$,
  '42501', null,
  'tenant user cannot write its own drawer count'
);

select throws_ok(
  $$ insert into public.shifts (tenant_id, branch_id, counter_id, opening_float)
     select 'aaaaaaaa-0000-4000-8000-000000000001', b.id,
            'ccccccc2-0000-4000-8000-000000000001', 0
       from public.branches b
      where b.tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001' limit 1 $$,
  '42501', null,
  'tenant user cannot open a shift directly'
);

-- The three write functions all belong to the service role, for the reason
-- `record_sale` does: each of them claims something the shop cannot take back.
-- `record_return` takes money out of a drawer, `close_shift` stamps a variance
-- somebody will be asked about, and `set_stock` rewrites a shelf count.
select throws_ok(
  $$ select public.record_return(
       'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
       'ccccccc1-0000-4000-8000-000000000001'::uuid,
       gen_random_uuid(), current_date, null,
       'dddddddd-0000-4000-8000-000000000001'::uuid,
       '[]'::jsonb, 'cash', true, null) $$,
  '42501', null,
  'tenant user cannot call record_return'
);

select throws_ok(
  $$ select public.set_stock(
       'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
       '0a0a0a0a-0000-4000-8000-000000000001'::uuid,
       9999, 'count', null, null) $$,
  '42501', null,
  'tenant user cannot call set_stock'
);

select throws_ok(
  $$ select public.open_shift(
       'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
       'ccccccc2-0000-4000-8000-000000000001'::uuid, null, 0, null) $$,
  '42501', null,
  'tenant user cannot call open_shift'
);

select throws_ok(
  $$ select public.close_shift(
       'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
       '7a7a7a7a-0000-4000-8000-000000000001'::uuid, null, 0, null) $$,
  '42501', null,
  'tenant user cannot call close_shift'
);

-- `private.move_stock` is the only writer of `items.stock` and is revoked from
-- everybody — it is reachable only from inside a security-definer function
-- above it. A tenant that could call it could move any shelf it could name.
select throws_ok(
  $$ select private.move_stock(
       'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
       '0a0a0a0a-0000-4000-8000-000000000001'::uuid,
       1000, 'count', null, null, null) $$,
  '42501', null,
  'tenant user cannot call private.move_stock'
);

-- =============================================================================
-- Tenant B's owner — the restaurant, and the other half of every assertion
-- above it.
--
-- Tenant A reads an empty floor, which is the right answer for a kiryana and
-- also the answer a policy that returned nothing to anybody would give. This
-- block is what tells the two apart: B's own session must read exactly its own
-- two tables, its one open bill and its own kitchen ticket, and none of A's
-- catalog.
-- =============================================================================
set local request.jwt.claims = '{"sub":"22222222-0000-4000-8000-000000000001","role":"authenticated","tenant_id":"bbbbbbbb-0000-4000-8000-000000000001","tenant_role":"owner","platform_role":null}';

select is(
  (select count(*) from public.dining_tables), 2::bigint,
  'tenant B reads its own two tables'
);

select is(
  (select count(*) from public.table_orders where status = 'open'), 1::bigint,
  'tenant B reads the one bill open on its floor'
);

select is(
  (select count(*) from public.table_order_lines), 1::bigint,
  'tenant B reads what that table ordered'
);

select is(
  (select count(*) from public.kots), 1::bigint,
  'tenant B reads its own kitchen ticket'
);

select is(
  (select price_delta from public.item_modifiers limit 1), 80::numeric,
  'tenant B reads what its own add-on costs'
);

select is_empty(
  $$ select 1 from public.items
     where tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  'the restaurant cannot read the kiryana''s catalog'
);

-- Rule 3 holds on this side too. Owner is the widest role there is, and it is
-- still select-only.
select throws_ok(
  $$ update public.table_orders set status = 'settled' $$,
  '42501', null,
  'even the owner cannot settle a table by hand'
);

select throws_ok(
  $$ delete from public.kots $$,
  '42501', null,
  'even the owner cannot delete a kitchen ticket'
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

select throws_ok(
  $$ update public.shifts set over_short = 0 $$,
  '42501', null,
  'a cashier cannot close their own drawer as balanced'
);

select throws_ok(
  $$ update public.items set stock = 0 $$,
  '42501', null,
  'a cashier cannot make the shelf count agree with the shelf'
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
select is_empty($$ select 1 from public.stock_movements $$,
  'a user with no tenant sees no stock movements');
select is_empty($$ select 1 from public.held_bills $$,
  'a user with no tenant sees no parked bills');
select is_empty($$ select 1 from public.shifts $$,
  'a user with no tenant sees no shifts');
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
select throws_ok($$ select 1 from public.stock_movements $$, '42501', null,
  'anon cannot read what is on a shop''s shelves or how it got there');
select throws_ok($$ select 1 from public.held_bills $$, '42501', null,
  'anon cannot read what is parked at a shop''s counter');
select throws_ok($$ select 1 from public.shifts $$, '42501', null,
  'anon cannot read a shop''s drawer counts');

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

-- =============================================================================
-- The sign of the money — 0024
--
-- A refund is a negative sale, which is what lets every total in the console
-- net by arithmetic rather than by each reader remembering to subtract. That
-- only holds if the sign and the status cannot disagree: a completed sale with
-- a negative total would take money off the takings that was never taken, and a
-- refund with a positive one would add money to them that was given back.
--
-- Asserted with the migration role, because the check constraint is the floor
-- under `record_sale` and `record_return` rather than a policy — it has to hold
-- against the service role too, which is the only thing that can write here.
-- =============================================================================
select throws_ok(
  $$ insert into public.sales (id, tenant_id, branch_id, receipt_number,
                               business_day, status, subtotal, total)
     select gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', b.id,
            'NEG-1', current_date, 'completed', -100, -100
       from public.branches b
      where b.tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001' limit 1 $$,
  '23514', null,
  'a completed sale cannot have a negative total'
);

select throws_ok(
  $$ insert into public.sales (id, tenant_id, branch_id, receipt_number,
                               business_day, status, subtotal, total)
     select gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', b.id,
            'POS-1', current_date, 'refund', 100, 100
       from public.branches b
      where b.tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001' limit 1 $$,
  '23514', null,
  'a refund cannot add to the takings'
);

-- The line carries the same statement one level down. `sale_lines` has no
-- status of its own and does not need one: the sign of the quantity says which
-- way the goods went, and the money has to agree with it or the line nets the
-- wrong way in every sum in the product.
select throws_ok(
  $$ insert into public.sale_lines
       (tenant_id, sale_id, name_snapshot, unit, quantity, unit_price, line_total)
     values ('aaaaaaaa-0000-4000-8000-000000000001',
             'dddddddd-0000-4000-8000-000000000001', 'Forged', 'piece',
             -1, 100, 100) $$,
  '23514', null,
  'a line that went back cannot have come to a positive amount'
);

select throws_ok(
  $$ insert into public.sale_lines
       (tenant_id, sale_id, name_snapshot, unit, quantity, unit_price, line_total)
     values ('aaaaaaaa-0000-4000-8000-000000000001',
             'dddddddd-0000-4000-8000-000000000001', 'Forged', 'piece',
             0, 100, 0) $$,
  '23514', null,
  'a line for nothing at all is not a line'
);

-- =============================================================================
-- One open drawer per counter — 0026
--
-- Two open shifts on one till is two people each counting the other's takings,
-- and neither variance means anything afterwards. The unique index is the whole
-- guarantee; `open_shift` returning the existing row rather than raising is the
-- courtesy on top of it.
-- =============================================================================
select throws_ok(
  $$ insert into public.shifts (tenant_id, branch_id, counter_id, opening_float, status)
     select 'aaaaaaaa-0000-4000-8000-000000000001', b.id,
            'ccccccc1-0000-4000-8000-000000000001', 0, 'open'
       from public.branches b
      where b.tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001' limit 1 $$,
  '23505', null,
  'a counter cannot have two drawers open at once'
);

-- =============================================================================
-- A parked bill never claims a receipt number — 0025
--
-- The reason `held_bills` is its own table rather than a status on `sales`. A
-- number claimed before anybody pays is a hole in the shop's series, and
-- 'held' is no longer a status a sale can be in at all.
-- =============================================================================
select throws_ok(
  $$ insert into public.sales (id, tenant_id, branch_id, receipt_number,
                               business_day, status, subtotal, total)
     select gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', b.id,
            'HELD-1', current_date, 'held', 0, 0
       from public.branches b
      where b.tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001' limit 1 $$,
  '23514', null,
  'a sale cannot be held — a parked bill lives on held_bills and claims no number'
);

select * from finish();

rollback;
