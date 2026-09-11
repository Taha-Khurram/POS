"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { recordAudit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import { createAdminClient } from "@/utils/supabase/admin";

const DAY_MS = 86_400_000;

function toText(value: FormDataEntryValue | null, fallback = "") {
  const text = typeof value === "string" ? value.trim() : fallback;
  return text || fallback;
}

function normalizePhone(value: string) {
  return value.replace(/\s+/g, "").replace(/[()\-]/g, "");
}

function addMonths(date: Date, months: number) {
  const copy = new Date(date);
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function inviteUrlFromHeaders(token: string) {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  return `${protocol}://${host}/signup?token=${encodeURIComponent(token)}`;
}

export async function activateClient(formData: FormData) {
  const session = await requirePlatformAdmin();
  const supabase = createAdminClient();

  const shopName = toText(formData.get("shop_name"));
  const ownerName = toText(formData.get("owner_name"));
  const phone = normalizePhone(toText(formData.get("phone")));
  const city = toText(formData.get("city"));
  const shopType = toText(formData.get("shop_type"));
  const planCode = toText(formData.get("plan_code"), "standard");
  const billingCycle = toText(formData.get("billing_cycle"), "monthly");
  const branches = Number(toText(formData.get("branches"), "1"));
  const registers = Number(toText(formData.get("registers"), "1"));
  const price = Number(toText(formData.get("agreed_price"), "0"));
  const trialDays = Number(toText(formData.get("trial_days"), "0"));
  const notes = toText(formData.get("notes"));
  const email = toText(formData.get("email"));

  if (!shopName || !ownerName || !phone || !city || !shopType) {
    redirect("/admin/clients/new?error=Please+fill+the+required+client+details.");
  }

  if (!Number.isFinite(price) || price <= 0) {
    redirect("/admin/clients/new?error=The+agreed+price+must+be+greater+than+zero.");
  }

  if (!["kiryana", "restaurant", "bakery", "pharmacy", "clothing", "retail", "other"].includes(shopType)) {
    redirect("/admin/clients/new?error=Choose+a+valid+shop+type.");
  }

  if (!["monthly", "quarterly", "yearly"].includes(billingCycle)) {
    redirect("/admin/clients/new?error=Choose+a+valid+billing+cycle.");
  }

  const { data: plan, error: planError } = await supabase
    .from("plans")
    .select("id, code, name")
    .eq("code", planCode)
    .maybeSingle();

  if (planError || !plan) {
    redirect("/admin/clients/new?error=The+selected+plan+could+not+be+found.");
  }

  const tenantInsert = {
    shop_name: shopName,
    owner_name: ownerName,
    phone,
    email: email || null,
    city,
    shop_type: shopType,
    notes: notes || null,
    created_by: session.userId,
  };

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert(tenantInsert)
    .select("id")
    .single();

  if (tenantError || !tenant) {
    redirect("/admin/clients/new?error=The+tenant+could+not+be+created.");
  }

  const baseStart = new Date(formData.get("start_date") ? String(formData.get("start_date")) : Date.now());
  const currentPeriodStart = new Date(baseStart);
  const currentPeriodEnd =
    billingCycle === "quarterly"
      ? addMonths(currentPeriodStart, 3)
      : billingCycle === "yearly"
        ? addMonths(currentPeriodStart, 12)
        : addMonths(currentPeriodStart, 1);

  const trialEndsAt = trialDays > 0 ? addDays(currentPeriodStart, trialDays) : null;

  const { error: branchError } = await supabase.from("branches").insert({
    tenant_id: tenant.id,
    name: `${shopName} primary`,
    city,
    phone,
    is_primary: true,
  });

  if (branchError) {
    await supabase.from("tenants").delete().eq("id", tenant.id);
    redirect("/admin/clients/new?error=The+first+branch+could+not+be+created.");
  }

  const { error: subscriptionError } = await supabase.from("subscriptions").insert({
    tenant_id: tenant.id,
    plan_id: plan.id,
    status: trialDays > 0 ? "trialing" : "active",
    billing_cycle: billingCycle,
    agreed_price: price,
    max_branches: Math.max(1, branches),
    max_registers: Math.max(1, registers),
    feature_overrides: {},
    trial_ends_at: trialEndsAt ? trialEndsAt.toISOString() : null,
    current_period_start: currentPeriodStart.toISOString(),
    current_period_end: currentPeriodEnd.toISOString(),
    grace_days: 7,
  });

  if (subscriptionError) {
    await supabase.from("branches").delete().eq("tenant_id", tenant.id);
    await supabase.from("tenants").delete().eq("id", tenant.id);
    redirect("/admin/clients/new?error=The+subscription+could+not+be+created.");
  }

  const rawToken = `${crypto.randomUUID()}-${Date.now()}`;
  const tokenHash = await sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + 72 * DAY_MS).toISOString();

  const { error: inviteError } = await supabase.from("invites").insert({
    tenant_id: tenant.id,
    token_hash: tokenHash,
    email: email || null,
    phone,
    tenant_role: "owner",
    expires_at: expiresAt,
    created_by: session.userId,
  });

  if (inviteError) {
    await supabase.from("subscriptions").delete().eq("tenant_id", tenant.id);
    await supabase.from("branches").delete().eq("tenant_id", tenant.id);
    await supabase.from("tenants").delete().eq("id", tenant.id);
    redirect("/admin/clients/new?error=The+signup+invite+could+not+be+created.");
  }

  await recordAudit(session, {
    action: "tenant.activated",
    tenantId: tenant.id,
    subjectType: "tenant",
    subjectId: tenant.id,
    after: {
      shop_name: shopName,
      owner_name: ownerName,
      plan_code: planCode,
      agreed_price: price,
      billing_cycle: billingCycle,
      trial_days: trialDays,
      branches,
      registers,
    },
  });

  const inviteUrl = await inviteUrlFromHeaders(rawToken);
  redirect(`/admin/clients?created=1&invite=${encodeURIComponent(inviteUrl)}`);
}

