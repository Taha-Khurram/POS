"use client";

import { IconAlert, IconCheck } from "@/components/pos/icons";
import { useActionToast } from "@/components/pos/toaster";
import type { SettingsState } from "./actions";

/** The state a Settings form starts in, before anything has been submitted. */
export const IDLE: SettingsState = { error: null, savedAt: null };

/**
 * The strip in every Settings card's footer: what went wrong, or that it
 * saved, and the button.
 *
 * It lives in the footer rather than above the fields because the owner is
 * looking at the button when they press it — a message rendered at the top of
 * a card that scrolls is a message nobody reads.
 *
 * `readOnly` is the manager case. The button is disabled and says why, rather
 * than being hidden: a manager who cannot find the discount ceiling assumes it
 * moved, and one who can see it greyed out asks the owner.
 *
 * The same result also goes up as a toast, because Settings is long enough to
 * scroll: an owner who saves the permissions card and is already reading the
 * ceilings below it never sees the footer they just pressed.
 */
export function SaveBar({
  state,
  pending,
  readOnly,
  saved = "Settings saved",
}: {
  state: SettingsState;
  pending: boolean;
  readOnly: boolean;
  /** What the toast says. The footer only ever says "Saved." — it is directly
   *  under the card it belongs to and needs no naming. */
  saved?: string;
}) {
  useActionToast(state, { saved, failed: "That did not save" });

  return (
    <>
      <p
        className="mr-auto flex items-center gap-1.5 text-[0.75rem]"
        aria-live="polite"
      >
        {readOnly ? (
          <span className="text-graphite-500">
            Only the shop owner can change this.
          </span>
        ) : state.error ? (
          <>
            <IconAlert className="h-3.5 w-3.5 flex-none text-signal-bad" />
            <span className="text-signal-bad">{state.error}</span>
          </>
        ) : state.savedAt ? (
          <>
            <IconCheck className="h-3.5 w-3.5 flex-none text-signal-good" />
            <span className="text-graphite-700">Saved.</span>
          </>
        ) : null}
      </p>

      <button
        type="submit"
        className="pos-btn pos-btn-primary"
        disabled={pending || readOnly}
      >
        {pending ? "Saving…" : "Save changes"}
      </button>
    </>
  );
}
