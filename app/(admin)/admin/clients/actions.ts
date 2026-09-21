"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { writeReadError } from "@/lib/pos/read-error";
import { sha256Hex } from "@/lib/invite-token";
import {
  INVITE_DAYS,
  isCycle,
  isStatus,
  type SubscriptionStatus,
} from "@/lib/platform/admin";
import { requireBilling, requirePlatform } from "@/lib/platform/access";
import { createAdminClient } from "@/utils/supabase/admin";
import { IDLE, type AdminState } from "../state";
import { activateShop, inviteFor, mintToken } from "./activate";

/**
 * Everything the owner console writes about a shop.
 *
 * Service role throughout, because `0001_init.sql` revoked insert/update/delete
 * on every platform table from `authenticated` outright — rule 3, so there is
 * one auditable write path rather than a policy surface to get wrong. That
 * makes `requireBilling()` at the top of each action the whole of access
 * control, and it is checked in the action rather than trusted from the rail:
 * a control the browser does not draw is not an endpoint nobody can call.
 *
 * Every one of them writes an `audit_log` row. That is not diligence for its
 * own sake — this console can hand out a free year, suspend a shop mid-trade
 * and read every client's sales, and the table is append-only by trigger
 * precisely so nothing here, including this file, can tidy up afterwards.
 */

const fail = (error: string): AdminState => ({ ...IDLE, error });

const done = (label: string, detail?: string): AdminState => ({
  ...IDLE,
  savedAt: Date.now(),
  saved: { label, detail },
});

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

/** A note keeps its line breaks; everything else is collapsed. */
const longText = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim() : "";

const number = (value: FormDataEntryValue | null) => Number(text(value) || "0");

function revalidateClient(tenantId?: string | null) {
  revalidatePath("/admin");
  revalidatePath("/admin/clients");
  revalidatePath("/admin/payments");
  if (tenantId) revalidatePath(`/admin/clients/${tenantId}`);
}

/* -------------------------------------------------------------------------- */
/* Activation — path A                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A closed deal becomes a working shop.
 *
 * The work is `activateShop` in `./activate.ts`, which the order queue's Verify
 * button calls too — one function that can bring a tenant into existence, so
 * one thing to audit. It is not exported from a `"use server"` module because
 * every export of one is a callable endpoint, and a shared body taking its
 * actor as an argument would be a way to activate a shop as anybody.
 */
export async function activateClient(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireBilling();
  if (!gate.ok) return fail(gate.error);

  return activateShop(formData, null, gate.session);
}

/* -------------------------------------------------------------------------- */
/* The shop's own details                                                     */
/* -------------------------------------------------------------------------- */

/** The name on the receipt, and the number you ring. Nothing about money. */
export async function updateClient(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireBilling();
  if (!gate.ok) return fail(gate.error);

  const tenantId = text(formData.get("tenant_id"));
  if (!tenantId) return fail("That shop is not on the list any more.");

  const row = {
    shop_name: text(formData.get("shop_name")),
    owner_name: text(formData.get("owner_name")),
    phone: text(formData.get("phone")),
    email: text(formData.get("email")) || null,
    city: text(formData.get("city")),
    ntn: text(formData.get("ntn")) || null,
    strn: text(formData.get("strn")) || null,
    notes: longText(formData.get("notes")) || null,
  };

  if (!row.shop_name || !row.owner_name || !row.phone || !row.city) {
    return fail("Shop, owner, phone and city all have to be filled in.");
  }

  const supabase = createAdminClient();

  const { data: before } = await supabase
    .from("tenants")
    .select("shop_name, owner_name, phone, email, city, ntn, strn, notes")
    .eq("id", tenantId)
    .maybeSingle();

  const { error } = await supabase.from("tenants").update(row).eq("id", tenantId);

  if (error) {
    console.error("[admin] tenant update failed for %s: %s", tenantId, writeReadError(error));
    return fail("Those details did not save. Please try again.");
  }

  await recordAudit(gate.session, {
    action: "tenant.updated",
    tenantId,
    subjectType: "tenant",
    subjectId: tenantId,
    before,
    after: row,
  });

  revalidateClient(tenantId);

  return done(`${row.shop_name} saved`);
}

/* -------------------------------------------------------------------------- */
/* The plan and what it buys                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The entitlement editor: plan, cycle, price, ceilings and the period itself.
 *
 * `max_registers` here is the only ceiling in the product that actually bites —
 * Settings reads it through `getEntitlements` when a shop adds a counter. It
 * lives on the subscription rather than on the plan precisely so a haggled
 * "bhai teen counter kar do" is a one-row update and not a release.
 *
 * The period end is a date input rather than a set of buttons, because the
 * commonest reason to touch it is that somebody paid on the 3rd for a month
 * that should have started on the 1st, and no amount of "+1 month" buttons
 * expresses that.
 */
