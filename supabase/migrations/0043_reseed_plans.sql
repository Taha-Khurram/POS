-- =============================================================================
-- 0043_reseed_plans — Standard and Premium, back in the table
--
-- `public.plans` was found empty: no tenants, no orders, no subscriptions and
-- no plans, so every plan dropdown in the product — `/checkout`, the direct
-- activation form, a client's Plan and Activate cards — drew a list with
-- nothing in it, and `/admin/clients/new` said there was no plan to sell.
--
-- `0002` cannot simply be replayed: its flags are the aspirational ones `0020`
-- corrected, it still carries `udhaar_khata` (`0018`) and `restaurant_mode`
-- (`0034`), and its Standard pitch offers a restaurant. These rows are the
-- state every later migration left behind, written out once:
--
--   0018  udhaar_khata out, customer_directory in
--   0020  the honest flags; staff accounts rather than PINs; Premium at four
--         counters and one branch
--   0021  advanced_reports on Premium     0022  stock_ledger on both
--   0026  shift_close on both             0028  purchase_orders on both
--   0034  restaurant_mode removed         0035  advanced_reports on Standard
--
-- The pitches are `/pricing`'s own, so the checkout dropdown and the page that
-- links to it describe each plan in the same words.
--
-- `on conflict do nothing`, for `0002`'s reason: a price changed on
-- `/admin/plans` must never be stamped over by a migration. Data only — no
-- table, policy or grant is touched, so rules 1-5 of `0001_init.sql` stand.
-- =============================================================================

insert into public.plans (code, name, pitch, list_price, sort_order, is_active, features)
values
  (
    'standard',
    'Standard',
    'For a shop with one counter, or two.',
    5000.00,
    1,
    true,
    jsonb_build_object(
      'max_branches', 1,
      'max_registers', 2,
      'max_staff_pins', null,

      'thermal_printing', true,
      'catalog_roman_urdu_search', true,
      'customer_directory', true,
      'stock_ledger', true,
      'shift_close', true,
      'day_close_report', true,
      'bulk_import', true,
      'csv_export', true,
      'whatsapp_support', true,
      'staff_accounts', true,
      'sales_history', true,
      'receipt_reprint', true,
      'role_permissions', true,
      'profit_reporting', true,
      'advanced_reports', true,
      'purchase_orders', true,

      'offline_register', false,
      'staff_pins', false,
      'multi_branch_dashboard', false,
      'central_catalog', false,
      'cross_branch_reports', false,
      'priority_support', false,
      'fbr_invoicing', false,
      'recipe_depletion', false,
      'payroll_export', false,
      'delivery_reconciliation', false,
      'loyalty_campaigns', false,
      'provincial_tax_filing', false,
      'api_access', false
    )
  ),
  (
    'premium',
    'Premium',
    'For a busy floor that needs more than two tills, and somebody of ours on the end of the phone.',
    10000.00,
    2,
    true,
    jsonb_build_object(
      'max_branches', 1,
      'max_registers', 4,
      'max_staff_pins', null,

      'thermal_printing', true,
      'catalog_roman_urdu_search', true,
      'customer_directory', true,
      'stock_ledger', true,
      'shift_close', true,
      'day_close_report', true,
      'bulk_import', true,
      'csv_export', true,
      'whatsapp_support', true,
      'staff_accounts', true,
      'sales_history', true,
      'receipt_reprint', true,
      'role_permissions', true,
      'profit_reporting', true,
      'advanced_reports', true,
      'purchase_orders', true,
      'priority_support', true,

      'offline_register', false,
      'staff_pins', false,
      'multi_branch_dashboard', false,
      'central_catalog', false,
      'cross_branch_reports', false,
      'fbr_invoicing', false,
      'recipe_depletion', false,
      'payroll_export', false,
      'delivery_reconciliation', false,
      'loyalty_campaigns', false,
      'provincial_tax_filing', false,
      'api_access', false
    )
  )
on conflict (code) do nothing;
