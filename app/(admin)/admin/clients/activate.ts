import "server-only";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { generatePassword } from "@/lib/password";
import {
  GRACE_DAYS,
  checkPlan,
  checkShop,
  loginMessage,
  type PlanDraft,
  type ShopDraft,
} from "@/lib/platform/admin";
import type { PlatformSession } from "@/lib/platform/access";
import { SHOP_TYPES } from "@/lib/pos/settings-options";
import { isWorkEmail, workEmail } from "@/lib/pos/staff-options";
import { createAdminClient } from "@/utils/supabase/admin";
import { IDLE, type AdminState } from "../state";

/**
 * The three steps that turn somebody who paid into a shop that trades.
 *
 * Deliberately **not** in `actions.ts`. Every export of a `"use server"` module
 * is a callable endpoint with whatever arguments the caller chooses, so a
 * shared body that takes its actor as a parameter would be an unauthenticated
 * route to activating a tenant as anybody. It lives here, behind
 * `server-only`, and every Server Action that reaches it does its own
 * `requireBilling()` first and hands in the session it was given.
 *
 * `0042` split what `activate_tenant` used to do in one breath, because it is
 * not one decision:
 *
 * 1. `createClientRecord` — the shop exists. From an order, only once money has been
 *    recorded against it; `public.create_client` locks the order and refuses
 *    otherwise, so one order cannot become two shops.
 * 2. `startPlan` — the shop is on a plan and its period is running.
 * 3. `issueOwnerLogin` — the owner can sign in, with a username and password
 *    Flo mints and the operator sends on WhatsApp.
 *
 * Between 1 and 2 the client is "Not activated", which the console draws as a
 * state to finish rather than a row that half-exists. Between 2 and 3 — only if
 * minting the login failed — the record says nobody can sign in yet and offers
 * the button that fixes it, because that button is exactly step 3 again.
 */

const fail = (error: string): AdminState => ({ ...IDLE, error });

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

const longText = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim() : "";

/**
 * Where the sign-in page lives, for the message the owner receives.
 *
 * Read off the request rather than from a constant, because the same build runs
 * on localhost, on a preview URL and in production — and a login pasted into
 * somebody's WhatsApp is the one link that cannot be nearly right. Nobody finds
 * out it was wrong until the shop rings to say it is broken.
 * `NEXT_PUBLIC_SITE_URL` overrides it behind a proxy that rewrites the host.
 */
export async function siteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");

  return `${protocol}://${host}`;
}

export function readShop(formData: FormData): ShopDraft {
  return {
    shopName: text(formData.get("shop_name")),
    ownerName: text(formData.get("owner_name")),
    phone: text(formData.get("phone")),
    email: text(formData.get("email")),
    city: text(formData.get("city")),
    notes: longText(formData.get("notes")),
  };
}

export function readPlan(formData: FormData): PlanDraft {
  return {
    planId: text(formData.get("plan_id")),
    billingCycle: text(formData.get("billing_cycle")),
    agreedPrice: text(formData.get("agreed_price")),
    branches: text(formData.get("branches")) || "1",
    registers: text(formData.get("registers")) || "1",
    trialDays: text(formData.get("trial_days")) || "0",
    graceDays: text(formData.get("grace_days")) || String(GRACE_DAYS),
  };
}

function revalidateClient(tenantId: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/clients");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/payments");
  revalidatePath(`/admin/clients/${tenantId}`);
}

/* -------------------------------------------------------------------------- */
/* 1 · The client                                                             */
/* -------------------------------------------------------------------------- */

export async function createClientRecord(
  shop: ShopDraft & { ntn?: string; strn?: string },
  orderId: string | null,
  actor: PlatformSession,
): Promise<{ tenantId: string } | { error: string }> {
  // The same function the form refuses with, so the sentence under the field
  // and the sentence from the server are one sentence.
  const complaint = checkShop(shop);
  if (complaint) return { error: complaint };

  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("create_client", {
    p_shop_name: shop.shopName,
    p_owner_name: shop.ownerName,
    p_phone: shop.phone,
    p_email: shop.email,
    p_city: shop.city,
    // `tenants.shop_type` is a one-value check constraint since `0034` — Flo is
    // a supermarket till. A self-serve order keeps whatever the buyer typed
    // about themselves, which is the right place to find out that Flo does not
    // run a dhaba.
    p_shop_type: SHOP_TYPES[0].id,
    p_ntn: shop.ntn ?? "",
    p_strn: shop.strn ?? "",
    p_notes: shop.notes,
    p_order_id: orderId,
    p_actor: actor.userId,
  });

  if (error || !data) {
    console.error("[admin] client creation failed", error);

    const message = error?.message ?? "";
    if (message.includes("no payment has been recorded")) {
      return { error: "Record the payment against this order first, in Payments." };
    }
    if (message.includes("already been dealt with")) {
      return { error: "That order has already been accepted or rejected. Reload the queue." };
    }
    return { error: "That client could not be created. Nothing was written — try again." };
  }

  const tenantId = String((data as { tenant_id: string }).tenant_id);

  await recordAudit(actor, {
    action: orderId ? "order.accepted" : "tenant.created",
    tenantId,
    subjectType: orderId ? "order" : "tenant",
    subjectId: orderId ?? tenantId,
    after: { shop_name: shop.shopName, order_id: orderId },
  });

  revalidateClient(tenantId);

  return { tenantId };
}

