"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { requireSession, type SessionContext } from "@/lib/auth";
import { getModuleAccess } from "@/lib/pos/access";
import { checkCustomer, normalisePhone } from "@/lib/pos/customer";
import { createAdminClient } from "@/utils/supabase/admin";
import { IDLE, type CustomerState } from "./state";

/**
 * Adding, correcting and removing a customer.
 *
 * Every write goes through the service role, because `0018` revoked
 * insert/update/delete on `customers` from `authenticated` outright — rule 3
 * from `0001_init.sql`, so that there is one auditable write path rather than a
 * policy surface to get wrong. That makes the checks below the whole of access
 * control: the tenant comes from the signed token's claim and never from the
 * form, and the `.eq("tenant_id", …)` on every statement is what stops a
 * crafted id from editing somebody else's customer.
 *
 * Who may write is `can_manage_customers`, the same switch that draws the
 * module in the rail. It is named for this screen rather than for the till, so
 * the cashier an owner trusted with the customer book can add the regular who
 * has just given their number — which is the whole of what this replaces.
 *
 * There is no balance here and nothing that moves money. A customer record is a
 * name, a number and the bills attached to it.
 */

const fail = (error: string): CustomerState => ({ ...IDLE, error });

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

/** Owner, or somebody the owner switched `can_manage_customers` on for. */
async function requireCustomers() {
  const session = await requireSession();

  if (!session.tenantId) {
    return { ok: false as const, error: "This login is not linked to a shop yet." };
  }

  const access = await getModuleAccess(session);

  if (!access.customers) {
    return {
      ok: false as const,
      error: "You are not allowed to change the customer list. Ask the owner.",
    };
  }

  return {
    ok: true as const,
    session: { ...session, tenantId: session.tenantId } as SessionContext & {
      tenantId: string;
    },
  };
}

/** The row as `public.customers` wants it. */
type CustomerRow = {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
};

/**
 * The row, or the sentence to put under the form.
 *
 * The complaint itself is `checkCustomer` in `lib/pos/customer.ts`, which the
 * sheet also calls — so the refusal the owner reads here is the same string the
 * form was already showing them, from the same place. What this adds is the
 * turn into columns, and the normalisation of the phone before the unique index
 * ever sees it.
 */
function readCustomer(formData: FormData): CustomerRow | string {
  const draft = {
    name: text(formData.get("name")),
    phone: text(formData.get("phone")),
    email: text(formData.get("email")),
    address: text(formData.get("address")),
    // Not collapsed like the rest: a note is the one field somebody writes two
    // lines in, and flattening it would join them mid-sentence.
    notes:
      typeof formData.get("notes") === "string"
        ? String(formData.get("notes")).trim()
        : "",
  };

  const complaint = checkCustomer(draft);
  if (complaint) return complaint;

  return {
    name: draft.name,
    // Normalised here and not only in the browser: the index is what guarantees
    // one number is one customer, and a request that skipped the form would
    // otherwise plant "+92 300 1234567" beside "03001234567".
    phone: normalisePhone(draft.phone) || null,
    email: draft.email.toLowerCase() || null,
    address: draft.address || null,
    notes: draft.notes || null,
    // An unchecked box is absent from the body altogether, so absent is off.
    is_active: text(formData.get("is_active")) === "on",
  };
}

/**
 * A 23505 from `customers_tenant_phone_idx`, in words.
 *
 * Worth catching by name rather than reporting "could not save": a phone number
 * that is already on the list almost always means the customer is standing
 * there for the second time and somebody is about to create their duplicate.
 */
function conflict(message: string): string | null {
  if (message.includes("customers_tenant_phone_idx")) {
    return "Somebody on your list already has that number. Search for it — they may already be on the list.";
  }

  return null;
}

/**
 * The customer's id arrives in the form, so it is checked against the shop's
 * own rows before anything is written. A crafted id must not reach `.eq()`.
 */
async function ownCustomer(tenantId: string, customerId: unknown) {
  if (typeof customerId !== "string" || !customerId) return null;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("customers")
    .select("id, name, phone, email, address, notes, is_active")
    .eq("tenant_id", tenantId)
    .eq("id", customerId)
    .maybeSingle();

  return data;
}

