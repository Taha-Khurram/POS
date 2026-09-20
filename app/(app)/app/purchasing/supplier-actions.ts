"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { requireSession, type SessionContext } from "@/lib/auth";
import { getModuleAccess } from "@/lib/pos/access";
import { normalisePhone } from "@/lib/pos/customer";
import { checkSupplier, TERMS_MAX_DAYS } from "@/lib/pos/supplier";
import { createAdminClient } from "@/utils/supabase/admin";
import { IDLE, type SupplierState } from "./state";

/**
 * Adding, correcting and removing a supplier.
 *
 * Every write goes through the service role, because `0027` revoked
 * insert/update/delete on `suppliers` from `authenticated` outright — rule 3
 * from `0001_init.sql`, so that there is one auditable write path rather than a
 * policy surface to get wrong. That makes the checks below the whole of access
 * control: the tenant comes off the signed token's claim and never from the
 * form, and the `.eq("tenant_id", …)` on every statement is what stops a
 * crafted id from editing somebody else's distributor.
 *
 * Who may write is `can_manage_purchasing`, the same switch that draws the
 * module in the rail. Deliberately not `can_edit_items`: what gets entered here
 * is what the shop paid, and a cost price is the number every margin on Reports
 * is worked out from.
 */

const fail = (error: string): SupplierState => ({ ...IDLE, error });

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

/** Owner, or somebody the owner switched `can_manage_purchasing` on for. */
async function requirePurchasing() {
  const session = await requireSession();

  if (!session.tenantId) {
    return { ok: false as const, error: "This login is not linked to a shop yet." };
  }

  const access = await getModuleAccess(session);

  if (!access.purchasing) {
    return {
      ok: false as const,
      error: "You are not allowed to change the buying list. Ask the owner.",
    };
  }

  return {
    ok: true as const,
    session: { ...session, tenantId: session.tenantId } as SessionContext & {
      tenantId: string;
    },
  };
}

/** The row as `public.suppliers` wants it. */
type SupplierRow = {
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  tax_number: string | null;
  payment_terms_days: number;
  notes: string | null;
  is_active: boolean;
};

/**
 * The row, or the sentence to put under the form.
 *
 * The complaint itself is `checkSupplier` in `lib/pos/supplier.ts`, which the
 * sheet also calls — so the refusal read here is the same string the form was
 * already showing, from the same place. What this adds is the turn into
 * columns, and the normalisation of the phone before it is stored.
 */
function readSupplier(formData: FormData): SupplierRow | string {
  const terms = Number(text(formData.get("payment_terms_days")));

  const draft = {
    name: text(formData.get("name")),
    contactName: text(formData.get("contact_name")),
    phone: text(formData.get("phone")),
    email: text(formData.get("email")),
    address: text(formData.get("address")),
    taxNumber: text(formData.get("tax_number")),
    // A blank or mangled box is cash on delivery, which is the default and the
    // commonest answer — not a refusal. The bound is still checked below by
    // `checkSupplier`, because a crafted body can carry any number at all.
    paymentTermsDays:
      Number.isFinite(terms) && terms >= 0 && terms <= TERMS_MAX_DAYS
        ? Math.trunc(terms)
        : 0,
    // Not collapsed like the rest: a note is the one field somebody writes two
    // lines in, and flattening it would join them mid-sentence.
    notes:
      typeof formData.get("notes") === "string"
        ? String(formData.get("notes")).trim()
        : "",
  };

  const complaint = checkSupplier(draft);
  if (complaint) return complaint;

  return {
    name: draft.name,
    contact_name: draft.contactName || null,
    // Normalised here and not only in the browser, for the reason the customer
    // action normalises: a request that skipped the form would otherwise store
    // "+92 300 1234567" beside "03001234567" for the same office.
    phone: normalisePhone(draft.phone) || null,
    email: draft.email.toLowerCase() || null,
    address: draft.address || null,
    tax_number: draft.taxNumber || null,
    payment_terms_days: draft.paymentTermsDays,
    notes: draft.notes || null,
    // An unchecked box is absent from the body altogether, so absent is off.
    is_active: text(formData.get("is_active")) === "on",
  };
}

/**
 * A 23505 from `suppliers_tenant_name_idx`, in words.
 *
 * Worth catching by name rather than reporting "could not save": a name already
 * on the list is the whole problem `0027` existed to undo, and the sentence has
 * to send somebody to the row that is already there rather than let them find a
 * way to type it differently.
 */
function conflict(message: string): string | null {
  if (message.includes("suppliers_tenant_name_idx")) {
    return "You already buy from somebody by that name. Open their record instead — two rows for one distributor is two balances that never agree.";
  }

  return null;
}

/**
 * The supplier's id arrives in the form, so it is checked against the shop's
 * own rows before anything is written. A crafted id must not reach `.eq()`.
 */
async function ownSupplier(tenantId: string, supplierId: unknown) {
  if (typeof supplierId !== "string" || !supplierId) return null;

  const { data } = await createAdminClient()
    .from("suppliers")
    .select(
      "id, name, contact_name, phone, email, address, tax_number, payment_terms_days, notes, is_active",
    )
    .eq("tenant_id", tenantId)
    .eq("id", supplierId)
    .maybeSingle();

  return data;
}

