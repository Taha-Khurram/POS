-- =============================================================================
-- 0020_plans_tell_the_truth — the feature flags match the software
--
-- `plans.features` is the single authority entitlements resolve from, and half
-- of it was aspirational. `0002` seeded both rows from the plan document rather
-- than from the code, and `on conflict do nothing` meant nothing ever corrected
-- them as the parts landed in a different order than the document guessed.
--
-- What was wrong, and why each one matters more than a marketing bullet:
--
--   stock_ledger        true  → `record_sale` never touches `items.stock`.
--                               There is no ledger and no movement.
--   shift_close         true  → `shifts` is written by nothing. Day close
--                               totals a day, not a person's drawer.
--   offline_register    true  → `sync_outbox` is written by nothing. The
--                               register needs the connection for every sale.
--   staff_pins          true  → Staff sign in with a work email and a
--                               password. There are no PINs.
--   restaurant_mode     true  → No tables, no kitchen printing, no modifiers.
--   advanced_reports    true  → `/app/reports` is a placeholder screen.
--   multi_branch_*      true  → Nothing reads `branches`. One shop, one branch.
--   central_catalog     true
--   cross_branch_reports true
--
-- A flag is a promise the console can be held to: an owner on Premium who reads
-- `advanced_reports` and finds a "coming soon" screen has been sold something.
-- Flip each one back the day the feature lands, in the same migration that
-- lands it.
--
-- `max_branches` on Premium drops from 25 to 1 for the same reason. It is a
-- ceiling the software cannot honour, and `subscriptions.max_branches` is still
-- where one client's negotiated deal is recorded — so raising it for a real
-- chain remains a one-row update, not a release.
--
-- Written as a merge over the existing JSON rather than a rewrite, so a price
-- or a flag somebody changed at 11 pm survives.
-- =============================================================================

update public.plans
   set features = features || jsonb_build_object(
         'stock_ledger', false,
         'shift_close', false,
         'offline_register', false,
         'staff_pins', false,
         -- What replaced PINs, and is real: an account each, with a role.
         'staff_accounts', true,
         -- Also real, and worth naming because they are what a shop buys:
         'sales_history', true,
         'receipt_reprint', true,
         'role_permissions', true,
         'profit_reporting', true
       )
 where code in ('standard', 'premium');

update public.plans
   set features = features || jsonb_build_object(
         'max_branches', 1,
         'restaurant_mode', false,
         'advanced_reports', false,
         'multi_branch_dashboard', false,
         'central_catalog', false,
         'cross_branch_reports', false,
         -- Premium's registers are real and enforced at counter creation, so
         -- this one stays. Four rather than 25: a number nobody has needed to
         -- exceed is a number that has never been tested.
         'max_registers', 4
       )
 where code = 'premium';

update public.plans
   set features = features || jsonb_build_object('max_registers', 2)
 where code = 'standard';
