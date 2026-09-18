"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { requireSession, type SessionContext } from "@/lib/auth";
import { getModuleAccess } from "@/lib/pos/access";
import { TREE_NAME_MAX, TREE_NAME_MIN } from "@/lib/pos/catalog";
import { createAdminClient } from "@/utils/supabase/admin";
import { TREE_IDLE, type TreeState } from "./state";

/**
 * The shop's departments and categories.
 *
 * Adding one and removing an empty one, and nothing else. Renaming is the write
 * that is missing on purpose: `items.department` and `items.category` are the
 * names as they stood when the item was filed, not foreign keys, so a rename
 * has to carry every matching item row with it in the same transaction. Until
 * that exists, a department with items in it cannot be removed either — the
 * refusals below are what keeps the tree and the item list agreeing.
 *
 * Same gate as the item list itself: `can_edit_items`, which is the permission
 * named for this screen. A manager an owner trusted with stock can add the
 * department the new stock goes in; they would otherwise have to ring the owner
 * to file a delivery.
 *
 * Every write is on the service role, because 0008 revoked
 * insert/update/delete from `authenticated` outright — rule 3 from
 * `0001_init.sql`. The tenant comes from the signed token and never from the
 * form, and the `.eq("tenant_id", …)` on every statement is what stops a
 * crafted id from re-filing somebody else's shop.
 */

const fail = (scope: string, error: string): TreeState => ({
  ...TREE_IDLE,
  scope,
  error,
});

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

const done = (
  name: string,
  action: NonNullable<TreeState["saved"]>["action"],
): TreeState => ({
  error: null,
  scope: null,
  savedAt: Date.now(),
  saved: { name, action },
});

/** Owner, or a manager the owner switched `can_edit_items` on for. */
async function requireCatalog() {
  const session = await requireSession();

  if (!session.tenantId) {
    return { ok: false as const, error: "This login is not linked to a shop yet." };
  }

  const access = await getModuleAccess(session);

  if (!access.inventory) {
    return {
      ok: false as const,
      error: "You are not allowed to change the item list. Ask the owner.",
    };
  }

  return {
    ok: true as const,
    session: { ...session, tenantId: session.tenantId } as SessionContext & {
      tenantId: string;
    },
  };
}

/** A name a tile on the register's grid can actually carry. */
function readName(raw: string): string | null {
  if (raw.length < TREE_NAME_MIN || raw.length > TREE_NAME_MAX) return null;
  return raw;
}

const tooLong = (what: string) =>
  `Give the ${what} a name between ${TREE_NAME_MIN} and ${TREE_NAME_MAX} characters. It has to fit a tile on the register.`;

/**
 * A 23505 from one of the two unique indexes, in words.
 *
 * Both are case- and space-insensitive in the database, which is the whole
 * point: a shop that ends up with "Beverages" and "beverages " has two
 * half-full tiles on the register and no way to tell them apart.
 */
function conflict(message: string): string | null {
  if (message.includes("departments_tenant_name_idx")) {
    return "You already have a department with that name.";
  }

  if (message.includes("categories_department_name_idx")) {
    return "That department already has a category with that name.";
  }

  return null;
}

/** The department row, checked against the shop's own. */
async function ownDepartment(tenantId: string, id: unknown) {
  if (typeof id !== "string" || !id) return null;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("departments")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  return data;
}

/**
 * The category row, and the name of the department it hangs under.
 *
 * Two reads rather than a PostgREST embed: `categories` points at
 * `departments` through a *composite* foreign key — `(department_id,
 * tenant_id)`, which is what stops a category ending up under another shop's
 * department — and an embed across one of those is not something to rely on.
 * Two primary-key reads on tables of tens of rows cost nothing.
 */
async function ownCategory(tenantId: string, id: unknown) {
  if (typeof id !== "string" || !id) return null;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("categories")
    .select("id, name, department_id")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  if (!data) return null;

  const parent = await ownDepartment(tenantId, data.department_id);
  if (!parent) return null;

  return { id: data.id, name: data.name, department: parent.name };
}

/**
 * How many items are filed under a branch of the tree.
 *
 * By name and not by id, because that is how the item carries it. A head-only
 * count, so this is one index scan on `items_tenant_department_idx` and no rows
 * come back.
 */
async function itemsUnder(
  tenantId: string,
  department: string,
  category?: string,
): Promise<number> {
  const supabase = createAdminClient();

  let query = supabase
    .from("items")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("department", department);

  if (category !== undefined) query = query.eq("category", category);

  const { count } = await query;
  return count ?? 0;
}

/** Products & stock draws the tree; the register grids off the same names. */
function revalidateCatalog() {
  revalidatePath("/app/inventory");
  revalidatePath("/app/register");
}

// -----------------------------------------------------------------------------
// Adding
// -----------------------------------------------------------------------------

