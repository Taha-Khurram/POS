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
    }
  | { ok: false; error: string };