/* -------------------------------------------------------------------------- */
/* 2 · The plan                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The price is asked for separately from the plan on purpose. Pakistani B2B
 * sales involve haggling — *bhai 4,000 kar do* — and a system that can only
 * charge the list price makes you either lose the deal or lie to your own
 * records. The plan decides entitlement; `agreed_price` decides the invoice.
 */
export async function startPlan(
  tenantId: string,
  formData: FormData,
  actor: PlatformSession,
): Promise<{ status: string; currentPeriodEnd: string } | { error: string }> {
  const plan = readPlan(formData);

  const complaint = checkPlan(plan);
  if (complaint) return { error: complaint };

  const startsAt = text(formData.get("starts_at"));
  const start = startsAt ? new Date(`${startsAt}T00:00:00`) : new Date();
  if (Number.isNaN(start.getTime())) return { error: "That start date is not a date." };

  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("start_subscription", {
    p_tenant: tenantId,
    p_plan_id: plan.planId,
    p_billing_cycle: plan.billingCycle,
    p_agreed_price: Number(plan.agreedPrice),
    p_max_branches: Number(plan.branches),
    p_max_registers: Number(plan.registers),
    p_trial_days: Number(plan.trialDays),
    p_starts_at: start.toISOString(),
    p_grace_days: Number(plan.graceDays),
  });

  if (error || !data) {
    console.error("[admin] activation failed for %s", tenantId, error);

    if (error?.message.includes("already on a plan")) {
      return { error: "That client is already activated. Reload the record." };
    }
    return { error: "That plan could not be started. Nothing was changed — try again." };
  }

  const result = data as { subscription_id: string; status: string; current_period_end: string };

  await recordAudit(actor, {
    action: "tenant.activated",
    tenantId,
    subjectType: "subscription",
    subjectId: result.subscription_id,
    after: {
      plan_id: plan.planId,
      billing_cycle: plan.billingCycle,
      agreed_price: Number(plan.agreedPrice),
      max_registers: Number(plan.registers),
      trial_days: Number(plan.trialDays),
      grace_days: Number(plan.graceDays),
      status: result.status,
      current_period_end: result.current_period_end,
    },
  });

  revalidateClient(tenantId);

  return { status: result.status, currentPeriodEnd: result.current_period_end };
}

/* -------------------------------------------------------------------------- */
/* 3 · The owner's login                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A username and password for the shop's owner — minted, never chosen.
 *
 * The same bargain `/app/employees` strikes for a cashier, one level up: the
 * username is a Flo work address (`owner@almadina.flopos.pk`), which is what
 * lets it past the sign-in allow-list without a line per shop, and the
 * password is shown once and stored nowhere. The login can reach the shop's
 * console and nothing else — `/admin` 404s for anybody without a platform row.
 *
 * Called at activation and again from "New password". For an owner who already
 * exists it resets the password rather than making a second owner, because
 * there is exactly one per shop. An owner whose login is *not* a work address —
 * one who redeemed an old `0036` invite with their own Gmail — is moved onto
 * one, since that address could never get past the allow-list anyway.
 *
 * The one owner this refuses is a console operator's own account. Resetting
 * that would hand a shop's WhatsApp the password to `/admin`.
 */
export async function issueOwnerLogin(
  tenantId: string,
  actor: PlatformSession,
): Promise<AdminState> {
  const supabase = createAdminClient();

  const [{ data: tenant }, { data: owner }] = await Promise.all([
    supabase
      .from("tenants")
      .select("shop_name, owner_name, phone")
      .eq("id", tenantId)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("id, email")
      .eq("tenant_id", tenantId)
      .eq("tenant_role", "owner")
      .order("created_at")
      .limit(1)
      .maybeSingle(),
  ]);

  if (!tenant) return fail("That client is not on the list any more.");

  const shopName = String(tenant.shop_name);
  const ownerName = String(tenant.owner_name);
  const password = generatePassword();

  let email: string;
  let userId: string;

  if (owner) {
    const { data: operator } = await supabase
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", owner.id)
      .maybeSingle();

    if (operator) {
      return fail(
        "This shop's owner login is also a console operator. Change that password from their own account, not from here.",
      );
    }

    const current = typeof owner.email === "string" ? owner.email : "";
    const next = current && isWorkEmail(current) ? current : await claimEmail(shopName);
    if (!next) return fail("We could not make a username for this shop. Try again.");

    const { error } = await supabase.auth.admin.updateUserById(owner.id, {
      password,
      ...(next !== current ? { email: next, email_confirm: true } : {}),
    });

    if (error) {
      console.error("[admin] owner password reset failed for %s", tenantId, error);
      return fail("That password could not be changed. Please try again.");
    }

    if (next !== current) {
      await supabase.from("profiles").update({ email: next }).eq("id", owner.id);
    }

    email = next;
    userId = owner.id;
  } else {
    const created = await createOwner(tenantId, shopName, ownerName, tenant.phone, password, actor);
    if ("error" in created) return fail(created.error);

    email = created.email;
    userId = created.userId;
  }

  await recordAudit(actor, {
    action: owner ? "owner.password_reset" : "owner.login_created",
    tenantId,
    subjectType: "profile",
    subjectId: userId,
    // No password, here or anywhere. The trail records that a login was
    // handed out and by whom, which is the question it exists to answer.
    after: { email },
  });

  revalidateClient(tenantId);

  return {
    ...IDLE,
    savedAt: Date.now(),
    saved: owner
      ? { label: "New password made", detail: "The old one no longer works." }
      : { label: `${shopName} is live`, detail: "Send the owner their login." },
    credentials: {
      name: ownerName,
      email,
      password,
      phone: String(tenant.phone ?? ""),
      message: loginMessage(shopName, `${await siteOrigin()}/login`, email, password),
    },
    tenantId,
  };
}

