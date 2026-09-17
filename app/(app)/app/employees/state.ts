/**
 * What a Staff form gets back from its Server Action.
 *
 * Its own module, and not `actions.ts`, because a `"use server"` file may only
 * export async functions — the type would survive the compile, but `IDLE` is an
 * object and Next refuses the whole module for it at runtime. Settings has the
 * same constant and keeps it in `save-bar.tsx` for the same reason; Staff has no
 * shared bar to hang it on, so it gets a file.
 */

export type StaffState = {
  error: string | null;
  savedAt: number | null;
  /**
   * The password, exactly once.
   *
   * It is never stored — not on `profiles`, not in the audit entry, nowhere.
   * Supabase keeps a hash and nothing on this side can read it back, so this
   * round-trip to the owner's screen is the only moment the plain text exists.
   * That is the honest design rather than a limitation: if the owner loses it
   * before it reaches the cashier, the fix is to mint a new one, and the shop's
   * database never held a readable password.
   */
  credentials: { name: string; email: string; password: string } | null;
};

/** What every Staff form starts in, before anything has been submitted. */
export const IDLE: StaffState = { error: null, savedAt: null, credentials: null };