/** The buying screens, and the item sheet whose dropdown reads the same rows. */
function revalidatePurchasing() {
  revalidatePath("/app/purchasing");
  revalidatePath("/app/inventory");
}

// -----------------------------------------------------------------------------
// Add and edit
// -----------------------------------------------------------------------------

/**
 * One supplier, added or corrected.
 *
 * One action for both, because it is the same form: a `supplier_id` in the body
 * means somebody opened an existing row, and its absence means they are adding.
 * Splitting them would mean two copies of the validation, and the copy that
 * drifts is the one that lets a mangled number through.
 */
export async function saveSupplier(
  _previous: SupplierState,
  formData: FormData,
): Promise<SupplierState> {
  const gate = await requirePurchasing();
  if (!gate.ok) return fail(gate.error);
  const { session } = gate;

  const row = readSupplier(formData);
  if (typeof row === "string") return fail(row);

  const supplierId = formData.get("supplier_id");
  const supabase = createAdminClient();

  if (supplierId) {
    const before = await ownSupplier(session.tenantId, supplierId);
    if (!before) {
      return fail("That supplier is not on your list any more. Reload and try again.");
    }

    const { error } = await supabase
      .from("suppliers")
      .update(row)
      .eq("id", before.id)
      .eq("tenant_id", session.tenantId);

    if (error) {
      return fail(
        conflict(error.message) ?? "We could not save those changes. Please try again.",
      );
    }

    await recordAudit(session, {
      action: "supplier.updated",
      subjectType: "supplier",
      subjectId: before.id,
      before,
      after: row,
    });

    revalidatePurchasing();

    return {
      error: null,
      savedAt: Date.now(),
      saved: { id: before.id, name: row.name, action: "updated" },
    };
  }

  const { data: created, error } = await supabase
    .from("suppliers")
    .insert({ ...row, tenant_id: session.tenantId })
    .select("id")
    .single();

  if (error || !created) {
    return fail(
      conflict(error?.message ?? "") ??
        "We could not add that supplier. Please try again.",
    );
  }

  await recordAudit(session, {
    action: "supplier.added",
    subjectType: "supplier",
    subjectId: created.id,
    after: row,
  });

  revalidatePurchasing();

  return {
    error: null,
    savedAt: Date.now(),
    saved: { id: created.id, name: row.name, action: "added" },
  };
}

// -----------------------------------------------------------------------------
// Delete
// -----------------------------------------------------------------------------

/**
 * Remove a supplier from the list for good.
 *
 * What it deliberately does not touch is the items they supply.
 * `items.supplier_id` is `on delete set null`, so every one of them keeps
 * selling and simply stops saying where it came from — a shop needs its shelf
 * more than it needs a tidy foreign key.
 *
 * The cost is that nothing can then total what the shop bought from them, which
 * is why the sheet offers switching them off first and puts that above Delete:
 * switching a distributor off takes them out of every picker and keeps every
 * item, order and delivery pointing at them.
 */
export async function deleteSupplier(
  _previous: SupplierState,
  formData: FormData,
): Promise<SupplierState> {
  const gate = await requirePurchasing();
  if (!gate.ok) return fail(gate.error);
  const { session } = gate;

  const supplier = await ownSupplier(session.tenantId, formData.get("supplier_id"));
  if (!supplier) {
    return fail("That supplier is not on your list any more. Reload and try again.");
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("suppliers")
    .delete()
    .eq("id", supplier.id)
    .eq("tenant_id", session.tenantId);

  if (error) {
    // `purchase_orders.supplier_id` and `goods_receipts.supplier_id` are both
    // `on delete restrict`, unlike every other pointer at a supplier: an order
    // or a delivery with nobody on it is not a record of anything. So this is
    // the expected refusal for any distributor the shop has actually bought
    // from, and it gets the sentence that names the way out rather than "please
    // try again", which would be a lie — trying again would fail identically.
    if (error.code === "23503") {
      return fail(
        `You have orders or deliveries recorded against ${supplier.name}, so they cannot be deleted — that paperwork would have nobody on it. Switch them off instead: they come out of every picker and everything they are on stays.`,
      );
    }

    // The sentence the owner gets cannot be the one Postgres wrote, so the real
    // one has to go somewhere — the same reason `deleteCustomer` logs its own.
    console.error("[purchasing] supplier delete failed for %s", supplier.id, error);
    return fail("We could not remove that supplier. Please try again.");
  }

  await recordAudit(session, {
    action: "supplier.deleted",
    subjectType: "supplier",
    subjectId: supplier.id,
    before: supplier,
  });

  revalidatePurchasing();

  // No redirect. The sheet this was pressed in is a modal, and a navigation
  // would close it before the toast that says what happened had anywhere to
  // land — so the state comes back and the caller closes itself.
  return {
    error: null,
    savedAt: Date.now(),
    saved: { id: supplier.id, name: supplier.name, action: "deleted" },
  };
}