export async function recordPayment(formData: FormData) {
  const session = await requirePlatformAdmin();
  const supabase = createAdminClient();

  const tenantId = toText(formData.get("tenant_id"));
  const amount = Number(toText(formData.get("amount"), "0"));
  const method = toText(formData.get("method"), "bank_transfer");
  const reference = toText(formData.get("reference"));
  const notes = toText(formData.get("notes"));

  if (!tenantId || !Number.isFinite(amount) || amount <= 0) {
    redirect("/admin/payments?error=Enter+a+valid+tenant+and+amount.");
  }

  if (!["bank_transfer", "easypaisa", "jazzcash", "cash", "card", "other"].includes(method)) {
    redirect("/admin/payments?error=Choose+a+valid+payment+method.");
  }

  const { data: subscription, error: subscriptionError } = await supabase
    .from("subscriptions")
    .select("id, billing_cycle, current_period_end, status")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (subscriptionError || !subscription) {
    redirect("/admin/payments?error=That+tenant+does+not+have+an+active+subscription.");
  }

  const nextPeriod = new Date(subscription.current_period_end || Date.now());
  const cycleMonths = subscription.billing_cycle === "quarterly" ? 3 : subscription.billing_cycle === "yearly" ? 12 : 1;
  nextPeriod.setMonth(nextPeriod.getMonth() + cycleMonths);

  const { error: paymentError } = await supabase.from("payments").insert({
    tenant_id: tenantId,
    subscription_id: subscription.id,
    amount,
    method,
    reference: reference || null,
    paid_at: new Date().toISOString(),
    recorded_by: session.userId,
    notes: notes || null,
  });

  if (paymentError) {
    redirect("/admin/payments?error=The+payment+could+not+be+recorded.");
  }

  const { error: updateError } = await supabase
    .from("subscriptions")
    .update({
      status: "active",
      current_period_end: nextPeriod.toISOString(),
    })
    .eq("id", subscription.id);

  if (updateError) {
    redirect("/admin/payments?error=The+subscription+was+paid+but+its+period+could+not+be+extended.");
  }

  await recordAudit(session, {
    action: "subscription.renewed",
    tenantId,
    subjectType: "subscription",
    subjectId: subscription.id,
    before: { current_period_end: subscription.current_period_end },
    after: { amount, method, reference, current_period_end: nextPeriod.toISOString() },
  });

  redirect("/admin/payments?success=Payment+recorded+successfully.");
}
