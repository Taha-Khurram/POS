"use server";

import { redirect } from "next/navigation";

import { attachProof, hasFile } from "@/lib/platform/proof";
import { consumeRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/utils/supabase/admin";

/** For a buyer who paid after checking out. `/checkout` takes the same file on
 *  its own submit, through the same `attachProof`. */
export async function uploadPaymentProof(formData: FormData) {
  const reference = String(formData.get("reference") ?? "").trim();
  const back = (query: string) => redirect(`/order/${encodeURIComponent(reference)}?${query}`);

  if (!(await consumeRateLimit("payment-proof", 10, 3600))) {
    back("error=Too+many+upload+attempts.+Please+try+again+later.");
  }

  const file = formData.get("proof");
  if (!hasFile(file)) back("error=Choose+the+screenshot+or+receipt+first.");

  const { data: order } = await createAdminClient()
    .from("orders")
    .select("id")
    .eq("reference", reference)
    .maybeSingle();

  if (!order) back("error=This+order+is+not+accepting+proof.");

  const error = await attachProof(String(order!.id), file as File);
  if (error) back(`error=${encodeURIComponent(error)}`);

  // No success message: the page draws "we have your screenshot" off the
  // order's own status, which is true on every later visit too.
  redirect(`/order/${encodeURIComponent(reference)}`);
}
