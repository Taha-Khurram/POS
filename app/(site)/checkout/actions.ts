"use server";

import { redirect } from "next/navigation";

import { attachProof, checkProof, hasFile } from "@/lib/platform/proof";
import { consumeRateLimit } from "@/lib/rate-limit";
import { SHOP_TYPES } from "@/lib/pos/settings-options";
import { createAdminClient } from "@/utils/supabase/admin";

const BILLING_CYCLES = ["monthly", "quarterly", "yearly"];

function text(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

export async function createCheckoutOrder(formData: FormData) {
  if (!(await consumeRateLimit("checkout", 5, 3600))) {
    redirect("/checkout?error=Too+many+attempts.+Please+try+again+later.");
  }

  const shopName = text(formData.get("shop_name"));
  const ownerName = text(formData.get("owner_name"));
  const phone = text(formData.get("phone"));
  const email = text(formData.get("email"));
  const city = text(formData.get("city"));
  const planCode = text(formData.get("plan_code"));
  const billingCycle = text(formData.get("billing_cycle"));
  // One shop and one shop type: Flo runs a single branch of a supermarket, so
  // neither is asked. The order row still takes both.
  const branches = 1;
  const shopType = SHOP_TYPES[0].id;
  const proof = formData.get("proof");

  if (!shopName || !ownerName || !phone || !city) {
    redirect("/checkout?error=Please+complete+the+required+shop+details.");
  }
  if (!BILLING_CYCLES.includes(billingCycle)) {
    redirect("/checkout?error=Choose+how+often+you+want+to+pay.");
  }
  // Refused before the order exists, so a wrong file is not an order with a
  // reference the buyer never saw.
  if (hasFile(proof)) {
    const complaint = checkProof(proof);
    if (complaint) redirect(`/checkout?plan=${encodeURIComponent(planCode)}&error=${encodeURIComponent(complaint)}`);
  }

  const supabase = createAdminClient();
  const { data: plan, error: planError } = await supabase
    .from("plans")
    .select("id, list_price, features")
    .eq("code", planCode)
    .eq("is_active", true)
    .maybeSingle();

  if (planError || !plan) {
    redirect("/checkout?error=That+plan+is+not+available.");
  }

  // Counters are not asked either: a shop on a plan starts with the plan's
  // ceiling (`PLAN_LIMITS`), which is what activation would seed anyway. A shop
  // that needs more than that needs a bigger plan, not a bigger number here.
  const ceiling = (plan.features as Record<string, unknown> | null)?.max_registers;
  const registers = typeof ceiling === "number" && ceiling >= 1 ? ceiling : 1;

  const multiplier = billingCycle === "quarterly" ? 3 : billingCycle === "yearly" ? 12 : 1;
  const quotedPrice = Number(plan.list_price) * branches * multiplier;
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      shop_name: shopName,
      owner_name: ownerName,
      phone,
      email: email || null,
      city,
      shop_type: shopType,
      plan_id: plan.id,
      billing_cycle: billingCycle,
      branches,
      registers,
      quoted_price: quotedPrice,
    })
    .select("id, reference")
    .single();

  if (orderError || !order) {
    redirect("/checkout?error=We+could+not+create+your+order.+Please+try+again.");
  }

  // The order stands either way. A screenshot that fails to attach is retried
  // from the order page, which is where the buyer lands regardless.
  const page = `/order/${encodeURIComponent(order.reference)}`;
  if (hasFile(proof)) {
    const error = await attachProof(String(order.id), proof);
    redirect(error ? `${page}?error=${encodeURIComponent(`Your order is in, but ${error.charAt(0).toLowerCase()}${error.slice(1)} Try again below.`)}` : page);
  }

  redirect(page);
}
