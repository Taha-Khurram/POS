"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { recordAudit } from "@/lib/audit";
import { canTakePayments, requirePlatformAdmin } from "@/lib/auth";
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

  const { inviteUrl } = await activateClientRecord(formData, session, supabase);
  redirect(`/admin/clients?created=1&invite=${encodeURIComponent(inviteUrl)}`);
}

async function activateClientRecord(
  formData: FormData,
  session: Awaited<ReturnType<typeof requirePlatformAdmin>>,
  supabase: ReturnType<typeof createAdminClient>,
) {

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
  return { tenantId: tenant.id, inviteUrl };
}

export async function verifyOrder(formData: FormData) {
  const session = await requirePlatformAdmin();
  if (!canTakePayments(session)) {
    redirect("/admin/orders?error=Only+the+super+admin+can+verify+orders.");
  }

  const supabase = createAdminClient();
  const orderId = toText(formData.get("order_id"));
  if (!orderId) redirect("/admin/orders?error=The+order+could+not+be+identified.");

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status, shop_name, owner_name, phone, email, city, shop_type, plan_id, billing_cycle, branches, registers, quoted_price")
    .eq("id", orderId)
    .maybeSingle();

  if (orderError || !order || order.status !== "proof_submitted") {
    redirect("/admin/orders?error=Only+orders+with+submitted+proof+can+be+verified.");
  }

  const { data: plan, error: planError } = await supabase
    .from("plans")
    .select("code")
    .eq("id", order.plan_id)
    .maybeSingle();

  if (planError || !plan) {
    redirect(`/admin/orders?error=The+plan+for+${encodeURIComponent(order.id)}+could+not+be+found.`);
  }

  const activationData = new FormData();
  activationData.set("shop_name", order.shop_name);
  activationData.set("owner_name", order.owner_name);
  activationData.set("phone", order.phone);
  activationData.set("email", order.email ?? "");
  activationData.set("city", order.city);
  activationData.set("shop_type", order.shop_type);
  activationData.set("plan_code", plan.code);
  activationData.set("billing_cycle", order.billing_cycle);
  activationData.set("branches", String(order.branches));
  activationData.set("registers", String(order.registers));
  activationData.set("agreed_price", String(order.quoted_price));
  activationData.set("trial_days", "0");
  activationData.set("notes", `Verified self-serve order ${order.id}`);

  const { tenantId, inviteUrl } = await activateClientRecord(activationData, session, supabase);
  const { error: updateError } = await supabase
    .from("orders")
    .update({
      status: "verified",
      tenant_id: tenantId,
      verified_by: session.userId,
      verified_at: new Date().toISOString(),
    })
    .eq("id", order.id);

  if (updateError) {
    redirect(`/admin/orders?error=The+client+was+created+but+the+order+could+not+be+marked+verified.&invite=${encodeURIComponent(inviteUrl)}`);
  }

  await recordAudit(session, {
    action: "order.verified",
    tenantId,
    subjectType: "order",
    subjectId: order.id,
    after: { status: "verified", inviteUrl },
  });

  redirect(`/admin/orders?success=Order+verified.&invite=${encodeURIComponent(inviteUrl)}`);
}

export async function rejectOrder(formData: FormData) {
  const session = await requirePlatformAdmin();
  if (!canTakePayments(session)) {
    redirect("/admin/orders?error=Only+the+super+admin+can+reject+orders.");
  }

  const orderId = toText(formData.get("order_id"));
  const reason = toText(formData.get("reason"));
  if (!orderId || !reason) redirect("/admin/orders?error=Add+a+rejection+reason.");

  const supabase = createAdminClient();
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status")
    .eq("id", orderId)
    .maybeSingle();

  if (orderError || !order || !["awaiting_payment", "proof_submitted"].includes(order.status)) {
    redirect("/admin/orders?error=That+order+cannot+be+rejected.");
  }

  const { error: updateError } = await supabase
    .from("orders")
    .update({ status: "rejected", rejection_reason: reason })
    .eq("id", order.id);

  if (updateError) redirect("/admin/orders?error=The+order+could+not+be+rejected.");

  await recordAudit(session, {
    action: "order.rejected",
    subjectType: "order",
    subjectId: order.id,
    after: { status: "rejected", reason },
  });

  redirect("/admin/orders?success=Order+rejected.");
}