export async function updateSubscription(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireBilling();
  if (!gate.ok) return fail(gate.error);

  const tenantId = text(formData.get("tenant_id"));
  const planId = text(formData.get("plan_id"));
  const cycle = text(formData.get("billing_cycle"));
  const status = text(formData.get("status"));
  const price = number(formData.get("agreed_price"));
  const registers = number(formData.get("max_registers"));
  const branches = number(formData.get("max_branches"));
  const grace = number(formData.get("grace_days"));
  const periodEnd = text(formData.get("current_period_end"));

  if (!tenantId || !planId) return fail("Pick a plan.");
  if (!isCycle(cycle)) return fail("Pick how often they are billed.");
  if (!isStatus(status)) return fail("That is not a standing we have.");
  if (!Number.isFinite(price) || price < 0) return fail("The price has to be a number.");
  if (!Number.isInteger(registers) || registers < 1) {
    return fail("A shop has at least one counter.");
  }
  if (!Number.isInteger(branches) || branches < 1) {
    return fail("A shop has at least one branch.");
  }
  if (!Number.isInteger(grace) || grace < 0) return fail("Grace days cannot be negative.");

  const supabase = createAdminClient();

  const { data: before } = await supabase
    .from("subscriptions")
    .select(
      "plan_id, status, billing_cycle, agreed_price, max_branches, max_registers, grace_days, current_period_start, current_period_end, suspended_at, cancelled_at",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!before) return fail("That shop has no subscription to edit.");

  const end = periodEnd ? new Date(`${periodEnd}T23:59:59`) : null;
  if (periodEnd && (!end || Number.isNaN(end.getTime()))) {
    return fail("That renewal date is not a date.");
  }

  // `subscriptions_period_ordered` refuses an end on or before the start, and a
  // constraint violation is a sentence nobody can act on — so the refusal is
  // written here, where it can name the date the operator just typed.
  if (end && new Date(before.current_period_start as string) >= end) {
    return fail("The period has to end after it starts. Pick a later date.");
  }

  // Both stamps follow the standing rather than being typed, so nothing can
  // show a suspended shop with no date against it. A shop that was already
  // suspended keeps the date it was suspended on — re-saving the form is not a
  // second suspension, and the original date is what somebody argues from.
  const was = before.status as SubscriptionStatus;
  const now = new Date().toISOString();

  const stamp = (state: SubscriptionStatus, held: unknown) =>
    status === state ? (was === state ? ((held as string | null) ?? now) : now) : null;

  const row = {
    plan_id: planId,
    status,
    billing_cycle: cycle,
    agreed_price: price,
    max_branches: branches,
    max_registers: registers,
    grace_days: grace,
    ...(end ? { current_period_end: end.toISOString() } : {}),
    suspended_at: stamp("suspended", before.suspended_at),
    cancelled_at: stamp("cancelled", before.cancelled_at),
  };

  const { error } = await supabase
    .from("subscriptions")
    .update(row)
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("[admin] subscription update failed for %s: %s", tenantId, writeReadError(error));
    return fail("That plan change did not save. Please try again.");
  }

  await recordAudit(gate.session, {
    action: "subscription.updated",
    tenantId,
    subjectType: "subscription",
    subjectId: tenantId,
    before,
    after: row,
  });

  revalidateClient(tenantId);

  return done("Plan saved");
}

/**
 * One tap on the lifecycle: suspend, put back, mark past due, cancel.
 *
 * Its own action rather than the form above, because this is the thing an
 * operator does with a shopkeeper on the phone and a form with nine fields in
 * it is not what that moment wants.
 *
 * What suspension means is worth saying out loud, because it is the whole of
 * "disable" in Flo: the shop can still sign in, still read its own sales, still
 * close its drawer and still export everything. What stops is ringing up a new
 * sale. Holding a shop's own books hostage over an unpaid invoice is indecent
 * and, in a dispute about their records, the weaker position to be standing in.
 */
export async function setSubscriptionStatus(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireBilling();
  if (!gate.ok) return fail(gate.error);

  const tenantId = text(formData.get("tenant_id"));
  const status = text(formData.get("status"));

  if (!tenantId) return fail("That shop is not on the list any more.");
  if (!isStatus(status)) return fail("That is not a standing we have.");

  const supabase = createAdminClient();

  const { data: before } = await supabase
    .from("subscriptions")
    .select("status")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!before) return fail("That shop has no subscription.");

  const now = new Date().toISOString();

  const { error } = await supabase
    .from("subscriptions")
    .update({
      status,
      suspended_at: status === "suspended" ? now : null,
      cancelled_at: status === "cancelled" ? now : null,
    })
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("[admin] status change failed for %s: %s", tenantId, writeReadError(error));
    return fail("That change did not save. Please try again.");
  }

  await recordAudit(gate.session, {
    action: `subscription.${status}`,
    tenantId,
    subjectType: "subscription",
    subjectId: tenantId,
    before,
    after: { status },
  });

  revalidateClient(tenantId);

  return done(LABELS[status as SubscriptionStatus]);
}

