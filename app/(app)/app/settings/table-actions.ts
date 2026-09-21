"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { requireSession, type SessionContext } from "@/lib/auth";
import { checkTable, SEATS_MAX } from "@/lib/pos/restaurant";
import { createAdminClient } from "@/utils/supabase/admin";
import type { SettingsState } from "./actions";
import { IDLE } from "./save-bar";

/**
 * Laying out the floor.
 *
 * Owner-only, like every other write on Settings: which tables a shop has is a
 * decision about the shop, not about a shift. The floor *uses* them, and that
 * is the `tables` module — this is where they come from.
 *
 * A plain insert/update on the service role rather than a security-definer
 * function, unlike everything in `/app/tables`: a table is one row and there is
 * no transaction to protect. The functions there exist because a ticket and the
 * lines it fired have to be true together.
 *
 * **A table is never deleted while a bill is open on it**, and never deleted at
 * all once anything has been eaten at it — `table_orders.table_id` is
 * `on delete set null`, so removing one would quietly detach every meal ever
 * served there from where it happened. Switching it off is the move: it comes
 * off the map and keeps its history.
 */

const fail = (error: string): SettingsState => ({ ...IDLE, error });

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

async function requireOwner() {
  const session = await requireSession();

  if (!session.tenantId) {
    return { ok: false as const, error: "This login is not linked to a shop yet." };
  }

  if (session.tenantRole !== "owner") {
    return {
      ok: false as const,
      error: "Only the owner can lay out the floor.",
    };
  }

  return {
    ok: true as const,
    session: { ...session, tenantId: session.tenantId } as SessionContext & {
      tenantId: string;
    },
  };
}

function revalidateFloor() {
  revalidatePath("/app/settings");
  revalidatePath("/app/tables");
}

/**
 * A 23505 from `dining_tables_tenant_name_idx`, in words.
 *
 * Worth catching by name: two tables called T4 is two tables nobody can tell
 * apart on a kitchen ticket, which is the whole reason the index exists.
 */
const conflict = (message: string) =>
  message.includes("dining_tables_tenant_name_idx")
    ? "You already have a table by that name. Two of them is two tables nobody can tell apart on a ticket."
    : null;

export async function saveTable(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const gate = await requireOwner();
  if (!gate.ok) return fail(gate.error);
  const { session } = gate;

  const seats = Number(text(formData.get("seats")));

  const draft = {
    name: text(formData.get("name")),
    area: text(formData.get("area")),
    seats: Number.isFinite(seats) ? Math.trunc(seats) : NaN,
  };

  // The same function the panel greys its own button out with.
  const complaint = checkTable(draft);
  if (complaint) return fail(complaint);

  const supabase = createAdminClient();
  const tableId = text(formData.get("table_id"));

  const row = {
    name: draft.name,
    area: draft.area || null,
    seats: Math.min(draft.seats, SEATS_MAX),
    is_active: text(formData.get("is_active")) === "on",
  };

  if (tableId) {
    const { data: before } = await supabase
      .from("dining_tables")
      .select("id, name, area, seats, is_active")
      .eq("tenant_id", session.tenantId)
      .eq("id", tableId)
      .maybeSingle();

    if (!before) {
      return fail("That table is not on your floor any more. Reload and try again.");
    }

    const { error } = await supabase
      .from("dining_tables")
      .update(row)
      .eq("id", before.id)
      .eq("tenant_id", session.tenantId);

    if (error) {
      return fail(conflict(error.message) ?? "We could not save that table.");
    }

    await recordAudit(session, {
      action: "dining_table.updated",
      subjectType: "dining_table",
      subjectId: before.id,
      before,
      after: row,
    });

    revalidateFloor();
    return { error: null, savedAt: Date.now() };
  }

  // The shop's own branch. Nothing picks one yet — there is one per shop — but
  // `dining_tables.branch_id` is not-null, for the same reason a counter's is.
  const { data: branch } = await supabase
    .from("branches")
    .select("id")
    .eq("tenant_id", session.tenantId)
    .eq("is_primary", true)
    .maybeSingle();

  if (!branch) {
    return fail("This shop has no branch yet, so a table has nowhere to stand.");
  }

  // Appended to the end of the map rather than sorted in, because a shop names
  // its tables by where they stand and the order they are added is the order
  // they were walked past.
  const { count } = await supabase
    .from("dining_tables")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", session.tenantId);

  const { data: created, error } = await supabase
    .from("dining_tables")
    .insert({
      ...row,
      tenant_id: session.tenantId,
      branch_id: branch.id,
      sort_order: (count ?? 0) + 1,
    })
    .select("id")
    .single();

  if (error || !created) {
    return fail(conflict(error?.message ?? "") ?? "We could not add that table.");
  }

  await recordAudit(session, {
    action: "dining_table.added",
    subjectType: "dining_table",
    subjectId: created.id,
    after: row,
  });

  revalidateFloor();
  return { error: null, savedAt: Date.now() };
}

/**
 * Taking a table off the floor for good.
 *
 * Refused outright while a bill is open on it, and refused once anything has
 * ever been served there — `table_orders.table_id` is `on delete set null`, so
 * deleting one would detach every meal ever eaten at it from where it happened.
 * Switching it off is what the panel offers instead, and it is what a shop
 * means nine times in ten.
 */
export async function deleteTable(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const gate = await requireOwner();
  if (!gate.ok) return fail(gate.error);
  const { session } = gate;

  const tableId = text(formData.get("table_id"));
  const supabase = createAdminClient();

  const { data: table } = await supabase
    .from("dining_tables")
    .select("id, name, area, seats, is_active")
    .eq("tenant_id", session.tenantId)
    .eq("id", tableId)
    .maybeSingle();

  if (!table) {
    return fail("That table is not on your floor any more. Reload and try again.");
  }

  const { count } = await supabase
    .from("table_orders")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", session.tenantId)
    .eq("table_id", table.id);

  if ((count ?? 0) > 0) {
    return fail(
      `${table.name} has ${count} bill${count === 1 ? "" : "s"} against it. Switch it off instead — it comes off the map and every meal served there stays attached to it.`,
    );
  }

  const { error } = await supabase
    .from("dining_tables")
    .delete()
    .eq("id", table.id)
    .eq("tenant_id", session.tenantId);

  if (error) {
    console.error("[settings] table delete failed for %s", table.id, error);
    return fail("We could not remove that table. Please try again.");
  }

  await recordAudit(session, {
    action: "dining_table.deleted",
    subjectType: "dining_table",
    subjectId: table.id,
    before: table,
  });

  revalidateFloor();
  return { error: null, savedAt: Date.now() };
}