async function createOwner(
  tenantId: string,
  shopName: string,
  ownerName: string,
  phone: unknown,
  password: string,
  actor: PlatformSession,
): Promise<{ email: string; userId: string } | { error: string }> {
  const supabase = createAdminClient();

  const { data: branch } = await supabase
    .from("branches")
    .select("id")
    .eq("tenant_id", tenantId)
    .order("is_primary", { ascending: false })
    .order("created_at")
    .limit(1)
    .maybeSingle();

  // A few tries rather than one: `claimEmail` checks `profiles`, and an
  // address can still be held by an auth user with no profile — a half-deleted
  // account — which only `createUser` can tell us about.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const email = await claimEmail(shopName, attempt);
    if (!email) break;

    const { data: created, error } = await supabase.auth.admin.createUser({
      email,
      password,
      // Nothing is ever delivered to this address — there is no inbox behind
      // it. Leaving it unconfirmed would mean an owner who cannot sign in until
      // an email that will never arrive has been opened.
      email_confirm: true,
      user_metadata: { full_name: ownerName },
    });

    if (error || !created.user) {
      if (error?.code === "email_exists") continue;
      console.error("[admin] owner account failed for %s", tenantId, error);
      return { error: "The plan started, but the owner's login could not be made. Press New password to try again." };
    }

    const { error: profileError } = await supabase.from("profiles").insert({
      id: created.user.id,
      tenant_id: tenantId,
      branch_id: branch?.id ?? null,
      tenant_role: "owner",
      full_name: ownerName,
      phone: typeof phone === "string" ? phone : null,
      email,
      created_by: actor.userId,
    });

    if (profileError) {
      await supabase.auth.admin.deleteUser(created.user.id);
      console.error("[admin] owner profile failed for %s", tenantId, profileError);
      return { error: "The plan started, but the owner's login could not be attached. Press New password to try again." };
    }

    return { email, userId: created.user.id };
  }

  return { error: "We could not find a free username for this shop. Try again." };
}

/**
 * `owner@<shop>.flopos.pk`, or `owner2@…` when two shops share a name.
 *
 * `skip` steps past addresses already tried this call, for the retry above.
 */
async function claimEmail(shopName: string, skip = 0): Promise<string | null> {
  const supabase = createAdminClient();
  let skipped = 0;

  for (let suffix = 0; suffix < 25; suffix += 1) {
    const candidate = workEmail("owner", shopName, suffix);

    const { data } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", candidate)
      .maybeSingle();

    if (data) continue;
    if (skipped < skip) {
      skipped += 1;
      continue;
    }
    return candidate;
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* All three, for a deal closed off the site                                  */
/* -------------------------------------------------------------------------- */

/**
 * The direct path: `/admin/clients/new`, for a shop sold on the phone with no
 * order behind it. The same three steps in the same order, and a failure part
 * way says which step stopped — the client and plan that were already written
 * stand, and the record page finishes the rest.
 */
export async function activateShop(
  formData: FormData,
  actor: PlatformSession,
): Promise<AdminState> {
  const shop = readShop(formData);

  const planComplaint = checkPlan(readPlan(formData));
  const shopComplaint = checkShop(shop);
  if (shopComplaint ?? planComplaint) return fail((shopComplaint ?? planComplaint)!);

  const client = await createClientRecord(
    { ...shop, ntn: text(formData.get("ntn")), strn: text(formData.get("strn")) },
    null,
    actor,
  );
  if ("error" in client) return fail(client.error);

  const plan = await startPlan(client.tenantId, formData, actor);
  if ("error" in plan) {
    return {
      ...fail(`The client was created, but ${plan.error.charAt(0).toLowerCase()}${plan.error.slice(1)} Finish it from their record.`),
      tenantId: client.tenantId,
    };
  }

  const login = await issueOwnerLogin(client.tenantId, actor);
  return { ...login, tenantId: client.tenantId };
}