export async function addDepartment(
  _previous: TreeState,
  formData: FormData,
): Promise<TreeState> {
  const gate = await requireCatalog();
  if (!gate.ok) return fail("root", gate.error);
  const { session } = gate;

  const name = readName(text(formData.get("name")));
  if (!name) return fail("root", tooLong("department"));

  const supabase = createAdminClient();

  // New departments go to the end of the grid. `sort_order` is reserved for the
  // day the owner can drag the tiles into the order the shelves are in; until
  // then last-added is last-shown, which is at least predictable.
  const { data: last } = await supabase
    .from("departments")
    .select("sort_order")
    .eq("tenant_id", session.tenantId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: created, error } = await supabase
    .from("departments")
    .insert({
      tenant_id: session.tenantId,
      name,
      sort_order: Math.min((last?.sort_order ?? 0) + 1, 32_000),
    })
    .select("id")
    .single();

  if (error || !created) {
    return fail(
      "root",
      conflict(error?.message ?? "") ??
        "We could not add that department. Please try again.",
    );
  }

  await recordAudit(session, {
    action: "department.added",
    subjectType: "department",
    subjectId: created.id,
    after: { name },
  });

  revalidateCatalog();
  return done(name, "department-added");
}

export async function addCategory(
  _previous: TreeState,
  formData: FormData,
): Promise<TreeState> {
  const gate = await requireCatalog();
  if (!gate.ok) return fail("root", gate.error);
  const { session } = gate;

  const departmentId = text(formData.get("department_id"));
  const scope = departmentId || "root";

  const department = await ownDepartment(session.tenantId, departmentId);
  if (!department) {
    return fail(scope, "That department is not in your tree any more. Reload the page.");
  }

  const name = readName(text(formData.get("name")));
  if (!name) return fail(scope, tooLong("category"));

  const supabase = createAdminClient();

  const { data: last } = await supabase
    .from("categories")
    .select("sort_order")
    .eq("tenant_id", session.tenantId)
    .eq("department_id", department.id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: created, error } = await supabase
    .from("categories")
    .insert({
      tenant_id: session.tenantId,
      department_id: department.id,
      name,
      sort_order: Math.min((last?.sort_order ?? 0) + 1, 32_000),
    })
    .select("id")
    .single();

  if (error || !created) {
    return fail(
      scope,
      conflict(error?.message ?? "") ??
        "We could not add that category. Please try again.",
    );
  }

  await recordAudit(session, {
    action: "category.added",
    subjectType: "category",
    subjectId: created.id,
    after: { name, department: department.name },
  });

  revalidateCatalog();
  return done(name, "category-added");
}

// -----------------------------------------------------------------------------
// Removing
// -----------------------------------------------------------------------------

/**
 * A department, gone — but only if nothing is filed under it.
 *
 * The refusal is the feature. An item carries its department as a word, so
 * deleting a department with stock in it would leave those items pointing at a
 * tile the register no longer draws, and the next time somebody opened one the
 * form would quietly re-file it somewhere else. Moving the items out first is
 * work the owner has to do deliberately.
 */
export async function removeDepartment(
  _previous: TreeState,
  formData: FormData,
): Promise<TreeState> {
  const gate = await requireCatalog();
  if (!gate.ok) return fail("root", gate.error);
  const { session } = gate;

  const id = text(formData.get("department_id"));
  const department = await ownDepartment(session.tenantId, id);
  if (!department) {
    return fail(id || "root", "That department is already gone. Reload the page.");
  }

  const count = await itemsUnder(session.tenantId, department.name);

  if (count > 0) {
    return fail(
      department.id,
      `${department.name} still has ${count.toLocaleString("en-PK")} ${
        count === 1 ? "item" : "items"
      } filed under it. Move them to another department first — open each one from the Items tab and change where it sits.`,
    );
  }

  const supabase = createAdminClient();
  // The categories under it go with it, through the composite foreign key. They
  // are empty by definition: an empty department has no items in any of them.
  const { error } = await supabase
    .from("departments")
    .delete()
    .eq("id", department.id)
    .eq("tenant_id", session.tenantId);

  if (error) {
    console.error("[inventory] department delete failed for %s", department.id, error);
    return fail(department.id, "We could not remove that department. Please try again.");
  }

  await recordAudit(session, {
    action: "department.deleted",
    subjectType: "department",
    subjectId: department.id,
    before: { name: department.name },
  });

  revalidateCatalog();
  return done(department.name, "removed");
}

export async function removeCategory(
  _previous: TreeState,
  formData: FormData,
): Promise<TreeState> {
  const gate = await requireCatalog();
  if (!gate.ok) return fail("root", gate.error);
  const { session } = gate;

  const id = text(formData.get("category_id"));
  const category = await ownCategory(session.tenantId, id);
  if (!category) {
    return fail(id || "root", "That category is already gone. Reload the page.");
  }

  const count = await itemsUnder(
    session.tenantId,
    category.department,
    category.name,
  );

  if (count > 0) {
    return fail(
      category.id,
      `${category.name} still has ${count.toLocaleString("en-PK")} ${
        count === 1 ? "item" : "items"
      } in it. Move them first — open each one from the Items tab and change its category.`,
    );
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("categories")
    .delete()
    .eq("id", category.id)
    .eq("tenant_id", session.tenantId);

  if (error) {
    console.error("[inventory] category delete failed for %s", category.id, error);
    return fail(category.id, "We could not remove that category. Please try again.");
  }

  await recordAudit(session, {
    action: "category.deleted",
    subjectType: "category",
    subjectId: category.id,
    before: { name: category.name, department: category.department },
  });

  revalidateCatalog();
  return done(category.name, "removed");
}