/** The list, the profile, and the till's picker all read the same rows. */
function revalidateCustomers() {
  revalidatePath("/app/customers");
  revalidatePath("/app/register");
}

// -----------------------------------------------------------------------------
// Add and edit
// -----------------------------------------------------------------------------

/**
 * One customer, added or corrected.
 *
 * One action for both, because it is the same form: a `customer_id` in the body
 * means somebody opened an existing row, and its absence means they are adding.
 * Splitting them would mean two copies of the validation, and the copy that
 * drifts is the one that lets a mangled number through.
 */
export async function saveCustomer(
  _previous: CustomerState,
  formData: FormData,
): Promise<CustomerState> {
  const gate = await requireCustomers();
  if (!gate.ok) return fail(gate.error);
  const { session } = gate;

  const row = readCustomer(formData);
  if (typeof row === "string") return fail(row);

  const customerId = formData.get("customer_id");
  const supabase = createAdminClient();

  if (customerId) {
    const before = await ownCustomer(session.tenantId, customerId);
    if (!before) {
      return fail("That customer is not on your list any more. Reload and try again.");
    }

    const { error } = await supabase
      .from("customers")
      .update(row)
      .eq("id", before.id)
      .eq("tenant_id", session.tenantId);

    if (error) {
      return fail(
        conflict(error.message) ?? "We could not save those changes. Please try again.",
      );
    }

    await recordAudit(session, {
      action: "customer.updated",
      subjectType: "customer",
      subjectId: before.id,
      before,
      after: row,
    });

    revalidateCustomers();

    return {
      error: null,
      savedAt: Date.now(),
      saved: { id: before.id, name: row.name, action: "updated" },
    };
  }

  const { data: created, error } = await supabase
    .from("customers")
    .insert({ ...row, tenant_id: session.tenantId })
    .select("id")
    .single();

  if (error || !created) {
    return fail(
      conflict(error?.message ?? "") ??
        "We could not add that customer. Please try again.",
    );
  }

  await recordAudit(session, {
    action: "customer.added",
    subjectType: "customer",
    subjectId: created.id,
    after: row,
  });

  revalidateCustomers();

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
 * Remove somebody from the list for good.
 *
 * What it deliberately does not touch is the bills they are on.
 * `sales.customer_id` is `on delete set null`, so every receipt still prints
 * and still counts towards the day's takings — it simply stops pointing at a
 * row. A shop needs last month's takings more than it needs a tidy foreign key.
 *
 * The cost of that is the customer's own record: nothing can total what they
 * spent once the row is gone. Which is why the sheet offers switching them off
 * first and puts that above Delete — switching somebody off takes them out of
 * the till's picker and keeps every bill attached to them.
 */
export async function deleteCustomer(
  _previous: CustomerState,
  formData: FormData,
): Promise<CustomerState> {
  const gate = await requireCustomers();
  if (!gate.ok) return fail(gate.error);
  const { session } = gate;

  const customer = await ownCustomer(session.tenantId, formData.get("customer_id"));
  if (!customer) {
    return fail("That customer is not on your list any more. Reload and try again.");
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("customers")
    .delete()
    .eq("id", customer.id)
    .eq("tenant_id", session.tenantId);

  if (error) {
    // The sentence the owner gets cannot be the one Postgres wrote, so the real
    // one has to go somewhere — the same reason `deleteProduct` logs its own.
    console.error("[customers] delete failed for %s", customer.id, error);
    return fail("We could not remove that customer. Please try again.");
  }

  await recordAudit(session, {
    action: "customer.deleted",
    subjectType: "customer",
    subjectId: customer.id,
    before: customer,
  });

  revalidateCustomers();

  // No redirect. The sheet this was pressed in is a modal, and a navigation
  // would close it before the toast that says what happened had anywhere to
  // land — so the state comes back and the caller closes itself.
  return {
    error: null,
    savedAt: Date.now(),
    saved: { id: customer.id, name: customer.name, action: "deleted" },
  };
}
