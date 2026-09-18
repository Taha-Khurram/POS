/**
 * What the customer sheet gets back from its Server Actions.
 *
 * Its own module, and not `actions.ts`, because a `"use server"` file may only
 * export async functions — the type would survive the compile, but `IDLE` is an
 * object and Next refuses the whole module for it at runtime. Products and
 * Staff keep their state in a file for exactly the same reason.
 */

export type CustomerState = {
  error: string | null;
  savedAt: number | null;
  /**
   * What the sheet says it did, so the toast can name the customer rather than
   * saying "Saved". Null on a refusal.
   */
  saved: {
    id: string;
    name: string;
    action: "added" | "updated" | "deleted";
  } | null;
};

export const IDLE: CustomerState = { error: null, savedAt: null, saved: null };
