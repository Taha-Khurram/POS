-- =============================================================================
-- 0003_storage — the payment-proof bucket
--
-- Screenshots of bank transfers and Easypaisa receipts, uploaded from the
-- public /order/[ref] page and read by you in the verification queue.
--
-- Deliberately NO policies on storage.objects for this bucket. That is not an
-- omission — it means anon and authenticated cannot read, write, or list it at
-- all. Uploads go through a Server Action with the service role, and the
-- verification queue reads each file through a short-lived signed URL, also
-- minted server-side.
--
-- The alternative (a client-side upload with an anon insert policy) would let
-- anyone with the publishable key write into your bucket forever. A payment
-- proof is someone's bank statement; it does not belong behind a policy that
-- has to be exactly right.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-proofs',
  'payment-proofs',
  false,
  5242880, -- 5 MiB: a phone screenshot, not a scan
  array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;
