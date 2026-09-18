"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { requireSession, type SessionContext } from "@/lib/auth";
import {
  BARCODE_MAX,
  IMPORT_MAX,
  NAME_MAX,
  NAME_MIN,
  PRICE_MAX,
  SKU_MAX,
  STOCK_MAX,
  SUPPLIER_MAX,
  TAX_RATES,
  URDU_MAX,
  isFractional,
  isTrackingMode,
  isUnitId,
  placeInTree,
  searchTerms,
  treeName,
  type Department,
} from "@/lib/pos/catalog";
import { getModuleAccess } from "@/lib/pos/access";
import { createAdminClient } from "@/utils/supabase/admin";
import { IDLE, type ImportResult, type ImportRow, type ProductState } from "./state";

/**
 * Adding, editing, deleting and importing products.
 *
 * Every write goes through the service role, because 0008 revoked
 * insert/update/delete on `items` from `authenticated` outright — rule 3 from
 * `0001_init.sql`, so that there is one auditable write path rather than a
 * policy surface to get wrong. That makes the checks below the whole of access
 * control: the tenant comes from the signed token's claim and never from the
 * form, and the `.eq("tenant_id", …)` on every statement is what stops a
 * crafted id from re-pricing somebody else's shop.
 *
 * Who may write is `can_edit_items`, the same switch that draws the module in
 * the rail — the permission is named for this screen, so a manager an owner
 * granted it can add stock. Settings and Staff stay owner-only; the item list
 * is the job, not the administration.
 *
 * Nothing here trusts a number that arrived as a string. The prices are parsed
 * and bounded on this side, and so is the tax rate: a row that got past the
 * form with a 400% rate would be a receipt that lies to FBR.
 */

const fail = (error: string): ProductState => ({ ...IDLE, error });

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim() : "";

/**
 * A rupee figure typed by a human: thousands separators, a stray space, an
 * empty box. Returns `null` for anything that is not a number, which is
 * different from a zero the owner meant.
 */
function amount(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, "").replace(/^Rs\.?/i, "");
  if (!cleaned) return 0;

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

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

// -----------------------------------------------------------------------------
// Validation, shared by the sheet and the import
// -----------------------------------------------------------------------------

/** The row as `public.items` wants it. */
type ItemRow = {
  name: string;
  name_urdu: string | null;
  sku: string | null;
  barcode: string | null;
  department: string;
  /** Optional: a shop that does not file that deep leaves it empty. */
  category: string | null;
  unit: string;
  tracking: string;
  cost_price: number;
  selling_price: number;
  stock: number;
  low_at: number;
  supplier: string | null;
  tax_rate: number;
  variant_count: number | null;
  is_active: boolean;
  search_terms: string[];
};

/**
 * The row, or the sentence to put under the form.
 *
 * The tree is handed in rather than read here, because the import calls this
 * once per row and a query per row would be four hundred round trips to answer
 * one question. It is the shop's own, read on the service role by
 * `shopTree` below — never the browser's, which is what stops a crafted
 * department from filing an item under a tile the register cannot draw.
 */
