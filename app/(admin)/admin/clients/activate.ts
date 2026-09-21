import "server-only";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { sha256Hex } from "@/lib/invite-token";
import { INVITE_DAYS, checkClient, inviteMessage } from "@/lib/platform/admin";
import type { PlatformSession } from "@/lib/platform/access";
import { SHOP_TYPES } from "@/lib/pos/settings-options";
import { createAdminClient } from "@/utils/supabase/admin";
import { IDLE, type AdminState } from "../state";

/**
 * The one way a shop comes into existence.
 *
 * Deliberately **not** in `actions.ts`. Every export of a `"use server"` module
 * is a callable endpoint with whatever arguments the caller chooses, so a
 * shared body that takes its actor as a parameter would be an unauthenticated
 * route to activating a tenant as anybody. It lives here, behind
 * `server-only`, and both Server Actions that reach it — the activation form
 * and the order queue's Verify — do their own `requireBilling()` first and hand
 * in the session they were given.
 *
 * Both paths share it because `Plan.md` is right about why: there should be
 * exactly one function that can bring a tenant into being, so there is exactly
 * one thing to audit and one place to get right.
 */

const fail = (error: string): AdminState => ({ ...IDLE, error });

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

const longText = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim() : "";

/**
 * Where the signup link points.
 *
 * Read off the request rather than from a constant, because the same build runs
 * on localhost, on a preview URL and in production — and the one thing an
 * invite link cannot be is nearly right. It is pasted into somebody's WhatsApp,
 * and nobody finds out it was wrong until the shop rings to say the link is
 * broken. `NEXT_PUBLIC_SITE_URL` overrides it behind a proxy that rewrites the
 * host.
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

/**
 * A single-use invite token.
 *
 * 32 random bytes, hex. The plaintext is returned to the operator's screen once
 * and stored nowhere — only its sha256 reaches the database, so a leaked dump
 * yields no usable invite. That is `0001_init.sql`'s third enforcement layer,
 * and it is why `activate_tenant` takes a hash rather than a token: an argument
 * to a function ends up in the slow-query log.
 */
export function mintToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function inviteFor(shopName: string, phone: string, token: string) {
  const link = `${await siteOrigin()}/signup?token=${token}`;

  return { link, message: inviteMessage(shopName, link), phone, shopName };
}

/**
 * Tenant, branch, subscription and hashed invite — four rows in the one
 * transaction `public.activate_tenant` (`0036`) holds, because a half-done
 * activation is the worst row in the system: a shop that signs in to a console
 * with no plan behind it, or a link already pasted into a chat pointing at a
 * tenant that does not have one.
 *
 * The price is asked for separately from the plan on purpose. Pakistani B2B
 * sales involve haggling — *bhai 4,000 kar do* — and a system that can only
 * charge the list price makes you either lose the deal or lie to your own
 * records. The plan decides entitlement; `agreed_price` decides the invoice.
 */
export async function activateShop(
  formData: FormData,
  orderId: string | null,
  actor: PlatformSession,
): Promise<AdminState> {
  const draft = {
    shopName: text(formData.get("shop_name")),
    ownerName: text(formData.get("owner_name")),
    phone: text(formData.get("phone")),
    email: text(formData.get("email")),
    city: text(formData.get("city")),
    planId: text(formData.get("plan_id")),
    billingCycle: text(formData.get("billing_cycle")),
    agreedPrice: text(formData.get("agreed_price")),
    branches: text(formData.get("branches")) || "1",
    registers: text(formData.get("registers")) || "1",
    trialDays: text(formData.get("trial_days")) || "0",
    notes: longText(formData.get("notes")),
  };

  // The same function the form refuses with, so the sentence under the field
  // and the sentence from the server are one sentence.
  const complaint = checkClient(draft);
  if (complaint) return fail(complaint);

  const startsAt = text(formData.get("starts_at"));
  const start = startsAt ? new Date(`${startsAt}T00:00:00`) : new Date();
  if (Number.isNaN(start.getTime())) return fail("That start date is not a date.");

  const token = mintToken();
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("activate_tenant", {
    p_shop_name: draft.shopName,
    p_owner_name: draft.ownerName,
    p_phone: draft.phone,
    p_email: draft.email,
    p_city: draft.city,
    // `tenants.shop_type` is a one-value check constraint since `0034` — Flo is
    // a supermarket till, and the list is what the product is rather than a
    // survey of what a shop might be. A self-serve order carries whatever the
    // buyer typed about themselves and that text stays on the order, which is
    // the right place to find out that Flo does not run a dhaba.
    p_shop_type: SHOP_TYPES[0].id,
    p_ntn: text(formData.get("ntn")),
    p_strn: text(formData.get("strn")),
    p_notes: draft.notes,
    p_plan_id: draft.planId,
    p_billing_cycle: draft.billingCycle,
    p_agreed_price: Number(draft.agreedPrice),
    p_max_branches: Number(draft.branches),
    p_max_registers: Number(draft.registers),
    p_trial_days: Number(draft.trialDays),
    p_starts_at: start.toISOString(),
    p_grace_days: 7,
    p_token_hash: await sha256Hex(token),
    p_invite_days: INVITE_DAYS,
    p_order_id: orderId,
    p_actor: actor.userId,
  });

  if (error || !data) {
    console.error("[admin] activation failed", error);
    return fail(
      "That shop could not be activated. Nothing was created — check the details and try again.",
    );
  }

  const result = data as { tenant_id: string; status: string };

  await recordAudit(actor, {
    action: "tenant.activated",
    tenantId: result.tenant_id,
    subjectType: "tenant",
    subjectId: result.tenant_id,
    after: {
      shop_name: draft.shopName,
      plan_id: draft.planId,
      billing_cycle: draft.billingCycle,
      agreed_price: Number(draft.agreedPrice),
      trial_days: Number(draft.trialDays),
      status: result.status,
      order_id: orderId,
    },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/clients");
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/clients/${result.tenant_id}`);

  return {
    error: null,
    savedAt: Date.now(),
    saved: { label: `${draft.shopName} is live`, detail: "Send them the link." },
    invite: await inviteFor(draft.shopName, draft.phone, token),
    tenantId: result.tenant_id,
  };
}
