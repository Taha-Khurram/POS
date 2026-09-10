-- =============================================================================
-- 0002_seed_plans — Standard and Premium, as sold on /pricing
--
-- These two rows are the entitlement source of truth. Every flag that v1 does
-- not ship is present and false, not absent: that is what makes /admin/plans a
-- form instead of a release, and it keeps the honest-copy work in Part 8 a
-- matter of turning flags on rather than adding columns.
--
-- `on conflict do nothing` on purpose — once the console can edit plans, a
-- redeploy must never stamp over a price you changed at 11 pm.
-- =============================================================================

insert into public.plans (code, name, pitch, list_price, sort_order, features)
values
  (
    'standard',
    'Standard',
    'For a single shop or restaurant that needs clean billing and honest stock.',
    5000.00,
    1,
    jsonb_build_object(
      -- Ceilings. Enforced server-side at device registration and branch
      -- creation; subscriptions.max_* can raise them for one client.
      'max_branches', 1,
      'max_registers', 2,
      'max_staff_pins', null,

      -- Shipping in v1
      'offline_register', true,
      'thermal_printing', true,
      'catalog_roman_urdu_search', true,
      'udhaar_khata', true,
      'stock_ledger', true,
      'staff_pins', true,
      'shift_close', true,
      'day_close_report', true,
      'bulk_import', true,
      'csv_export', true,
      'whatsapp_support', true,

      -- Premium-only in v1
      'multi_branch_dashboard', false,
      'central_catalog', false,
      'cross_branch_reports', false,
      'restaurant_mode', false,
      'advanced_reports', false,
      'priority_support', false,

      -- Parked with dates in the plan (§10). Flip when they land.
      'fbr_invoicing', false,
      'recipe_depletion', false,
      'purchase_orders', false,
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
    'For busy floors and multi-branch owners who want one set of numbers.',
    10000.00,
    2,
    jsonb_build_object(
      -- Unlimited in the copy; a number here so the enforcement code has one
      -- shape to read. Raise it per client from the console if anyone gets close.
      'max_branches', 25,
      'max_registers', 25,
      'max_staff_pins', null,

      'offline_register', true,
      'thermal_printing', true,
      'catalog_roman_urdu_search', true,
      'udhaar_khata', true,
      'stock_ledger', true,
      'staff_pins', true,
      'shift_close', true,
      'day_close_report', true,
      'bulk_import', true,
      'csv_export', true,
      'whatsapp_support', true,

      'multi_branch_dashboard', true,
      'central_catalog', true,
      'cross_branch_reports', true,
      'restaurant_mode', true,
      'advanced_reports', true,
      'priority_support', true,

      'fbr_invoicing', false,
      'recipe_depletion', false,
      'purchase_orders', false,
      'payroll_export', false,
      'delivery_reconciliation', false,
      'loyalty_campaigns', false,
      'provincial_tax_filing', false,
      'api_access', false
    )
  )
on conflict (code) do nothing;
