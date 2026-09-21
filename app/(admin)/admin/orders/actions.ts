"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { requireBilling } from "@/lib/platform/access";
import { createAdminClient } from "@/utils/supabase/admin";
import { IDLE, type AdminState } from "../state";
import { activateShop } from "../clients/activate";

/**
 * The self-serve queue.
 *
 * An order is a *claim* of payment, not a payment. Somebody filled in
 * `/checkout` at two in the morning, got a reference, and sent a screenshot of
 * a transfer. Nothing happens until an operator matches it against the bank
 * statement and presses Verify — and Verify is not its own activation path: it
 * calls the same `activateShop` the direct form does, so there is one function
 * that can bring a tenant into existence and one thing to audit.
 */

const fail = (error: string): AdminState => ({ ...IDLE, error });

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

/** How long a verification claim is honoured before another operator may take
 *  the order. Long enough to finish, short enough that a crashed tab does not
 *  strand the row — `0005` added the column for exactly this. */
const CLAIM_MINUTES = 10;

export async function verifyOrder(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireBilling();
  if (!gate.ok) return fail(gate.error);

  const orderId = text(formData.get("order_id"));
  if (!orderId) return fail("That order is not in the queue any more.");

  const supabase = createAdminClient();

  /**
   * Claim it before doing anything else.
   *
   * Two operators working the queue on a Monday morning is not a hypothetical,
   * and the thing that must not happen is one order becoming two tenants — two
   * shops, two subscriptions, two invite links, one payment. The conditional
   * update is the lock: whoever's `update` matches the row first gets it, and
   * the second one comes back empty and is told so.
   */
  const stale = new Date(Date.now() - CLAIM_MINUTES * 60_000).toISOString();

  const { data: claimed } = await supabase
    .from("orders")
    .update({ verification_started_at: new Date().toISOString() })
    .eq("id", orderId)
    .in("status", ["awaiting_payment", "proof_submitted"])
    .or(`verification_started_at.is.null,verification_started_at.lt.${stale}`)
    .select(
      "id, reference, shop_name, owner_name, phone, email, city, plan_id, billing_cycle, branches, registers, quoted_price",
    )
    .maybeSingle();

  if (!claimed) {
    return fail(
      "That order has already been dealt with, or somebody else is verifying it right now. Reload the queue.",
    );
  }

  // What the operator agreed, falling back to what the buyer chose. The price
  // is editable here for the same reason it is on the activation form: the
  // figure that lands in the bank is not always the figure on the page.
  const planId = text(formData.get("plan_id")) || String(claimed.plan_id ?? "");
  const price = text(formData.get("agreed_price")) || String(claimed.quoted_price);

  if (!planId) {
    await release(orderId);
    return fail("That order names no plan. Pick one before verifying it.");
  }

  const payload = new FormData();
  payload.set("shop_name", String(claimed.shop_name));
  payload.set("owner_name", String(claimed.owner_name));
  payload.set("phone", String(claimed.phone));
  payload.set("email", String(claimed.email ?? ""));
  payload.set("city", String(claimed.city));
  payload.set("plan_id", planId);
  payload.set("billing_cycle", String(claimed.billing_cycle));
  payload.set("agreed_price", price);
  payload.set("branches", String(claimed.branches));
  payload.set("registers", String(claimed.registers));
  // A self-serve order arrives paid. Giving it a trial on top would be a month
  // of free access on money already banked.
  payload.set("trial_days", "0");
  payload.set("notes", `Self-serve order ${claimed.reference}.`);

  const result = await activateShop(payload, orderId, gate.session);

  if (result.error) {
    // The activation is one transaction, so nothing was created — but the claim
    // is a separate write and has to be handed back, or the order is stuck for
    // ten minutes for everybody including the person looking at it.
    await release(orderId);
    return result;
  }

  await recordAudit(gate.session, {
    action: "order.verified",
    tenantId: result.tenantId,
    subjectType: "order",
    subjectId: orderId,
    after: { reference: claimed.reference, plan_id: planId, agreed_price: price },
  });

  revalidatePath("/admin/orders");

  return result;
}

async function release(orderId: string) {
  const supabase = createAdminClient();
  await supabase
    .from("orders")
    .update({ verification_started_at: null })
    .eq("id", orderId);
}

/**
 * No payment ever arrived, or the screenshot was for something else.
 *
 * The reason is required and it is shown on the public `/order/[ref]` page. A
 * buyer whose order simply goes quiet rings up; one who is told "we could not
 * find this transfer — check the reference" sends the right screenshot.
 */
export async function rejectOrder(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireBilling();
  if (!gate.ok) return fail(gate.error);

  const orderId = text(formData.get("order_id"));
  const reason = text(formData.get("reason"));

  if (!orderId) return fail("That order is not in the queue any more.");
  if (!reason) return fail("Say why. They will read this on the order page.");
  if (reason.length > 300) return fail("That reason is too long.");

  const supabase = createAdminClient();

  const { data: before } = await supabase
    .from("orders")
    .select("status, reference")
    .eq("id", orderId)
    .maybeSingle();

  if (!before) return fail("That order is not in the queue any more.");
  if (before.status === "verified") {
    return fail("That order is already a working shop. Suspend the shop instead.");
  }

  const { error } = await supabase
    .from("orders")
    .update({
      status: "rejected",
      rejection_reason: reason,
      verification_started_at: null,
    })
    .eq("id", orderId);

  if (error) {
    console.error("[admin] order reject failed for %s", orderId, error);
    return fail("That order did not update. Please try again.");
  }

  await recordAudit(gate.session, {
    action: "order.rejected",
    subjectType: "order",
    subjectId: orderId,
    before,
    after: { status: "rejected", rejection_reason: reason },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/orders");

  return {
    ...IDLE,
    savedAt: Date.now(),
    saved: { label: `${before.reference} rejected`, detail: "They can see the reason." },
  };
}
