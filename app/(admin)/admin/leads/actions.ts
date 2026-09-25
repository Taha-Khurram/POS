"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { isLeadStatus, leadStatusOf } from "@/lib/platform/admin";
import { requireWrite } from "@/lib/platform/access";
import { createAdminClient } from "@/utils/supabase/admin";
import { IDLE, type AdminState } from "../state";

/**
 * The demo form's submissions, worked.
 *
 * Deliberately open to a support account — this is the one screen in the
 * console that is not billing, and the person answering WhatsApp at 9 pm is the
 * person who knows whether the shop in Sargodha is still interested. Nothing
 * here can create a tenant or move a rupee.
 */

const fail = (error: string): AdminState => ({ ...IDLE, error });

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

export async function updateLead(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireWrite(["leads"]);
  if (!gate.ok) return fail(gate.error);
  const { session } = gate;

  const leadId = text(formData.get("lead_id"));
  const status = text(formData.get("status"));
  const notes =
    typeof formData.get("notes") === "string"
      ? String(formData.get("notes")).trim()
      : "";

  if (!leadId) return fail("That lead is not on the list any more.");
  if (!isLeadStatus(status)) return fail("That is not a state we have for a lead.");
  if (notes.length > 2000) return fail("That note is too long.");

  const supabase = createAdminClient();

  const { data: before } = await supabase
    .from("leads")
    .select("contact_name, status, notes")
    .eq("id", leadId)
    .maybeSingle();

  if (!before) return fail("That lead is not on the list any more.");

  const { error } = await supabase
    .from("leads")
    .update({
      status,
      notes: notes || null,
      // Whoever moved it last is who to ask about it. Set every time rather
      // than only on the first touch: the question is always "who spoke to
      // them", not "who opened the row".
      handled_by: session.userId,
    })
    .eq("id", leadId);

  if (error) {
    console.error("[admin] lead update failed for %s", leadId, error);
    return fail("That lead did not save. Please try again.");
  }

  await recordAudit(session, {
    action: "lead.updated",
    subjectType: "lead",
    subjectId: leadId,
    before,
    after: { status, notes },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/leads");

  return {
    ...IDLE,
    savedAt: Date.now(),
    saved: {
      label: `${before.contact_name} → ${leadStatusOf(status).label}`,
    },
  };
}
