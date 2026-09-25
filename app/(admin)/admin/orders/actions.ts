"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { isMethod } from "@/lib/platform/admin";
import { requireWrite } from "@/lib/platform/access";
import { createAdminClient } from "@/utils/supabase/admin";
import { IDLE, type AdminState } from "../state";
import { createClientRecord, issueOwnerLogin, startPlan } from "../clients/activate";
import { recordUnallocated } from "../payments/record";

/**
 * The self-serve queue.
 *
 * An order is a *claim* of payment, not a payment. Somebody filled in
 * `/checkout` at two in the morning and sent a screenshot of a transfer.
 * Nothing happens until an operator matches it against the bank statement —
 * and then one press does the rest.
 */

const fail = (error: string): AdminState => ({ ...IDLE, error });

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

/**
 * Verify & activate: the money is there, so the shop is live.
 *
 * It used to be four screens — record the payment in Payments, come back and
 * Accept, open the client, Activate — every one of them retyping what the order
 * already said. They are still four steps, in the same order, through the same
 * bodies every other path uses:
 *
 * 1. `recordUnallocated` — the payment against the order, unless one is
 *    already recorded (somebody used Payments, or a press half-finished).
 * 2. `createClientRecord` — `public.create_client` locks the order, so two
 *    operators pressing at once get one shop and one refusal.
 * 3. `startPlan` — the plan, cycle, counters and price the buyer ordered.
 *    A haggled price is changed on the client's record afterwards.
 * 4. `issueOwnerLogin` — the operator leaves holding the WhatsApp message.
 *
 * Not one transaction, deliberately: every point it can stop at is a state the
 * console already draws — money on an order, a client "Not activated", a plan
 * with no login — and pressing again (or the client record) picks it up from
 * there. Gated on Orders alone: ticking Orders for a team member means working
 * this queue end to end, which it could not be if the last three steps needed
 * a second screen.
 */
export async function verifyOrder(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireWrite(["orders"]);
  if (!gate.ok) return fail(gate.error);

  const orderId = text(formData.get("order_id"));
  if (!orderId) return fail("That order is not in the queue any more.");

  const supabase = createAdminClient();

  const [{ data: order }, { data: payments }] = await Promise.all([
    supabase
      .from("orders")
      .select("reference, status, shop_name, owner_name, phone, email, city, plan_id, billing_cycle, branches, registers, quoted_price")
      .eq("id", orderId)
      .maybeSingle(),
    supabase.from("payments").select("amount").eq("order_id", orderId),
  ]);

  if (!order) return fail("That order is not in the queue any more.");
  if (order.status !== "awaiting_payment" && order.status !== "proof_submitted") {
    return fail("That order has already been dealt with. Reload the queue.");
  }

  // 1 · The money, unless it is already on file.
  const recorded = (payments ?? []).reduce((sum, row) => sum + Number(row.amount), 0);
  if (recorded <= 0) {
    const amount = Number(text(formData.get("amount")));
    const method = text(formData.get("method"));

    if (!Number.isFinite(amount) || amount <= 0) {
      return fail("How much came in? It has to be more than nothing.");
    }
    if (!isMethod(method)) return fail("How did it arrive — bank, Easypaisa, JazzCash?");

    const paid = await recordUnallocated(gate.session, {
      tenantId: null,
      orderId,
      amount,
      method,
      reference: text(formData.get("reference")),
      paidAt: new Date(),
      notes: "",
    });
    if (paid.error) return fail(paid.error);
  }

  // 2 · The client.
  const shopName = String(order.shop_name);
  const client = await createClientRecord(
    {
      shopName,
      ownerName: String(order.owner_name),
      phone: String(order.phone),
      email: String(order.email ?? ""),
      city: String(order.city),
      notes: `Self-serve order ${order.reference}.`,
    },
    orderId,
    gate.session,
  );

  if ("error" in client) {
    return fail(recorded > 0 ? client.error : `The payment is recorded, but ${lower(client.error)}`);
  }

  // 3 · The plan the buyer ordered.
  const terms = new FormData();
  terms.set("plan_id", String(order.plan_id ?? ""));
  terms.set("billing_cycle", String(order.billing_cycle));
  terms.set("agreed_price", String(Number(order.quoted_price)));
  terms.set("branches", String(order.branches ?? 1));
  terms.set("registers", String(order.registers ?? 1));

  const plan = await startPlan(client.tenantId, terms, gate.session);
  if ("error" in plan) {
    return {
      ...fail(`${shopName} is a client, but ${lower(plan.error)} Finish it from their record.`),
      tenantId: client.tenantId,
    };
  }

  // 4 · The login, and the message it goes out in.
  const login = await issueOwnerLogin(client.tenantId, gate.session);
  return { ...login, tenantId: client.tenantId };
}

const lower = (sentence: string) => sentence.charAt(0).toLowerCase() + sentence.slice(1);

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
  const gate = await requireWrite(["orders"]);
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