function readProduct(formData: FormData, tree: Department[]): ItemRow | string {
  const name = text(formData.get("name"));

  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    return `Give the item a name — between ${NAME_MIN} and ${NAME_MAX} characters.`;
  }

  const urdu = text(formData.get("urdu"));
  if (urdu.length > URDU_MAX) return "That Urdu name is too long.";

  const sku = text(formData.get("sku"));
  if (sku.length > SKU_MAX) return `A SKU is at most ${SKU_MAX} characters.`;

  const barcode = text(formData.get("barcode")).replace(/\s+/g, "");
  if (barcode.length > BARCODE_MAX) return "That barcode is too long to be one.";

  const supplier = text(formData.get("supplier"));
  if (supplier.length > SUPPLIER_MAX) return "That supplier name is too long.";

  const tracking = text(formData.get("tracking"));
  if (!isTrackingMode(tracking)) return "Pick how this item is counted.";

  const unit = text(formData.get("unit"));
  if (!isUnitId(unit)) return "Pick the unit it is sold in.";

  // A loose item sold off a scale has to be in a unit that takes a decimal, or
  // the register will refuse the 0.25 kg the customer asked for.
  if (tracking === "weight" && !isFractional(unit)) {
    return "An item sold by weight has to be in kilograms, grams or litres.";
  }

  const cost = amount(text(formData.get("cost")));
  const price = amount(text(formData.get("price")));

  if (cost === null) return "The cost price is not a number.";
  if (price === null) return "The retail price is not a number.";
  if (cost < 0 || price < 0) return "A price cannot be negative.";
  if (cost > PRICE_MAX || price > PRICE_MAX) {
    return "That price is too large. Check for a stray digit.";
  }

  const taxRate = amount(text(formData.get("tax_rate")));
  if (taxRate === null || !TAX_RATES.some((rate) => rate.id === taxRate)) {
    return "Pick a tax rate from the list.";
  }

  const stock = amount(text(formData.get("stock")));
  const lowAt = amount(text(formData.get("low_at")));

  if (stock === null) return "The stock on hand is not a number.";
  if (lowAt === null || lowAt < 0) return "The low-stock alert is not a number.";
  if (Math.abs(stock) > STOCK_MAX || lowAt > STOCK_MAX) {
    return "That count is too large. Check for a stray digit.";
  }

  // Whole units for anything not sold off a scale. Half a bottle of shampoo is
  // not a count, it is a typo.
  if (!isFractional(unit) && !Number.isInteger(stock)) {
    return "That unit is sold whole, so the count has to be a whole number.";
  }

  // The shop's own tree and not the form's: a department that is not one of
  // this shop's would file the item under a register page that does not exist.
  const placed = placeInTree(
    tree,
    text(formData.get("department")),
    text(formData.get("category")),
  );

  if (!placed) {
    return "Add a department on the Categories tab first — an item has to sit somewhere.";
  }

  const variantCount = Number(text(formData.get("variant_count")));

  return {
    name,
    name_urdu: urdu || null,
    sku: sku || null,
    barcode: barcode || null,
    department: placed.department,
    category: placed.category || null,
    unit,
    tracking,
    cost_price: cost,
    selling_price: price,
    stock,
    low_at: lowAt,
    supplier: supplier || null,
    tax_rate: taxRate,
    variant_count:
      tracking === "variant" && Number.isInteger(variantCount) && variantCount > 0
        ? Math.min(variantCount, 999)
        : null,
    // An unchecked box is absent from the body altogether, so absent is off.
    // The import sets it explicitly rather than relying on that.
    is_active: text(formData.get("is_active")) === "on",
    search_terms: searchTerms({ name, urdu, sku, barcode }),
  };
}

/**
 * The shop's tree, on the service role, for the validator above.
 *
 * Not `lib/pos/tree.ts`: that reads through the caller's JWT, and an action
 * that validated against a list RLS had quietly emptied would refuse every
 * save with "add a department first". The tenant here came off the verified
 * token, so the service role is the honest way to ask.
 *
 * Names only — the ids are the Categories tab's business, and nothing in
 * `readProduct` looks at an item count.
 */
async function shopTree(tenantId: string): Promise<Department[]> {
  const supabase = createAdminClient();

  const [departments, categories] = await Promise.all([
    supabase
      .from("departments")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .order("sort_order")
      .order("name"),
    supabase
      .from("categories")
      .select("id, name, department_id")
      .eq("tenant_id", tenantId)
      .order("sort_order")
      .order("name"),
  ]);

  const rows = categories.data ?? [];

  return (departments.data ?? []).map((department) => ({
    id: department.id,
    name: department.name,
    items: 0,
    categories: rows
      .filter((row) => row.department_id === department.id)
      .map((row) => ({ id: row.id, name: row.name, items: 0 })),
  }));
}

/**
 * A 23505 from one of the two unique indexes on `items`, in words.
 *
 * Both are worth catching by name rather than reporting "could not save": a
 * duplicate barcode means the shop already stocks the thing being added, which
 * is the single most useful sentence this screen can say.
 */
function conflict(message: string): string | null {
  if (message.includes("items_tenant_barcode_idx")) {
    return "Another item in your list already carries that barcode. Search for it — you may already stock it.";
  }

  if (message.includes("items_tenant_sku_idx")) {
    return "Another item already has that SKU. Change it, or clear it and Flo will suggest one.";
  }

  return null;
}

/**
 * The item's id arrives in the form, so it is checked against the shop's own
 * rows before anything is written. A crafted id must not reach `.eq()`.
 */
async function ownItem(tenantId: string, itemId: unknown) {
  if (typeof itemId !== "string" || !itemId) return null;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("items")
    .select(
      "id, name, name_urdu, sku, barcode, department, category, unit, tracking, cost_price, selling_price, stock, low_at, supplier, tax_rate, variant_count, is_active",
    )
    .eq("tenant_id", tenantId)
    .eq("id", itemId)
    .maybeSingle();

  return data;
}