export async function recordPayment(formData: FormData) {
  const session = await requirePlatformAdmin();
  if (!canTakePayments(session)) {
    redirect("/admin/payments?error=Only+the+super+admin+can+record+payments.");
  }
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

export async function updateClientLifecycle(formData: FormData) {
  const session = await requirePlatformAdmin();
  if (!canTakePayments(session)) {
    redirect("/admin/clients?error=Only+the+super+admin+can+change+subscription+status.");
  }

  const supabase = createAdminClient();
  const tenantId = toText(formData.get("tenant_id"));
  const status = toText(formData.get("status"));

  if (!tenantId || !["trialing", "active", "past_due", "suspended", "cancelled"].includes(status)) {
    redirect(`/admin/clients/${tenantId}?error=Choose+a+valid+subscription+status.`);
  }

  const { data: subscription, error: subscriptionError } = await supabase
    .from("subscriptions")
    .select("id, status, suspended_at, cancelled_at")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (subscriptionError || !subscription) {
    redirect(`/admin/clients/${tenantId}?error=That+client+has+no+subscription.`);
  }

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("subscriptions")
    .update({
      status,
      suspended_at: status === "suspended" ? now : null,
      cancelled_at: status === "cancelled" ? now : null,
    })
    .eq("id", subscription.id);

  if (updateError) {
    redirect(`/admin/clients/${tenantId}?error=The+subscription+status+could+not+be+updated.`);
  }

  await recordAudit(session, {
    action: "subscription.status_changed",
    tenantId,
    subjectType: "subscription",
    subjectId: subscription.id,
    before: { status: subscription.status },
    after: { status },
  });

  redirect(`/admin/clients/${tenantId}?success=Subscription+status+updated.`);
}

export async function extendSubscription(formData: FormData) {
  const session = await requirePlatformAdmin();
  if (!canTakePayments(session)) {
    redirect("/admin/clients?error=Only+the+super+admin+can+extend+subscriptions.");
  }

  const supabase = createAdminClient();
  const tenantId = toText(formData.get("tenant_id"));
  const days = Number(toText(formData.get("days"), "0"));

  if (!tenantId || !Number.isInteger(days) || days < 1 || days > 365) {
    redirect(`/admin/clients/${tenantId}?error=Enter+an+extension+between+1+and+365+days.`);
  }

  const { data: subscription, error: subscriptionError } = await supabase
    .from("subscriptions")
    .select("id, current_period_end")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (subscriptionError || !subscription) {
    redirect(`/admin/clients/${tenantId}?error=That+client+has+no+subscription.`);
  }

  const beforeEnd = subscription.current_period_end;
  const afterEnd = addDays(new Date(beforeEnd), days).toISOString();
  const { error: updateError } = await supabase
    .from("subscriptions")
    .update({ current_period_end: afterEnd })
    .eq("id", subscription.id);

  if (updateError) {
    redirect(`/admin/clients/${tenantId}?error=The+subscription+period+could+not+be+extended.`);
  }

  await recordAudit(session, {
    action: "subscription.period_extended",
    tenantId,
    subjectType: "subscription",
    subjectId: subscription.id,
    before: { current_period_end: beforeEnd },
    after: { current_period_end: afterEnd, days },
  });

  redirect(`/admin/clients/${tenantId}?success=Subscription+period+extended.`);
}

export async function updatePlan(formData: FormData) {
  const session = await requirePlatformAdmin();
  if (session.platformRole !== "super_admin") {
    redirect("/admin/plans?error=Only+the+super+admin+can+edit+plans.");
  }

  const code = toText(formData.get("code"));
  const name = toText(formData.get("name"));
  const pitch = toText(formData.get("pitch"));
  const listPrice = Number(toText(formData.get("list_price"), "0"));
  const sortOrder = Number(toText(formData.get("sort_order"), "0"));
  const featuresText = toText(formData.get("features"), "{}");

  if (!code || !name || !Number.isFinite(listPrice) || listPrice < 0 || !Number.isInteger(sortOrder)) {
    redirect("/admin/plans?error=Enter+valid+plan+details.");
  }

  let features: Record<string, unknown>;
  try {
    const parsed = JSON.parse(featuresText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    features = parsed as Record<string, unknown>;
  } catch {
    redirect("/admin/plans?error=Features+must+be+valid+JSON.");
  }

  const supabase = createAdminClient();
  const { data: before, error: fetchError } = await supabase
    .from("plans")
    .select("id, name, pitch, list_price, features, sort_order, is_active")
    .eq("code", code)
    .maybeSingle();

  if (fetchError || !before) redirect("/admin/plans?error=That+plan+could+not+be+found.");

  const { error: updateError } = await supabase
    .from("plans")
    .update({ name, pitch: pitch || null, list_price: listPrice, features, sort_order: sortOrder, is_active: formData.get("is_active") === "on" })
    .eq("id", before.id);

  if (updateError) redirect("/admin/plans?error=The+plan+could+not+be+updated.");

  await recordAudit(session, {
    action: "plan.updated",
    subjectType: "plan",
    subjectId: before.id,
    before,
    after: { name, pitch, list_price: listPrice, features, sort_order: sortOrder },
  });

  redirect("/admin/plans?success=Plan+updated.");
}

export async function updateLeadStatus(formData: FormData) {
  const session = await requirePlatformAdmin();
  const leadId = toText(formData.get("lead_id"));
  const status = toText(formData.get("status"));
  const notes = toText(formData.get("notes"));

  if (!leadId || !["new", "contacted", "qualified", "won", "lost"].includes(status)) {
    redirect("/admin/leads?error=Choose+a+valid+lead+status.");
  }

  const supabase = createAdminClient();
  const { data: before, error: fetchError } = await supabase
    .from("leads")
    .select("id, status, notes")
    .eq("id", leadId)
    .maybeSingle();

  if (fetchError || !before) redirect("/admin/leads?error=That+lead+could+not+be+found.");

  const { error: updateError } = await supabase
    .from("leads")
    .update({ status, notes: notes || null, handled_by: session.userId })
    .eq("id", leadId);

  if (updateError) redirect("/admin/leads?error=The+lead+could+not+be+updated.");

  await recordAudit(session, {
    action: "lead.updated",
    subjectType: "lead",
    subjectId: leadId,
    before,
    after: { status, notes },
  });

  redirect("/admin/leads?success=Lead+updated.");
}

export async function updateClientSubscription(formData: FormData) {
  const session = await requirePlatformAdmin();
  if (session.platformRole !== "super_admin") {
    redirect("/admin/clients?error=Only+the+super+admin+can+edit+entitlements.");
  }

  const tenantId = toText(formData.get("tenant_id"));
  const planCode = toText(formData.get("plan_code"));
  const agreedPrice = Number(toText(formData.get("agreed_price"), "0"));
  const maxBranches = Number(toText(formData.get("max_branches"), "1"));
  const maxRegisters = Number(toText(formData.get("max_registers"), "1"));
  const overridesText = toText(formData.get("feature_overrides"), "{}");

  if (!tenantId || !planCode || !Number.isFinite(agreedPrice) || agreedPrice < 0 || !Number.isInteger(maxBranches) || maxBranches < 1 || !Number.isInteger(maxRegisters) || maxRegisters < 1) {
    redirect(`/admin/clients/${tenantId}?error=Enter+valid+subscription+values.`);
  }

  let featureOverrides: Record<string, unknown>;
  try {
    const parsed = JSON.parse(overridesText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    featureOverrides = parsed as Record<string, unknown>;
  } catch {
    redirect(`/admin/clients/${tenantId}?error=Feature+overrides+must+be+valid+JSON.`);
  }

  const supabase = createAdminClient();
  const [{ data: plan }, { data: before, error: fetchError }] = await Promise.all([
    supabase.from("plans").select("id").eq("code", planCode).maybeSingle(),
    supabase.from("subscriptions").select("id, plan_id, agreed_price, max_branches, max_registers, feature_overrides").eq("tenant_id", tenantId).maybeSingle(),
  ]);

  if (fetchError || !before || !plan) redirect(`/admin/clients/${tenantId}?error=The+subscription+or+plan+could+not+be+found.`);

  const { error: updateError } = await supabase
    .from("subscriptions")
    .update({ plan_id: plan.id, agreed_price: agreedPrice, max_branches: maxBranches, max_registers: maxRegisters, feature_overrides: featureOverrides })
    .eq("id", before.id);

  if (updateError) redirect(`/admin/clients/${tenantId}?error=The+entitlements+could+not+be+updated.`);

  await recordAudit(session, {
    action: "subscription.entitlements_updated",
    tenantId,
    subjectType: "subscription",
    subjectId: before.id,
    before,
    after: { plan_id: plan.id, agreed_price: agreedPrice, max_branches: maxBranches, max_registers: maxRegisters, feature_overrides: featureOverrides },
  });

  redirect(`/admin/clients/${tenantId}?success=Entitlements+updated.`);
}

export async function regenerateInvite(formData: FormData) {
  const session = await requirePlatformAdmin();
  const tenantId = toText(formData.get("tenant_id"));
  if (!tenantId) redirect("/admin/clients?error=The+client+could+not+be+identified.");

  const supabase = createAdminClient();
  await supabase.from("invites").update({ revoked_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("tenant_role", "owner").is("used_at", null).is("revoked_at", null);

  const rawToken = `${crypto.randomUUID()}-${Date.now()}`;
  const { error: inviteError } = await supabase.from("invites").insert({
    tenant_id: tenantId,
    token_hash: await sha256Hex(rawToken),
    tenant_role: "owner",
    expires_at: new Date(Date.now() + 72 * DAY_MS).toISOString(),
    created_by: session.userId,
  });

  if (inviteError) redirect(`/admin/clients/${tenantId}?error=The+invite+could+not+be+regenerated.`);
  const inviteUrl = await inviteUrlFromHeaders(rawToken);
  await recordAudit(session, { action: "invite.regenerated", tenantId, subjectType: "tenant", subjectId: tenantId, after: { inviteUrl } });
  redirect(`/admin/clients/${tenantId}?success=Invite+regenerated.&invite=${encodeURIComponent(inviteUrl)}`);
}

export async function revokeInvite(formData: FormData) {
  const session = await requirePlatformAdmin();
  const tenantId = toText(formData.get("tenant_id"));
  if (!tenantId) redirect("/admin/clients?error=The+client+could+not+be+identified.");

  const supabase = createAdminClient();
  const { error } = await supabase.from("invites").update({ revoked_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("tenant_role", "owner").is("used_at", null).is("revoked_at", null);
  if (error) redirect(`/admin/clients/${tenantId}?error=The+invite+could+not+be+revoked.`);
  await recordAudit(session, { action: "invite.revoked", tenantId, subjectType: "tenant", subjectId: tenantId });
  redirect(`/admin/clients/${tenantId}?success=Invite+revoked.`);
}
