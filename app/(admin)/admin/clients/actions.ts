"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { writeReadError } from "@/lib/pos/read-error";
import {
  GRACE_DAYS_MAX,
  isCycle,
  isStatus,
  lapseOf,
  writeDay,
  type SubscriptionStatus,
} from "@/lib/platform/admin";
import { requireWrite } from "@/lib/platform/access";
import { createAdminClient } from "@/utils/supabase/admin";
import { IDLE, type AdminState } from "../state";
import { activateShop, issueOwnerLogin, startPlan } from "./activate";

/**
 * Everything the owner console writes about a shop.
 *
 * Service role throughout, because `0001_init.sql` revoked insert/update/delete
 * on every platform table from `authenticated` outright — rule 3, so there is
 * one auditable write path rather than a policy surface to get wrong. That
 * makes `requireWrite(["clients"])` at the top of each action the whole of access
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
/* Activation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A deal closed on the phone, with no order behind it: client, plan and owner
 * login in one go from `/admin/clients/new`.
 *
 * The work is in `./activate.ts`, whose three steps the order queue and the
 * client record also call. It is not exported from a `"use server"` module
 * because every export of one is a callable endpoint, and a shared body taking
 * its actor as an argument would be a way to activate a shop as anybody.
 */
export async function activateClient(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireWrite(["clients"]);
  if (!gate.ok) return fail(gate.error);

  return activateShop(formData, gate.session);
}

/**
 * An accepted client goes on a plan, and its owner gets a login.
 *
 * The second half of the order flow: the order was accepted into a client on
 * `/admin/orders`, and this is the card on that client's record that finishes
 * it. The login is minted straight after the plan starts, so the operator
 * leaves this screen holding the one thing the shop is waiting for.
 */
export async function activateSubscription(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireWrite(["clients"]);
  if (!gate.ok) return fail(gate.error);

  const tenantId = text(formData.get("tenant_id"));
  if (!tenantId) return fail("That client is not on the list any more.");

  const plan = await startPlan(tenantId, formData, gate.session);
  if ("error" in plan) return fail(plan.error);

  return issueOwnerLogin(tenantId, gate.session);
}

/**
 * A new password for the owner — lost, forgotten, or written on a till.
 *
 * Also the way through when minting the login failed at activation: the same
 * step, run again. For an owner who already has a login it replaces the
 * password, which stops the old one working at the next sign-in.
 */