const LABELS: Record<SubscriptionStatus, string> = {
  trialing: "Put back on trial",
  active: "Back in business",
  past_due: "Marked past due",
  suspended: "Suspended — the till will not charge",
  cancelled: "Cancelled",
};

/**
 * Days given rather than sold — a shop that lost a week to a dead printer, or
 * a trial you agreed to stretch on the phone.
 *
 * Deliberately separate from recording a payment. Extending a period without
 * money against it is a decision somebody should have to make on purpose, and
 * the audit row says which of the two it was.
 */
export async function extendPeriod(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireBilling();
  if (!gate.ok) return fail(gate.error);

  const tenantId = text(formData.get("tenant_id"));
  const days = number(formData.get("days"));

  if (!tenantId) return fail("That shop is not on the list any more.");
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return fail("Give between 1 and 365 days.");
  }

  const supabase = createAdminClient();

  const { data: before } = await supabase
    .from("subscriptions")
    .select("current_period_end, status")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!before) return fail("That shop has no subscription.");

  // From today when the period has already run out, so "give them a week" means
  // a week from now rather than a week from a date that has passed.
  const from = new Date(
    Math.max(new Date(before.current_period_end as string).getTime(), Date.now()),
  );
  const to = new Date(from.getTime() + days * 86_400_000);

  const { error } = await supabase
    .from("subscriptions")
    .update({ current_period_end: to.toISOString() })
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("[admin] extension failed for %s: %s", tenantId, writeReadError(error));
    return fail("Those days did not go on. Please try again.");
  }

  await recordAudit(gate.session, {
    action: "subscription.extended",
    tenantId,
    subjectType: "subscription",
    subjectId: tenantId,
    before,
    after: { days, current_period_end: to.toISOString() },
  });

  revalidateClient(tenantId);

  return done(`${days} days added`, "No payment recorded against it.");
}

/**
 * One feature, flipped for one client.
 *
 * `subscriptions.feature_overrides` is merged over the plan's own JSON by
 * `getEntitlements`, so this is the one-off deal — "Premium price, but throw in
 * X" — without a plan per customer.
 *
 * Clearing an override is not the same as setting it false, and the form offers
 * all three: false is a promise that the shop does not get it, and clear means
 * the plan decides, which is what should happen when the plan changes later.
 */
export async function setFeatureOverride(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireBilling();
  if (!gate.ok) return fail(gate.error);

  const tenantId = text(formData.get("tenant_id"));
  const key = text(formData.get("feature"));
  const value = text(formData.get("value"));

  if (!tenantId || !key) return fail("Pick a feature.");
  if (!["on", "off", "clear"].includes(value)) return fail("Pick on, off or plan default.");

  const supabase = createAdminClient();

  const { data: before } = await supabase
    .from("subscriptions")
    .select("feature_overrides")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!before) return fail("That shop has no subscription.");

  const overrides = { ...((before.feature_overrides as Record<string, unknown>) ?? {}) };

  if (value === "clear") delete overrides[key];
  else overrides[key] = value === "on";

  const { error } = await supabase
    .from("subscriptions")
    .update({ feature_overrides: overrides })
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("[admin] override failed for %s: %s", tenantId, writeReadError(error));
    return fail("That override did not save. Please try again.");
  }

  await recordAudit(gate.session, {
    action: "subscription.override",
    tenantId,
    subjectType: "subscription",
    subjectId: tenantId,
    before: before.feature_overrides,
    after: overrides,
  });

  revalidateClient(tenantId);

  return done(
    value === "clear" ? `${key} follows the plan again` : `${key} is ${value}`,
  );
}

/* -------------------------------------------------------------------------- */
/* The invite                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A new link, and the old one dead.
 *
 * The commonest support call on a new shop is "bhai link khul nahi raha" a week
 * after activation, by which time the invite has expired. Regenerating revokes
 * every live invite for the role first, because
 * `invites_one_live_per_tenant_role` allows exactly one — two valid doors is
 * the thing that index exists to prevent.
 */
