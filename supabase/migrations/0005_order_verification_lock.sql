-- =============================================================================
-- 0005_order_verification_lock -- prevent duplicate order activation
--
-- Apply manually after 0004_phase1_support.sql. The claim expires logically
-- after ten minutes, so a crashed verification can be retried without allowing
-- two concurrent requests to activate the same order.
-- =============================================================================

alter table public.orders
  add column verification_started_at timestamptz;

create index orders_verification_started_at_idx
  on public.orders (verification_started_at)
  where status = 'proof_submitted';

comment on column public.orders.verification_started_at is
  'Short-lived claim held while a platform admin activates this order.';
