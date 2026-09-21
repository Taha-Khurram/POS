/**
 * What the product sheet and the import get back from their Server Actions.
 *
 * Its own module, and not `actions.ts`, because a `"use server"` file may only
 * export async functions — the type would survive the compile, but `IDLE` is an
 * object and Next refuses the whole module for it at runtime. Staff keeps its
 * `StaffState` in a file for exactly the same reason.
 */

export type ProductState = {
  error: string | null;
  savedAt: number | null;
  /**
   * What the sheet says it did, so the toast can name the product rather than
   * saying "Saved". Null on a refusal.
   */
  saved: {
    id: string;
    name: string;
    action: "added" | "updated" | "deleted";
  } | null;
};

export const IDLE: ProductState = { error: null, savedAt: null, saved: null };

/** One row as the browser mapped it. Every value is still a string — the CSV
 *  was read in the browser and nothing has been trusted yet. */
export type ImportRow = {
  name?: string;
  urdu?: string;
  barcode?: string;
  sku?: string;
  department?: string;
  category?: string;
  unit?: string;
  cost?: string;
  price?: string;
  stock?: string;
  lowAt?: string;
  supplier?: string;
};

export type ImportResult =
  | {
      ok: true;
      inserted: number;
      /** Rows the server refused, with the reason and the row's place in the
       *  file — so "row 214" means the same thing on screen as in the sheet. */
      skipped: { row: number; reason: string }[];
      /** Branches the file named that the shop did not have yet, and which the
       *  import added to the tree. Named rather than counted: an owner who
       *  imported a sheet with a typo'd department wants to see "Bevrages" on
       *  this screen, not the number 1. */
      added: { departments: string[]; categories: string[] };
      /** Suppliers the file named that the shop did not have yet. Named for the
       *  same reason the branches are: a party that appeared on the Buying list
       *  without anybody pressing a button is the one thing on this screen an
       *  owner has to be told about by name. */
      addedSuppliers: string[];
    }
  | { ok: false; error: string };

/**
 * What the Categories tab gets back.
 *
 * Its own type rather than `ProductState`, because the tab has four small forms
 * on screen at once and each has to know whether *it* was the one that failed —
 * `scope` is the id of the department the message belongs under, or `"root"`
 * for the add-a-department box at the top.
 */
export type TreeState = {
  error: string | null;
  /** Which form the error belongs to. Null when there is no error. */
  scope: string | null;
  savedAt: number | null;
  saved: {
    name: string;
    action: "department-added" | "category-added" | "removed";
  } | null;
};

export const TREE_IDLE: TreeState = {
  error: null,
  scope: null,
  savedAt: null,
  saved: null,
};

/**
 * What the batch panel gets back from `batch-actions.ts`.
 *
 * Here and not beside those actions for the reason `ProductState` is here: a
 * `"use server"` file may only export async functions, and `IDLE_BATCH` is an
 * object — the type would survive the compile and Next would refuse the whole
 * module at runtime.
 */
export type BatchState = {
  error: string | null;
  savedAt: number | null;
  saved: { action: "opened" | "counted" | "written-off"; detail: string } | null;
  /** The item's batches as they now stand, so the panel redraws without a
   *  second round trip. Null on a refusal. */
  batches: import("@/lib/pos/batch").Batch[] | null;
};

export const IDLE_BATCH: BatchState = {
  error: null,
  savedAt: null,
  saved: null,
  batches: null,
};

/**
 * What the variant grid editor gets back from `variant-actions.ts`.
 *
 * Here and not beside those actions for the reason `BatchState` is here: a
 * `"use server"` file may only export async functions, and `IDLE_VARIANT` is an
 * object.
 */
export type VariantState = {
  error: string | null;
  savedAt: number | null;
  saved: { action: "grid" | "counted"; detail: string } | null;
  /** The item's rows as they now stand, so the editor redraws without a second
   *  round trip. Null on a refusal. */
  variants: import("@/lib/pos/variant").Variant[] | null;
};

export const IDLE_VARIANT: VariantState = {
  error: null,
  savedAt: null,
  saved: null,
  variants: null,
};