export async function regenerateInvite(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireBilling();
  if (!gate.ok) return fail(gate.error);

  const tenantId = text(formData.get("tenant_id"));
  if (!tenantId) return fail("That shop is not on the list any more.");

  const supabase = createAdminClient();

  const { data: tenant } = await supabase
    .from("tenants")
    .select("shop_name, phone, email")
    .eq("id", tenantId)
    .maybeSingle();

  if (!tenant) return fail("That shop is not on the list any more.");

  const { error: revokeError } = await supabase
    .from("invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("tenant_role", "owner")
    .is("used_at", null)
    .is("revoked_at", null);

  if (revokeError) {
    console.error("[admin] invite revoke failed for %s: %s", tenantId, writeReadError(revokeError));
    return fail("The old link could not be revoked, so no new one was made.");
  }

  const token = mintToken();

  const { data: invite, error } = await supabase
    .from("invites")
    .insert({
      tenant_id: tenantId,
      token_hash: await sha256Hex(token),
      email: (tenant.email as string | null) ?? null,
      phone: tenant.phone as string,
      tenant_role: "owner",
      expires_at: new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString(),
      created_by: gate.session.userId,
    })
    .select("id")
    .single();

  if (error || !invite) {
    console.error("[admin] invite mint failed for %s: %s", tenantId, writeReadError(error));
    return fail("A new link could not be made. Please try again.");
  }

  await recordAudit(gate.session, {
    action: "invite.regenerated",
    tenantId,
    subjectType: "invite",
    subjectId: invite.id,
  });

  revalidateClient(tenantId);

  return {
    error: null,
    savedAt: Date.now(),
    saved: { label: "New link ready", detail: "The old one no longer works." },
    invite: await inviteFor(
      tenant.shop_name as string,
      tenant.phone as string,
      token,
    ),
    tenantId,
  };
}

/** Kill the live link without making another — for a deal that fell through
 *  between the activation and the first sign-in. */
export async function revokeInvite(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireBilling();
  if (!gate.ok) return fail(gate.error);

  const tenantId = text(formData.get("tenant_id"));
  const inviteId = text(formData.get("invite_id"));

  if (!tenantId || !inviteId) return fail("That invite is already gone.");

  const supabase = createAdminClient();

  const { error } = await supabase
    .from("invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", inviteId)
    .eq("tenant_id", tenantId)
    .is("used_at", null);

  if (error) {
    console.error("[admin] invite revoke failed for %s: %s", inviteId, writeReadError(error));
    return fail("That link could not be revoked. Please try again.");
  }

  await recordAudit(gate.session, {
    action: "invite.revoked",
    tenantId,
    subjectType: "invite",
    subjectId: inviteId,
  });

  revalidateClient(tenantId);

  return done("Link revoked");
}

/* -------------------------------------------------------------------------- */
/* Notes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Free text, timestamped: who introduced you, what they haggled to, which
 * printer they bought.
 *
 * A support account may write one. It is the one thing on this screen that is
 * not billing, and a support person who cannot leave a note is a support person
 * who keeps the context in their own head.
 */
export async function addNote(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const session = await requirePlatform();

  const tenantId = text(formData.get("tenant_id"));
  const body = longText(formData.get("body"));

  if (!tenantId) return fail("That shop is not on the list any more.");
  if (!body) return fail("Write something first.");
  if (body.length > 2000) return fail("That note is too long.");

  const supabase = createAdminClient();

  const { data: note, error } = await supabase
    .from("tenant_notes")
    .insert({ tenant_id: tenantId, author_id: session.userId, body })
    .select("id")
    .single();

  if (error || !note) {
    console.error("[admin] note failed for %s: %s", tenantId, writeReadError(error));
    return fail("That note did not save. Please try again.");
  }

  await recordAudit(session, {
    action: "tenant.noted",
    tenantId,
    subjectType: "tenant_note",
    subjectId: note.id,
  });

  revalidatePath(`/admin/clients/${tenantId}`);

  return done("Note added");
}

/** A real delete. A note is our own scratchpad about our own customer, and the
 *  commonest reason to remove one is a typo two minutes old — the same call
 *  `0029` made about a supplier payment. `audit_log` keeps it either way. */
export async function deleteNote(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const session = await requirePlatform();

  const tenantId = text(formData.get("tenant_id"));
  const noteId = text(formData.get("note_id"));

  if (!tenantId || !noteId) return fail("That note is already gone.");

  const supabase = createAdminClient();

  const { data: before } = await supabase
    .from("tenant_notes")
    .select("body, created_at")
    .eq("id", noteId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const { error } = await supabase
    .from("tenant_notes")
    .delete()
    .eq("id", noteId)
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("[admin] note delete failed for %s: %s", noteId, writeReadError(error));
    return fail("That note did not come off. Please try again.");
  }

  await recordAudit(session, {
    action: "tenant.note_removed",
    tenantId,
    subjectType: "tenant_note",
    subjectId: noteId,
    before,
  });

  revalidatePath(`/admin/clients/${tenantId}`);

  return done("Note removed");
}