/** Both screens the catalog feeds. The register rings up what this writes. */
function revalidateCatalog() {
  revalidatePath("/app/inventory");
  revalidatePath("/app/register");
}

// -----------------------------------------------------------------------------
// Add and edit
// -----------------------------------------------------------------------------

/**
 * One product, added or corrected.
 *
 * One action for both, because it is the same form: an `item_id` in the body
 * means the owner opened an existing row, and its absence means they are
 * adding. Splitting them would mean two copies of the validation above, and the
 * copy that drifts is the one that lets a bad price through.
 */
export async function saveProduct(
  _previous: ProductState,
  formData: FormData,
): Promise<ProductState> {
  const gate = await requireCatalog();
  if (!gate.ok) return fail(gate.error);
  const { session } = gate;

  const row = readProduct(formData, await shopTree(session.tenantId));
  if (typeof row === "string") return fail(row);

  const itemId = formData.get("item_id");
  const supabase = createAdminClient();

  if (itemId) {
    const before = await ownItem(session.tenantId, itemId);
    if (!before) {
      return fail("That item is not in your list any more. Reload and try again.");
    }

    const { error } = await supabase
      .from("items")
      .update(row)
      .eq("id", before.id)
      .eq("tenant_id", session.tenantId);

    if (error) {
      return fail(
        conflict(error.message) ?? "We could not save those changes. Please try again.",
      );
    }

    await recordAudit(session, {
      action: "item.updated",
      subjectType: "item",
      subjectId: before.id,
      before,
      after: row,
    });

    revalidateCatalog();

    return {
      error: null,
      savedAt: Date.now(),
      saved: { id: before.id, name: row.name, action: "updated" },
    };
  }

  const { data: created, error } = await supabase
    .from("items")
    .insert({ ...row, tenant_id: session.tenantId })
    .select("id")
    .single();

  if (error || !created) {
    return fail(
      conflict(error?.message ?? "") ?? "We could not add that item. Please try again.",
    );
  }

  await recordAudit(session, {
    action: "item.added",
    subjectType: "item",
    subjectId: created.id,
    after: row,
  });

  revalidateCatalog();

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
 * Remove an item from the list for good.
 *
 * What it deliberately does not touch is the sales it appears on.
 * `sale_lines.item_id` is `on delete set null` and `name_snapshot` is not-null,
 * so every past receipt still prints the line exactly as it was rung up — it
 * simply stops pointing at a row. A shop needs last month's takings more than
 * it needs a tidy foreign key.
 *
 * The cost of that is the item's own history: nothing can group last month's
 * sales by an item that no longer exists. Which is why the sheet offers
 * switching it off first and puts that above Delete — hiding an item takes it
 * off the register and keeps the link.
 */
export async function deleteProduct(
  _previous: ProductState,
  formData: FormData,
): Promise<ProductState> {
  const gate = await requireCatalog();
  if (!gate.ok) return fail(gate.error);
  const { session } = gate;

  const item = await ownItem(session.tenantId, formData.get("item_id"));
  if (!item) {
    return fail("That item is not in your list any more. Reload and try again.");
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("items")
    .delete()
    .eq("id", item.id)
    .eq("tenant_id", session.tenantId);

  if (error) {
    // The sentence the owner gets cannot be the one Postgres wrote, so the real
    // one has to go somewhere — the same reason `deleteStaff` logs its own.
    console.error("[inventory] delete failed for %s", item.id, error);
    return fail("We could not remove that item. Please try again.");
  }

  await recordAudit(session, {
    action: "item.deleted",
    subjectType: "item",
    subjectId: item.id,
    before: item,
  });

  revalidateCatalog();

  // No redirect. The sheet this was pressed in is a modal over the list, and a
  // navigation would close it before the toast that says what happened had
  // anywhere to land — so the state comes back and the sheet closes itself.
  return {
    error: null,
    savedAt: Date.now(),
    saved: { id: item.id, name: item.name, action: "deleted" },
  };
}

// -----------------------------------------------------------------------------
// Bulk import
// -----------------------------------------------------------------------------

/**
 * Four hundred rows off a distributor's rate list.
 *
 * Not a form action: the CSV was parsed and mapped in the browser, so what
 * arrives is the mapped rows and nothing else. Which means none of it is
 * trusted — every row goes through the same validator the sheet's one row does,
 * and a row this side refuses is skipped with its place in the file named,
 * because "row 214" has to mean the same thing on screen as it does in the
 * sheet the owner is looking at.
 *
 * A bad row never costs the good ones. Rows go in in chunks for speed, and a
 * chunk a unique index refuses is retried one row at a time so the other
 * ninety-nine still land — the alternative is a shop pressing Import four times
 * and deleting the duplicates by hand.
 */
const CHUNK = 100;

/**
 * How much tree one file may plant.
 *
 * A department column that was mapped to the item name would otherwise put four
 * hundred tiles on the register's home grid, and every one of them would have
 * to be deleted by hand. Past these the import refuses outright and says which
 * column to look at — a refusal before anything is written costs the owner one
 * screen; four hundred departments cost them an afternoon.
 */
const NEW_DEPARTMENTS_MAX = 40;
const NEW_CATEGORIES_MAX = 400;

const lower = (value: string) => value.toLowerCase();

/**
 * The shop's tree, grown to hold what the file names.
 *
 * This is the whole reason a fresh shop can import at all. Since `0017` a
 * tenant starts with no departments, and an item has to sit somewhere — so
 * without this every row of the owner's very first file would be refused with
 * "add a department first", which is a wall across the one screen onboarding
 * depends on. The sheet a shop already keeps is the truest description of how
 * that shop files its stock; the import reads it as the vocabulary it is.
 *
 * Only ever additive. Nothing here renames or removes a branch — those are
 * `tree-actions.ts`' business, and one of them does not exist on purpose.
 *
 * Matching is case-insensitive because the unique indexes are: a file carrying
 * both "Beverages" and "beverages" must not try to plant two tiles the shop
 * cannot tell apart.
 */
async function growTree(
  tenantId: string,
  tree: Department[],
  /** Every department and category the mapped rows ask for, already through
   *  `treeName` — so anything in here is a name a tile can carry. */
  wanted: { department: string; category: string }[],
): Promise<
  | {
      ok: true;
      tree: Department[];
      added: { departments: string[]; categories: string[] };
    }
  | { ok: false; error: string }
> {
  const supabase = createAdminClient();

  const held = new Map(tree.map((item) => [lower(item.name), item]));

  // De-duplicated by the same key the database uses, and kept in the order the
  // file reads — so the tiles land on the register's grid in the order the
  // owner's own sheet had them rather than alphabetically.
  const fresh = new Map<string, string>();

  for (const { department } of wanted) {
    const key = lower(department);
    if (!department || held.has(key) || fresh.has(key)) continue;
    fresh.set(key, department);
  }

  if (fresh.size > NEW_DEPARTMENTS_MAX) {
    return {
      ok: false,
      error: `That file names ${fresh.size} new departments. Check the Department column on the previous step — a column of item names matched there would put a tile on the register for every row.`,
    };
  }

  const added: { departments: string[]; categories: string[] } = {
    departments: [],
    categories: [],
  };

  if (fresh.size > 0) {
    const { data: last } = await supabase
      .from("departments")
      .select("sort_order")
      .eq("tenant_id", tenantId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    let at = last?.sort_order ?? 0;

    const rows = [...fresh.values()].map((name) => {
      at += 1;
      return { tenant_id: tenantId, name, sort_order: Math.min(at, 32_000) };
    });

    const { error } = await supabase.from("departments").insert(rows);

    // One refused name — a race with the Categories tab open in another window,
    // or a spelling the case-insensitive index reads as one the shop already
    // has — must not cost the other thirty-nine. Retried singly, and anything
    // that still will not go in is simply absent from the tree read below,
    // which is where the rows that wanted it get their sentence.
    if (error) {
      for (const row of rows) {
        await supabase.from("departments").insert(row);
      }
    }

    added.departments = rows.map((row) => row.name);
  }

  // Re-read rather than patch the tree in memory: the ids of what was just
  // written are what the categories hang off, and a department that quietly did
  // not go in has to be missing here, so the rows asking for it are skipped by
  // name instead of silently filed under the first tile.
  let grown = fresh.size > 0 ? await shopTree(tenantId) : tree;
  let byName = new Map(grown.map((item) => [lower(item.name), item]));

  added.departments = added.departments.filter((name) => byName.has(lower(name)));

  const branches = new Map<string, { department: Department; name: string }>();

  for (const { department, category } of wanted) {
    if (!category) continue;

    const parent = byName.get(lower(department));
    if (!parent) continue;

    const key = `${lower(department)}/${lower(category)}`;

    if (
      branches.has(key) ||
      parent.categories.some((item) => lower(item.name) === lower(category))
    ) {
      continue;
    }

    branches.set(key, { department: parent, name: category });
  }

  if (branches.size > NEW_CATEGORIES_MAX) {
    return {
      ok: false,
      error: `That file names ${branches.size} new categories. Check the Category column on the previous step — that is more shelves than one shop has.`,
    };
  }

  if (branches.size > 0) {
    // Where each department's numbering has reached, so the categories under
    // one department keep the file's order instead of all claiming first place.
    const next = new Map(
      grown.map((item) => [item.id, item.categories.length] as const),
    );

    const rows = [...branches.values()].map(({ department, name }) => {
      const at = (next.get(department.id) ?? 0) + 1;
      next.set(department.id, at);

      return {
        tenant_id: tenantId,
        department_id: department.id,
        name,
        sort_order: Math.min(at, 32_000),
      };
    });

    const { error } = await supabase.from("categories").insert(rows);

    if (error) {
      for (const row of rows) {
        await supabase.from("categories").insert(row);
      }
    }

    grown = await shopTree(tenantId);
    byName = new Map(grown.map((item) => [lower(item.name), item]));

    added.categories = rows
      .filter((row) =>
        grown
          .find((item) => item.id === row.department_id)
          ?.categories.some((item) => lower(item.name) === lower(row.name)),
      )
      .map((row) => row.name);
  }

  return { ok: true, tree: grown, added };
}

export async function importProducts(rows: ImportRow[]): Promise<ImportResult> {
  const gate = await requireCatalog();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { session } = gate;

  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: "There was nothing in that file to import." };
  }

  if (rows.length > IMPORT_MAX) {
    return {
      ok: false,
      error: `That file has ${rows.length.toLocaleString(
        "en-PK",
      )} rows. Split it into files of ${IMPORT_MAX.toLocaleString(
        "en-PK",
      )} or fewer — one request that size times out halfway and leaves you guessing what landed.`,
    };
  }

  const supabase = createAdminClient();

  // The codes the shop already carries, read once here. The browser checked
  // this too, against the list it was handed when the screen loaded — which is
  // a courtesy, and stale the moment somebody else adds an item.
  const { data: existing } = await supabase
    .from("items")
    .select("barcode, sku")
    .eq("tenant_id", session.tenantId);

  const codes = new Set(
    (existing ?? []).map((row) => row.barcode).filter(Boolean) as string[],
  );
  const skus = new Set(
    (existing ?? []).map((row) => row.sku).filter(Boolean) as string[],
  );

  // Every branch the file asks for, cleaned to what a tile can carry. A cell
  // too long for one is dropped here rather than truncated — a tile reading
  // "Imported dry goods and household clean…" is worse than no tile at all.
  const wanted = rows.map((row) => ({
    department: treeName(row.department ?? ""),
    category: treeName(row.category ?? ""),
  }));

  const grown = await growTree(
    session.tenantId,
    await shopTree(session.tenantId),
    wanted,
  );

  if (!grown.ok) return { ok: false, error: grown.error };

  const { tree, added } = grown;
  const byName = new Map(tree.map((item) => [lower(item.name), item]));

  const skipped: { row: number; reason: string }[] = [];
  // Each accepted row keeps the line it came from. `ready` is shorter than the
  // file the moment anything is skipped, so its own index would report row 98
  // for a row the owner has to find at 214.
  const ready: { row: number; values: ItemRow & { tenant_id: string } }[] = [];

  rows.forEach((row, index) => {
    // The department is resolved here, against the tree as it now stands, and
    // handed to the validator by its exact stored name. `placeInTree` falls an
    // unrecognised department to the shop's first one, which is right for a
    // dropdown that only ever offers real departments and quietly wrong for a
    // file — four hundred rows misfiled under "Beverages" is not something
    // anybody spots before the register is drawing it.
    const department = byName.get(lower(wanted[index].department));

    if (!department) {
      skipped.push({
        row: index + 1,
        reason: wanted[index].department
          ? `${wanted[index].department} could not be added to your tree. Add it on the Categories tab and import this row again.`
          : "No department. Choose where these items go on the previous step.",
      });
      return;
    }

    const category = department.categories.find(
      (item) => lower(item.name) === lower(wanted[index].category),
    );

    // Re-using the form's validator is what stops the two drifting: a price the
    // sheet refuses is a price the import refuses, in the same words.
    const form = new FormData();
    form.set("name", row.name ?? "");
    form.set("urdu", row.urdu ?? "");
    form.set("sku", row.sku ?? "");
    form.set("barcode", row.barcode ?? "");
    form.set("department", department.name);
    // Empty rather than the department's first category: a category the file
    // named but the tree could not take is a missing label, and an item sitting
    // under the department alone is honest about that. The register grids on
    // the department either way.
    form.set("category", category?.name ?? "");
    form.set("supplier", row.supplier ?? "");
    form.set("cost", row.cost ?? "");
    form.set("price", row.price ?? "");
    form.set("stock", row.stock ?? "");
    form.set("low_at", row.lowAt ?? "0");
    // An imported item is on sale and taxed at nothing until somebody says
    // otherwise. A rate list does not carry a tax column, and guessing 18% here
    // would put a figure on a receipt that nobody chose.
    form.set("tax_rate", "0");
    form.set("is_active", "on");
    form.set("tracking", "unit");

    // A sheet's unit column is whatever the shop's old till called it. An
    // unrecognised one becomes a piece rather than losing the row, and the owner
    // corrects it on the item — one tap, against retyping a line.
    const unit = (row.unit ?? "").trim().toLowerCase();
    const resolved = unit === "kilo" ? "kg" : unit;

    if (isUnitId(resolved)) {
      form.set("unit", resolved);
      // Anything that comes off a scale is counted off a scale. Otherwise the
      // whole-number check below would refuse "84.5" in the stock column of
      // every loose row in the file.
      if (isFractional(resolved)) form.set("tracking", "weight");
    } else {
      form.set("unit", "piece");
    }

    const parsed = readProduct(form, tree);

    if (typeof parsed === "string") {
      skipped.push({ row: index + 1, reason: parsed });
      return;
    }

    // Two rows in one file carrying the same code would take the unique index
    // down between them. The first wins, which is the order the owner reads.
    if (parsed.barcode) {
      if (codes.has(parsed.barcode)) {
        skipped.push({
          row: index + 1,
          reason: "That barcode is already in your list.",
        });
        return;
      }
      codes.add(parsed.barcode);
    }

    if (parsed.sku) {
      if (skus.has(parsed.sku)) {
        skipped.push({ row: index + 1, reason: "That SKU is already in your list." });
        return;
      }
      skus.add(parsed.sku);
    }

    ready.push({
      row: index + 1,
      values: { ...parsed, tenant_id: session.tenantId },
    });
  });

  if (ready.length === 0) {
    // The tree may have grown for a file that then imported nothing. Redrawn
    // and said plainly, because the owner is about to open the Categories tab
    // and find branches nobody typed.
    const grew = added.departments.length + added.categories.length > 0;
    if (grew) revalidateCatalog();

    return {
      ok: false,
      error: grew
        ? "Not one row could be imported, though the departments the file named were added to your tree. Check the column matching — a cost column read as the name is the usual cause."
        : "Not one row could be imported. Check the column matching — a cost column read as the name is the usual cause.",
    };
  }

  let inserted = 0;

  for (let at = 0; at < ready.length; at += CHUNK) {
    const chunk = ready.slice(at, at + CHUNK);
    const { error } = await supabase
      .from("items")
      .insert(chunk.map((entry) => entry.values));

    if (!error) {
      inserted += chunk.length;
      continue;
    }

    // One row in this chunk was refused and took the other ninety-nine with it.
    // Retried singly, so only the guilty row is lost.
    for (const entry of chunk) {
      const { error: single } = await supabase.from("items").insert(entry.values);

      if (single) {
        skipped.push({
          row: entry.row,
          reason: conflict(single.message) ?? "The database refused this row.",
        });
        continue;
      }

      inserted += 1;
    }
  }

  await recordAudit(session, {
    action: "items.imported",
    subjectType: "item",
    // The rows themselves are not in the entry — four hundred items would make
    // `audit_log` a second copy of the catalog. What happened and how much of
    // it is the question this answers. The branches are named, because a tree
    // that grew on its own is the one thing here nobody pressed a button for.
    after: {
      rows: rows.length,
      inserted,
      skipped: skipped.length,
      departments: added.departments,
      categories: added.categories,
    },
  });

  revalidateCatalog();

  // In file order. The retries above append as they fail, so without this a
  // skipped row 12 can be listed under row 300 and look like a different file.
  skipped.sort((a, b) => a.row - b.row);

  return { ok: true, inserted, skipped, added };
}
