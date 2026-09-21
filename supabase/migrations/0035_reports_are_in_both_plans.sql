-- =============================================================================
-- 0035_reports_are_in_both_plans — the last flag that understated what a shop got
--
-- Apply manually after 0034_no_restaurant.sql.
--
-- `0021` built Reports and raised `advanced_reports` on Premium alone. Nothing
-- in the console has ever read that flag: `/app/reports` is reached through
-- `can_view_reports` on `role_permissions`, which is a *permission* an owner
-- grants a cashier, not a tier they buy. So Standard's `false` was not a gate —
-- it was a promise pointing the wrong way, and `0020`'s rule cuts both ways:
-- a flag that claims less than the console gives is as wrong as one that claims
-- more. The shop is owed the honest answer either way.
--
-- CLAUDE.md has said since `0021` that this had to be settled deliberately —
-- "either gate it or raise the flag". **Raised**, and the reason is the product
-- rather than the packaging: profit and margin are what make a shopkeeper stop
-- guessing, and putting them behind the Rs 10,000 tier sells the cheaper plan
-- to exactly the shop that most needs to know which lines make money. Gating it
-- would also mean taking a working screen away from every Standard shop that
-- already has it, which is not a thing to do to somebody who is paying.
--
-- **What this leaves Premium is counters and people**, not features: four tills
-- against two, priority in the queue, a named person for setup, and the rate
-- list imported for you. That is now the whole difference, and it is worth
-- saying out loud — a tier whose only feature flag was this one is a tier that
-- has to be sold on what it actually is.
-- =============================================================================

update public.plans
   set features = features || jsonb_build_object('advanced_reports', true),
       updated_at = now()
 where code = 'standard'
   and features->>'advanced_reports' is distinct from 'true';
