-- =============================================================================
-- 0037_orders_can_be_created — the checkout has never been able to write a row
--
-- `public.orders.reference` defaults to `private.gen_order_reference()`, and
-- `0001_init.sql` revoked EXECUTE on that function from `public` and then
-- granted it back to nobody. The five claim readers below it in the same file
-- were granted to `authenticated`; this one was not, so its ACL has said
-- `{postgres=X/postgres}` since the day it was created.
--
-- Every insert into `orders` goes through the service role — `/checkout` on the
-- marketing site, and the admin console's order queue. Neither is `postgres`.
-- So evaluating the column default raised `permission denied for function
-- gen_order_reference`, the insert failed, and `createCheckoutOrder` redirected
-- to "We could not create your order. Please try again." for everybody, for
-- ever. There was no self-serve order in the database to notice it with.
--
-- Found by driving `/admin/orders` against a seeded order while building the
-- platform console: the seed itself would not insert.
--
-- The grant goes to `service_role` alone. `anon` and `authenticated` have no
-- insert privilege on `orders` and must not be handed a function that loops
-- over the whole table probing for a free reference.
-- =============================================================================

grant execute on function private.gen_order_reference() to service_role;

comment on function private.gen_order_reference() is
  'Default for orders.reference. Executable by service_role only — every insert into orders is a Server Action on the admin client.';
