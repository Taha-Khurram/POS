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
   * A freshly minted invite: the link and the message to paste beside it.
   *
   * Returned exactly once, on the response to the action that created it, and
   * never readable again from anywhere — `invites.token_hash` is a sha256 and
   * there is nothing to reverse it with. An operator who loses this before
   * pasting it regenerates the link, which revokes the one they lost.
   */
  invite: {
    link: string;
    message: string;
    phone: string;
    shopName: string;
  } | null;
  /** Where the caller should go next, when the action created something. */
  tenantId: string | null;
};

export const IDLE: AdminState = {
  error: null,
  savedAt: null,
  saved: null,
  invite: null,
  tenantId: null,
};
