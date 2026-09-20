/**
 * What the purchasing sheets get back from their Server Actions.
 *
 * Its own module, and not `supplier-actions.ts`, because a `"use server"` file
 * may only export async functions — the type would survive the compile, but
 * `IDLE` is an object and Next refuses the whole module for it at runtime.
 * Customers, Products and Staff keep their state in a file for the same reason.
 */

export type SupplierState = {
  error: string | null;
  savedAt: number | null;
  /**
   * What the sheet did, so the toast can name the supplier rather than saying
   * "Saved". Null on a refusal.
   */
  saved: {
    id: string;
    name: string;
    action: "added" | "updated" | "deleted";
  } | null;
};

export const IDLE: SupplierState = { error: null, savedAt: null, saved: null };
