"use client";

import { useState } from "react";

/**
 * A key that changes each time a form's action finishes.
 *
 * React resets a form's DOM once its action has run. For the text fields on
 * these cards that is exactly right — they go back to the row the server just
 * sent, which after a save is the row the owner just wrote. A *controlled*
 * input does not follow. If its React state already holds the value that came
 * back, there is nothing to re-render, so React never writes the DOM property
 * again and the box is left showing the value it was mounted with: the owner
 * suspends a cashier, the save goes through, the toast says so, and the tick
 * comes back.
 *
 * Putting this on such an input's `key` remounts it on every completed
 * submission, so the DOM is built from state again and cannot be left behind.
 * It is deliberately not put on the `<form>`: remounting the whole card would
 * also throw away the dropdowns' picks on a refused save, and those are the one
 * part of the form that survives a refusal today.
 */
export function useSubmissionKey(state: object): number {
  const [runs, setRuns] = useState(0);
  const [seen, setSeen] = useState(state);

  // Set during the render rather than in an effect, the same way the cards
  // re-seed from a new row — an effect would paint one frame with the stale
  // DOM still in it.
  if (seen !== state) {
    setSeen(state);
    setRuns((count) => count + 1);
  }

  return runs;
}
