-- =============================================================================
-- 0045_plan_highlights — /pricing is drawn from the plans table
--
-- `/admin/plans` has been editable since `0001` and changed nothing anybody
-- could see: `/pricing` wrote its two cards by hand, so a price saved on the
-- console reached `/checkout` and the activation form and was contradicted by
-- the page a buyer reads first. The page now reads `plans` — name, price,
-- pitch, order, on-sale, the counter and staff ceilings, and a sentence for
-- every flag that is on.
--
-- What a flag cannot say is a promise with no switch behind it: "your rate
-- list imported for you", "a named person", "one bill split across tenders".
-- Those are `highlights` — extra lines, in order, printed under the flags. A
-- column rather than a key in `features`, because `features` is read by
-- `getEntitlements` as the shop's entitlement and a sentence is not one.
--
-- The seed is what `/pricing` said the day this landed, less what the flags
-- now print for themselves. It only fills rows that are still empty, so a
-- replay never stamps over an edit made on the console.
--
-- Platform data like the rest of `plans`: no `tenant_id`, RLS as `0001` left
-- it (select for a platform JWT, writes on the service role), rules 1-5 stand.
-- =============================================================================

alter table public.plans
  add column highlights text[] not null default '{}'
    constraint plans_highlights_bounded check (cardinality(highlights) <= 12);

update public.plans
set highlights = array[
  'Cash, card, Raast, Easypaisa, JazzCash or a transfer — and one bill split across them',
  'Departments and categories you name yourself',
  'Batch numbers and expiry on the lines that need them — sold soonest-expiring first, and expired stock cannot be billed'
]
where code = 'standard' and highlights = '{}';

update public.plans
set highlights = array[
  'New modules the week they land, at no extra cost',
  'Your rate list imported and checked for you',
  'Named person for setup and support'
]
where code = 'premium' and highlights = '{}';
