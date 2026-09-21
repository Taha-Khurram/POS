"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { requireSession, type SessionContext } from "@/lib/auth";
import { getModuleAccess } from "@/lib/pos/access";
import { checkPayment, isPaymentMethod } from "@/lib/pos/ledger";
import { createAdminClient } from "@/utils/supabase/admin";
import { IDLE, type SupplierState } from "./state";

/**
 * Paying a supplier.
 *
 * A plain insert on the service role rather than a security-definer function,
 * unlike `record_receipt` — and the difference is worth being explicit about. A
 * delivery is a header, its lines, a stock movement and a cost change that have
 * to be true together or not at all. A payment is one row. There is no
 * transaction to protect and no number to claim, so a function would be
 * ceremony around a single statement.
 *
 * **It is against the account, not against a delivery.** There is no allocation
 * table, deliberately: Ravi Trading's man takes fifty thousand on a Thursday
 * and nobody itemises it against invoice 4821. The ageing on the supplier's
 * record is a walk over the deliveries oldest-first, derived rather than
 * stored, so nothing here has to be reconciled later.
 *
 * Gated by `can_manage_purchasing`, the same switch as the rest of Buying. This
 * is the action that moves what the shop believes it owes, and it is audited
 * with the amount by name for exactly that reason.
 */

const fail = (error: string): SupplierState => ({ ...IDLE, error });

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

async function requirePurchasing() {
  const session = await requireSession();

  if (!session.tenantId) {
    return { ok: false as const, error: "This login is not linked to a shop yet." };
  }

  const access = await getModuleAccess(session);

  if (!access.purchasing) {
    return {
      ok: false as const,
      error: "You are not allowed to record payments. Ask the owner.",
    };
  }

  return {
    ok: true as const,
    session: { ...session, tenantId: session.tenantId } as SessionContext & {
      tenantId: string;
    },
  };
}

export async function savePayment(
  _previous: SupplierState,
  formData: FormData,
): Promise<SupplierState> {
  const gate = await requirePurchasing();
  if (!gate.ok) return fail(gate.error);
  const { session } = gate;

  const amount = Number(text(formData.get("amount")).replace(/,/g, ""));
  const method = text(formData.get("method"));

  const draft = {
    supplierId: text(formData.get("supplier_id")),
    paidOn: text(formData.get("paid_on")),
    amount: Number.isFinite(amount) ? Math.round(amount * 100) / 100 : NaN,
    method,
    reference: text(formData.get("reference")),
    // Not collapsed: a note is the one field somebody writes two lines in.
    note:
      typeof formData.get("note") === "string"
        ? String(formData.get("note")).trim()
        : "",
  };

  // The same function the sheet greys its save button out with, so the refusal
  // read here is the sentence the form was already showing.
  const complaint = checkPayment(draft);
  if (complaint) return fail(complaint);
  if (!isPaymentMethod(draft.method)) return fail("Say how you paid.");

  const supabase = createAdminClient();

  // The supplier id comes off a form, so it is checked against the shop's own
  // rows before anything is written — a crafted id must not be able to plant a
  // payment on another shop's account. The foreign key would refuse it anyway;
  // this is what turns that into a sentence.
  const { data: supplier } = await supabase
    .from("suppliers")
    .select("id, name")
    .eq("tenant_id", session.tenantId)
    .eq("id", draft.supplierId)
    .maybeSingle();

  if (!supplier) {
    return fail("That supplier is not on your list any more. Reload and try again.");
  }

  const row = {
    tenant_id: session.tenantId,
    supplier_id: supplier.id,
    paid_on: draft.paidOn,
    amount: draft.amount,
    method: draft.method,
    reference: draft.reference || null,
    note: draft.note || null,
    created_by: session.userId,
  };

  const { data: created, error } = await supabase
    .from("supplier_payments")
    .insert(row)
    .select("id")
    .single();

  if (error || !created) {
    console.error("[purchasing] payment insert failed", error);
    return fail("We could not record that payment. Please try again.");
  }

  await recordAudit(session, {
    action: "supplier_payment.recorded",
    subjectType: "supplier_payment",
    subjectId: created.id,
    // Audited by name, like a discount at the till and a landed cost on a
    // delivery: it is money leaving, and "who paid Ravi Trading eighty thousand
    // on the 3rd" has to be answerable.
    after: {
      supplier_id: supplier.id,
      supplier_name: supplier.name,
      paid_on: draft.paidOn,
      amount: draft.amount,
      method: draft.method,
      reference: draft.reference || null,
    },
  });

  revalidatePath("/app/purchasing");

  return {
    error: null,
    savedAt: Date.now(),
    saved: { id: created.id, name: supplier.name as string, action: "added" },
  };
}

/**
 * Taking a payment back off the account.
 *
 * A real delete rather than a reversing entry, and that is a deliberate
 * exception to how `0024` treats a refunded sale. A sale is a thing that
 * happened to a customer who has a receipt in their hand; a payment row is the
 * shop's own note to itself about its own account, and the commonest reason to
 * remove one is that somebody typed 5,000 as 50,000 two minutes ago. Making
 * them live with a pair of entries for a typo would be ceremony, and the audit
 * log keeps the row either way.
 */
export async function deletePayment(
  _previous: SupplierState,
  formData: FormData,
): Promise<SupplierState> {
  const gate = await requirePurchasing();
  if (!gate.ok) return fail(gate.error);
  const { session } = gate;

  const paymentId = text(formData.get("payment_id"));
  const supabase = createAdminClient();

  const { data: payment } = await supabase
    .from("supplier_payments")
    .select("id, supplier_id, paid_on, amount, method, reference")
    .eq("tenant_id", session.tenantId)
    .eq("id", paymentId)
    .maybeSingle();

  if (!payment) {
    return fail("That payment is not on your account any more. Reload and try again.");
  }

  const { error } = await supabase
    .from("supplier_payments")
    .delete()
    .eq("id", payment.id)
    .eq("tenant_id", session.tenantId);

  if (error) {
    console.error("[purchasing] payment delete failed for %s", payment.id, error);
    return fail("We could not remove that payment. Please try again.");
  }

  await recordAudit(session, {
    action: "supplier_payment.deleted",
    subjectType: "supplier_payment",
    subjectId: payment.id,
    before: payment,
  });

  revalidatePath("/app/purchasing");

  return {
    error: null,
    savedAt: Date.now(),
    saved: { id: payment.id, name: "Payment", action: "deleted" },
  };
}
