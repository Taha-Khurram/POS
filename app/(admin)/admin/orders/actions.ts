"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { requireBilling } from "@/lib/platform/access";
import { createAdminClient } from "@/utils/supabase/admin";
import { IDLE, type AdminState } from "../state";
import { createClientRecord } from "../clients/activate";

/**
 * The self-serve queue.
 *
 * An order is a *claim* of payment, not a payment. Somebody filled in
 * `/checkout` at two in the morning, got a reference, and sent a screenshot of
 * a transfer. Nothing happens until an operator matches it against the bank
 * statement and records the payment against the order in Payments — and only
 * then can the order be accepted.
 *
 * Accepting makes a client and nothing more. The plan is started from the
 * client's own record, which is where the operator decides what the shop is
 * actually on; the buyer's choice fills that form in rather than deciding it.
 */

const fail = (error: string): AdminState => ({ ...IDLE, error });

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

/**
 * The order becomes a client.
 *
 * No claim column and no ten-minute window any more: `public.create_client`
 * takes the order's row lock inside its own transaction, so two operators
 * pressing Accept on a Monday morning get one client and one refusal — the
 * second reads the order as already dealt with. The same function refuses an
 * order with no payment recorded against it, so the button the sheet greys out
 * is not the only thing standing between a screenshot and a shop.
 */
export async function acceptOrder(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireBilling();
  if (!gate.ok) return fail(gate.error);

  const orderId = text(formData.get("order_id"));
  if (!orderId) return fail("That order is not in the queue any more.");

  const supabase = createAdminClient();

  const { data: order } = await supabase
    .from("orders")
    .select("reference, shop_name, owner_name, phone, email, city")
    .eq("id", orderId)
    .maybeSingle();

  if (!order) return fail("That order is not in the queue any more.");

  const result = await createClientRecord(
    {
      shopName: String(order.shop_name),
      ownerName: String(order.owner_name),
      phone: String(order.phone),
      email: String(order.email ?? ""),
      city: String(order.city),
      notes: `Self-serve order ${order.reference}.`,
    },
    orderId,
    gate.session,
  );

  if ("error" in result) return fail(result.error);

  revalidatePath("/admin/orders");

  return {
    ...IDLE,
    savedAt: Date.now(),
    saved: {
      label: `${order.shop_name} is a client`,
      detail: "Open their record to activate the plan.",
    },
    tenantId: result.tenantId,
  };
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
    return fail("That order is already a client. Suspend or cancel the shop instead.");
  }

  // Money on file says it did arrive. Rejecting over it would tell the buyer
  // we could not find a transfer the ledger says we took.
  const { count } = await supabase
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId);

  if (count) {
    return fail("A payment is recorded against this order. Remove it in Payments first if it was a mistake.");
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
