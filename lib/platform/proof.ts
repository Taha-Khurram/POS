import "server-only";

import { createAdminClient } from "@/utils/supabase/admin";

/**
 * A buyer's payment screenshot, onto their order.
 *
 * Two callers: `/checkout`, which takes it on the same submit that creates the
 * order, and `/order/[reference]`, for a buyer who paid afterwards. One body,
 * so a file one accepts is a file the other accepts, in the same words.
 *
 * Service role, because the buyer is anonymous and `payment-proofs` is private
 * (`0003_storage.sql`).
 *
 * **One screenshot per order.** Only an order still `awaiting_payment` takes
 * one: once a proof is in, the operator is matching it against the statement,
 * and a second file swapped in underneath them is a different screenshot from
 * the one they checked. A wrong screenshot is the operator's to raise — they
 * reject with a reason the buyer reads on the order page.
 */

export const MAX_PROOF_BYTES = 5 * 1024 * 1024;
export const PROOF_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

/** Whether the form carried a file at all — the checkout's is optional. */
export function hasFile(value: FormDataEntryValue | null): value is File {
  return value instanceof File && value.size > 0;
}

/** The sentence to show, or null when the file will do. */
export function checkProof(file: File): string | null {
  if (file.size > MAX_PROOF_BYTES || !PROOF_TYPES.includes(file.type)) {
    return "Upload a PNG, JPG, WEBP, or PDF under 5MB.";
  }
  return null;
}

/** Stores the file and marks the order `proof_submitted`. Null on success. */
export async function attachProof(orderId: string, file: File): Promise<string | null> {
  const complaint = checkProof(file);
  if (complaint) return complaint;

  const supabase = createAdminClient();

  const { data: order } = await supabase
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .maybeSingle();

  if (order?.status === "proof_submitted") {
    return "We already have your screenshot for this order. Nothing more is needed.";
  }
  if (order?.status !== "awaiting_payment") return "This order is not accepting proof.";

  const path = `${orderId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const { error: uploadError } = await supabase.storage.from("payment-proofs").upload(path, file, {
    contentType: file.type,
    upsert: false,
  });

  if (uploadError) return "The proof could not be uploaded.";

  // Conditional on the status it was read with, so two uploads racing from two
  // tabs cannot both land: the second updates no row and its file is removed.
  const { data: attached, error: updateError } = await supabase
    .from("orders")
    .update({ status: "proof_submitted", proof_path: path, proof_uploaded_at: new Date().toISOString() })
    .eq("id", orderId)
    .eq("status", "awaiting_payment")
    .select("id");

  if (updateError || !attached?.length) {
    await supabase.storage.from("payment-proofs").remove([path]);
    return updateError
      ? "The proof could not be attached to your order."
      : "We already have your screenshot for this order. Nothing more is needed.";
  }

  return null;
}
