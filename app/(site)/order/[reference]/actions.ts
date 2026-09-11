"use server";

import { redirect } from "next/navigation";

import { consumeRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/utils/supabase/admin";

const MAX_PROOF_BYTES = 5 * 1024 * 1024;
const MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

export async function uploadPaymentProof(formData: FormData) {
  if (!(await consumeRateLimit("payment-proof", 10, 3600))) {
    redirect(`/order/${encodeURIComponent(String(formData.get("reference") ?? ""))}?error=Too+many+upload+attempts.+Please+try+again+later.`);
  }

  const reference = String(formData.get("reference") ?? "").trim();
  const file = formData.get("proof");

  if (!(file instanceof File) || file.size === 0 || file.size > MAX_PROOF_BYTES || !MIME_TYPES.includes(file.type)) {
    redirect(`/order/${encodeURIComponent(reference)}?error=Upload+a+PNG,+JPG,+WEBP,+or+PDF+under+5MB.`);
  }

  const supabase = createAdminClient();
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status")
    .eq("reference", reference)
    .maybeSingle();

  if (orderError || !order || !["awaiting_payment", "proof_submitted"].includes(order.status)) {
    redirect(`/order/${encodeURIComponent(reference)}?error=This+order+is+not+accepting+proof.`);
  }

  const path = `${order.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const { error: uploadError } = await supabase.storage.from("payment-proofs").upload(path, file, {
    contentType: file.type,
    upsert: false,
  });

  if (uploadError) {
    redirect(`/order/${encodeURIComponent(reference)}?error=The+proof+could+not+be+uploaded.`);
  }

  const { error: updateError } = await supabase
    .from("orders")
    .update({ status: "proof_submitted", proof_path: path, proof_uploaded_at: new Date().toISOString() })
    .eq("id", order.id);

  if (updateError) {
    await supabase.storage.from("payment-proofs").remove([path]);
    redirect(`/order/${encodeURIComponent(reference)}?error=The+proof+could+not+be+attached+to+your+order.`);
  }

  redirect(`/order/${encodeURIComponent(reference)}?success=Payment+proof+received.`);
}
