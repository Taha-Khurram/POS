/**
 * What every Server Action in `/admin` hands back.
 *
 * Its own module and not `actions.ts`, for the reason `customers/state.ts` is
 * one: a `"use server"` file may only export async functions, and `IDLE` is an
 * object — Next refuses the whole module for it at runtime rather than at the
 * compile the types would have caught.
 *
 * One shape for the whole console rather than one per screen. Every form here
 * does the same three things — refuse with a sentence, succeed with a label for
 * the toast, and occasionally hand back something that can only be shown once.
 */

export type AdminState = {
  error: string | null;
  /** Stamped on every success. `useActionToast` keys off it, never the object,
   *  or the `revalidatePath` re-render announces the same save twice. */
  savedAt: number | null;
  /** What to say happened. Null on a refusal. */
  saved: { label: string; detail?: string } | null;
  /**
   * A freshly minted password — an operator's on `/admin/team`, a shop owner's
   * at activation or on "New password".
   *
   * Returned on the response to the action that made it. An owner's is stored
   * nowhere — GoTrue keeps a hash, the audit entry records that it happened and
   * not what it was, and lost means a new one. A team member's is also kept
   * sealed since `0047`, so Show login on `/admin/team` can return it again.
   *
   * `phone` and `message` ride along for an owner: the login goes to the shop
   * on WhatsApp, already composed, because it is shown exactly once.
   */
  credentials: {
    name: string;
    email: string;
    password: string;
    phone?: string;
    message?: string;
  } | null;
  /** Where the caller should go next, when the action created something. */
  tenantId: string | null;
};

export const IDLE: AdminState = {
  error: null,
  savedAt: null,
  saved: null,
  credentials: null,
  tenantId: null,
};
