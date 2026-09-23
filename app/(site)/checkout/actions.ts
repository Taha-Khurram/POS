"use server";

import { redirect } from "next/navigation";

import { consumeRateLimit } from "@/lib/rate-limit";
import { pickOption, SHOP_TYPES } from "@/lib/pos/settings-options";
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
  const shopType = text(formData.get("shop_type"));
  const planCode = text(formData.get("plan_code"));
  const billingCycle = text(formData.get("billing_cycle"));
  const branches = Number(text(formData.get("branches")) || "1");
  const registers = Number(text(formData.get("registers")) || "1");

  // The console's own list rather than a second copy of it: this order becomes
  // a `tenants` row, and `shop_type` there is a check constraint over exactly
  // these ids.
  if (!shopName || !ownerName || !phone || !city || !pickOption(SHOP_TYPES, shopType)) {
    redirect("/checkout?error=Please+complete+the+required+shop+details.");
  }
  if (!BILLING_CYCLES.includes(billingCycle) || !Number.isInteger(branches) || branches < 1 || !Number.isInteger(registers) || registers < 1) {
    redirect("/checkout?error=Choose+valid+plan+and+capacity+values.");
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

  // The plan's Counters ceiling, set on /admin/plans and printed on /pricing.
  // More than that is a different plan, or a conversation — not an order.
  const ceiling = (plan.features as Record<string, unknown> | null)?.max_registers;
  if (typeof ceiling === "number" && registers > ceiling) {
    redirect(
      `/checkout?plan=${encodeURIComponent(planCode)}&error=${encodeURIComponent(
        `That plan covers up to ${ceiling} ${ceiling === 1 ? "counter" : "counters"}. Choose a bigger plan, or message us for more.`,
      )}`,
    );
  }

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
    .select("reference")
    .single();

  if (orderError || !order) {
    redirect("/checkout?error=We+could+not+create+your+order.+Please+try+again.");
  }

  redirect(`/order/${encodeURIComponent(order.reference)}`);
}
