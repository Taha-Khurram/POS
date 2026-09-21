"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { isMethod } from "@/lib/platform/admin";
import { requireBilling } from "@/lib/platform/access";
import { createAdminClient } from "@/utils/supabase/admin";
import { IDLE, type AdminState } from "../state";

/**
 * Money in, and the period it bought.
 *
 * The write is `public.record_subscription_payment` (`0036`) — one transaction
 * under a row lock, because the rupees and the days they paid for have to land
 * together or the shop is either suspended with the money in the account or
 * trading for a month on a payment nobody wrote down. Two operators recording
 * the same renewal from two tabs would otherwise both extend from the same end
 * date, and the shop would be paid up for one month having paid for two.
 */

const fail = (error: string): AdminState => ({ ...IDLE, error });

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

function revalidatePayments(tenantId: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/clients");
  revalidatePath("/admin/payments");
  revalidatePath(`/admin/clients/${tenantId}`);
}

export async function recordPayment(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireBilling();
  if (!gate.ok) return fail(gate.error);

  const tenantId = text(formData.get("tenant_id"));
  const amount = Number(text(formData.get("amount")));
  const method = text(formData.get("method"));
  const reference = text(formData.get("reference"));
  const paidOn = text(formData.get("paid_on"));
  // Zero buys no time: a part payment, recorded so the ledger is straight,
  // with the period left exactly where it was.
  const cycles = Number(text(formData.get("cycles")) || "1");

  if (!tenantId) return fail("Pick which shop paid.");
  if (!Number.isFinite(amount) || amount <= 0) {
    return fail("How much came in? It has to be more than nothing.");
  }
  if (!isMethod(method)) return fail("How did it arrive — bank, Easypaisa, cash?");
  if (!Number.isInteger(cycles) || cycles < 0 || cycles > 24) {
    return fail("That is not a number of cycles this will take.");
  }

  const paidAt = paidOn ? new Date(`${paidOn}T12:00:00`) : new Date();
  if (Number.isNaN(paidAt.getTime())) return fail("That payment date is not a date.");

  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("record_subscription_payment", {
    p_tenant: tenantId,
    p_amount: amount,
    p_method: method,
    p_reference: reference,
    p_paid_at: paidAt.toISOString(),
    p_cycles: cycles,
    p_notes: text(formData.get("notes")),
    p_actor: gate.session.userId,
  });

  if (error || !data) {
    console.error("[admin] payment failed for %s", tenantId, error);
    return fail("That payment did not record. Nothing was changed — try again.");
  }

  const result = data as { payment_id: string; current_period_end: string };

  await recordAudit(gate.session, {
    action: "payment.recorded",
    tenantId,
    subjectType: "payment",
    subjectId: result.payment_id,
    after: {
      amount,
      method,
      reference,
      cycles,
      paid_at: paidAt.toISOString(),
      current_period_end: result.current_period_end,
    },
  });

  revalidatePayments(tenantId);

  return {
    ...IDLE,
    savedAt: Date.now(),
    saved: {
      label: `Rs ${amount.toLocaleString("en-PK")} recorded`,
      detail:
        cycles > 0
          ? `Paid up to ${new Date(result.current_period_end).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" })}.`
          : "The period was left where it was.",
    },
  };
}

/**
 * A real delete, and the period is deliberately left alone.
 *
 * The commonest reason to remove a payment is a typo two minutes old — the same
 * call `0029` made about a supplier payment, and for the same reason: this is
 * our own note about our own account, not a receipt somebody is holding. What
 * it does not do is wind the renewal date back, because a payment recorded for
 * the wrong amount was still a real month of access, and guessing which days to
 * take away is how a shop gets shut off mid-afternoon. Fix the date on the
 * plan card if it needs fixing; `audit_log` keeps both acts either way.
 */
export async function deletePayment(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireBilling();
  if (!gate.ok) return fail(gate.error);

  const paymentId = text(formData.get("payment_id"));
  if (!paymentId) return fail("That payment is already gone.");

  const supabase = createAdminClient();

  const { data: before } = await supabase
    .from("payments")
    .select("tenant_id, amount, method, reference, paid_at, notes")
    .eq("id", paymentId)
    .maybeSingle();

  if (!before) return fail("That payment is already gone.");

  const { error } = await supabase.from("payments").delete().eq("id", paymentId);

  if (error) {
    console.error("[admin] payment delete failed for %s", paymentId, error);
    return fail("That payment did not come off. Please try again.");
  }

  await recordAudit(gate.session, {
    action: "payment.removed",
    tenantId: before.tenant_id as string,
    subjectType: "payment",
    subjectId: paymentId,
    before,
  });

  revalidatePayments(before.tenant_id as string);

  return {
    ...IDLE,
    savedAt: Date.now(),
    saved: {
      label: "Payment removed",
      detail: "The renewal date was left where it was.",
    },
  };
}