export async function resetOwnerLogin(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireWrite(["clients"]);
  if (!gate.ok) return fail(gate.error);

  const tenantId = text(formData.get("tenant_id"));
  if (!tenantId) return fail("That client is not on the list any more.");

  const { data: subscription } = await createAdminClient()
    .from("subscriptions")
    .select("id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  // A login to a shop with no plan is a login to a till that refuses every
  // sale. Activation mints it; until then there is nothing to sign in to.
  if (!subscription) return fail("Activate this client first — the login is made then.");

  return issueOwnerLogin(tenantId, gate.session);
}

/* -------------------------------------------------------------------------- */
/* The shop's own details                                                     */
/* -------------------------------------------------------------------------- */

/** The name on the receipt, and the number you ring. Nothing about money. */
export async function updateClient(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireWrite(["clients"]);
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
 * The commercial deal: plan, cycle, price and the ceilings. Nothing else.
 *
 * `max_registers` here is the only ceiling in the product that actually bites —
 * Settings reads it through `getEntitlements` when a shop adds a counter. It
 * lives on the subscription rather than on the plan precisely so a haggled
 * "bhai teen counter kar do" is a one-row update and not a release.
 *
 * **It deliberately writes neither the standing nor the period.** Both used to
 * be fields on this same form, and both are also written by the controls
 * beside it — `setSubscriptionStatus` from the standing buttons, and
 * `extendPeriod` and `record_subscription_payment` from the goodwill and the
 * payment forms. A form is built from the values it was rendered with, so
 * recording a payment and then pressing Save here posted the standing and the
 * renewal date *as they were before the payment* — silently re-suspending a
 * shop that had just paid and winding its period back. One writer per field is
 * the fix; `setPeriodEnd` below is where a date correction goes now.
 */
export async function updateSubscription(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireWrite(["clients"]);
  if (!gate.ok) return fail(gate.error);

  const tenantId = text(formData.get("tenant_id"));
  const planId = text(formData.get("plan_id"));
  const cycle = text(formData.get("billing_cycle"));
  const price = number(formData.get("agreed_price"));
  const registers = number(formData.get("max_registers"));
  const branches = number(formData.get("max_branches"));
  const grace = number(formData.get("grace_days"));

  if (!tenantId || !planId) return fail("Pick a plan.");
  if (!isCycle(cycle)) return fail("Pick how often they are billed.");
  if (!Number.isFinite(price) || price < 0) return fail("The price has to be a number.");
  if (!Number.isInteger(registers) || registers < 1) {
    return fail("A shop has at least one counter.");
  }
  if (!Number.isInteger(branches) || branches < 1) {
    return fail("A shop has at least one branch.");
  }
  if (!Number.isInteger(grace) || grace < 0 || grace > GRACE_DAYS_MAX) {
    return fail(`Grace is between 0 and ${GRACE_DAYS_MAX} days.`);
  }

  const supabase = createAdminClient();

  const { data: before } = await supabase
    .from("subscriptions")
    .select(
      "plan_id, billing_cycle, agreed_price, max_branches, max_registers, grace_days",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!before) return fail("That shop has no subscription to edit.");

  const row = {
    plan_id: planId,
    billing_cycle: cycle,
    agreed_price: price,
    max_branches: branches,
    max_registers: registers,
    grace_days: grace,
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
 * Correct the renewal date, and nothing else.
 *
 * Its own action because the period has three legitimate writers and they mean
 * three different things: `record_subscription_payment` moves it because money
 * arrived, `extendPeriod` moves it as goodwill, and this one moves it because
 * the date on file is simply wrong — somebody paid on the 3rd for a month that
 * should have started on the 1st, and no number of "+1 month" buttons says
 * that. Keeping it out of the plan form is what stops a stale form from
 * quietly undoing the other two.
 */
export async function setPeriodEnd(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireWrite(["clients"]);
  if (!gate.ok) return fail(gate.error);

  const tenantId = text(formData.get("tenant_id"));
  const periodEnd = text(formData.get("current_period_end"));

  if (!tenantId) return fail("That shop is not on the list any more.");
  if (!periodEnd) return fail("Pick the date the period should run to.");

  // End of the chosen day, so "runs to the 30th" includes the 30th.
  const end = new Date(`${periodEnd}T23:59:59`);
  if (Number.isNaN(end.getTime())) return fail("That renewal date is not a date.");

  const supabase = createAdminClient();

  const { data: before } = await supabase
    .from("subscriptions")
    .select("current_period_start, current_period_end")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!before) return fail("That shop has no subscription.");

  // `subscriptions_period_ordered` refuses an end on or before the start, and a
  // constraint violation is a sentence nobody can act on — so the refusal is
  // written here, where it can name the date the operator just typed.
  if (new Date(before.current_period_start as string) >= end) {
    return fail("The period has to end after it starts. Pick a later date.");
  }

  const { error } = await supabase
    .from("subscriptions")
    .update({ current_period_end: end.toISOString() })
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("[admin] period correction failed for %s: %s", tenantId, writeReadError(error));
    return fail("That date did not save. Please try again.");
  }

  await recordAudit(gate.session, {
    action: "subscription.period_corrected",
    tenantId,
    subjectType: "subscription",
    subjectId: tenantId,
    before,
    after: { current_period_end: end.toISOString() },
  });

  revalidateClient(tenantId);

  return done("Renewal date corrected", "No payment was recorded against it.");
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
  const gate = await requireWrite(["clients"]);
  if (!gate.ok) return fail(gate.error);

  const tenantId = text(formData.get("tenant_id"));
  const status = text(formData.get("status"));

  if (!tenantId) return fail("That shop is not on the list any more.");
  if (!isStatus(status)) return fail("That is not a standing we have.");
  if (status === "paused") return fail("Pause it with the Pause button — that keeps its days.");

  const supabase = createAdminClient();

  const { data: before } = await supabase
    .from("subscriptions")
    .select("status, current_period_end, grace_days")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!before) return fail("That shop has no subscription.");

  // Leaving a pause any way but Resume would lose the days it was holding —
  // the whole point of pausing rather than suspending. Cancelling is the one
  // exit that has no days to keep.
  if (before.status === "paused" && status !== "cancelled") {
    return fail("This shop is paused. Resume it, which puts its days back, before changing it.");
  }

  // A trading standing on a period whose grace has run out would be undone by
  // the next sweep within the hour, and the till would never have opened —
  // `getEntitlements` reads the date too. Say so now, with the way through.
  if (status === "trialing" || status === "active" || status === "past_due") {
    const { status: effective, graceEndsAt } = lapseOf(
      status,
      before.current_period_end as string,
      Number(before.grace_days),
    );

    if (effective === "suspended") {
      return fail(
        `Its period and grace ran out on ${writeDay(graceEndsAt)}. Record a payment, or give days first, then put it back in business.`,
      );
    }
  }

  const now = new Date().toISOString();

  const { error } = await supabase
    .from("subscriptions")
    .update({
      status,
      suspended_at: status === "suspended" ? now : null,
      cancelled_at: status === "cancelled" ? now : null,
      paused_at: null,
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
  paused: "Paused — the clock is stopped",
  suspended: "Suspended — the till will not charge",
  cancelled: "Cancelled",
};

/**
 * Shut for a while, with the clock stopped — and back again with every day it
 * was shut put back on the end of the period.
 *
 * Its own action and its own function (`public.pause_subscription`) rather than
 * a status on the buttons above, because resuming has arithmetic in it: the
 * period moves out by exactly the time spent paused, worked out under the row
 * lock so a payment recorded from another tab cannot land in between.
 */
export async function pauseClient(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireWrite(["clients"]);
  if (!gate.ok) return fail(gate.error);

  const tenantId = text(formData.get("tenant_id"));
  const pause = text(formData.get("pause")) === "1";

  if (!tenantId) return fail("That shop is not on the list any more.");

  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("pause_subscription", {
    p_tenant: tenantId,
    p_pause: pause,
  });

  if (error || !data) {
    console.error("[admin] pause failed for %s: %s", tenantId, writeReadError(error));
    return fail(
      pause
        ? "Only a shop that is trading can be paused."
        : "That shop is not paused any more. Reload the record.",
    );
  }

  const result = data as { status: SubscriptionStatus; current_period_end: string };

  await recordAudit(gate.session, {
    action: pause ? "subscription.paused" : "subscription.resumed",
    tenantId,
    subjectType: "subscription",
    subjectId: tenantId,
    after: result,
  });

  revalidateClient(tenantId);

  return pause
    ? done("Paused — the clock is stopped", "The till will not charge until you resume.")
    : done("Resumed", `Paid up to ${writeDay(result.current_period_end)} now.`);
}

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
  const gate = await requireWrite(["clients"]);
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

/* There is no `setFeatureOverride` any more. `0040` dropped
 * `subscriptions.feature_overrides` and the "One-off deals" card that wrote it:
 * nothing in the product has ever called `hasFeature`, so the buttons flipped a
 * column no screen reads and the card carried a warning saying so. A control
 * that ships with a note explaining that it does nothing is how an operator
 * promises a feature on a call that the shop never gets. The one entitlement
 * that bites is `subscriptions.max_registers`, written by the plan form above. */

/* -------------------------------------------------------------------------- */
/* Notes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Free text, timestamped: who introduced you, what they haggled to, which
 * printer they bought.
 *
 * Anybody given Clients may write one — a member who cannot leave a note is a
 * member who keeps the context in their own head.
 */
export async function addNote(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireWrite(["clients"]);
  if (!gate.ok) return fail(gate.error);
  const { session } = gate;

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
  const gate = await requireWrite(["clients"]);
  if (!gate.ok) return fail(gate.error);
  const { session } = gate;

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
