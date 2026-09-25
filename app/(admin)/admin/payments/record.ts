import "server-only";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import type { PlatformSession } from "@/lib/platform/access";
import { createAdminClient } from "@/utils/supabase/admin";
import { IDLE, type AdminState } from "../state";

/**
 * Not in `actions.ts`, for the reason `clients/activate.ts` is not: this takes
 * its actor as an argument, and every export of a `"use server"` module is an
 * endpoint anybody can call with whatever session they like. Two callers each
 * do their own `requireWrite()` first — Record payment on Payments, and Verify
 * & activate on the order queue, which records the money as its first step.
 */

const fail = (error: string): AdminState => ({ ...IDLE, error });

function revalidatePayments(tenantId: string | null) {
  revalidatePath("/admin");
  revalidatePath("/admin/clients");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/payments");
  if (tenantId) revalidatePath(`/admin/clients/${tenantId}`);
}

/**
 * Money that arrived before there was a period for it to buy.
 *
 * A plain insert on the service role rather than a function: there is no row to
 * lock and no period to move. An order has to still be waiting — money
 * recorded against one already accepted belongs to the client it became.
 */
export async function recordUnallocated(
  session: PlatformSession,
  entry: {
    tenantId: string | null;
    orderId: string | null;
    amount: number;
    method: string;
    reference: string;
    paidAt: Date;
    notes: string;
  },
): Promise<AdminState> {
  const supabase = createAdminClient();

  if (entry.orderId) {
    const { data: order } = await supabase
      .from("orders")
      .select("status, reference")
      .eq("id", entry.orderId)
      .maybeSingle();

    if (!order) return fail("That order is not in the queue any more.");
    if (order.status !== "awaiting_payment" && order.status !== "proof_submitted") {
      return fail(
        "That order has already been dealt with. Record the payment against the client it became.",
      );
    }
  }

  const { data, error } = await supabase
    .from("payments")
    .insert({
      tenant_id: entry.tenantId,
      order_id: entry.orderId,
      amount: entry.amount,
      method: entry.method,
      reference: entry.reference || null,
      paid_at: entry.paidAt.toISOString(),
      recorded_by: session.userId,
      notes: entry.notes || null,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[admin] payment failed", error);
    return fail("That payment did not record. Nothing was changed — try again.");
  }

  await recordAudit(session, {
    action: "payment.recorded",
    tenantId: entry.tenantId,
    subjectType: "payment",
    subjectId: data.id,
    after: {
      amount: entry.amount,
      method: entry.method,
      reference: entry.reference,
      order_id: entry.orderId,
      paid_at: entry.paidAt.toISOString(),
    },
  });

  revalidatePayments(entry.tenantId);

  return {
    ...IDLE,
    savedAt: Date.now(),
    saved: {
      label: `Rs ${entry.amount.toLocaleString("en-PK")} recorded`,
      detail: entry.orderId
        ? "Verify and activate it on Orders."
        : "It goes against their first period when they are activated.",
    },
  };
}
