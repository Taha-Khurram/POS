/**
 * A bill put down at the counter, and picked up again.
 *
 * No `server-only` and no server imports, the same exception `counter.ts` and
 * `catalog.ts` carry: the till parks and resumes in the browser and the Server
 * Actions validate against the same limits, so one module is read from both
 * sides. Every bound below is also a check constraint in
 * `0025_held_bills.sql`, so a value that gets past this file still cannot
 * reach the table.
 */

import type { Discount } from "@/lib/pos/counter";

/**
 * How many bills one counter may have parked at once.
 *
 * A limit, not a guess. Three or four is a busy evening; eleven is a cashier
 * who has stopped clearing them and a list nobody can find anything in. The
 * refusal names the number and offers the way out, which is to settle or drop
 * one — a cap that just says "no" is a cap that gets worked around.
 */
export const HELD_MAX = 12;

/** What the cashier will recognise it by. One line, and short enough to read
 *  across a counter at a glance. */
export const HELD_LABEL_MAX = 60;

export type HeldBill = {
  id: string;
  counterId: string;
  /** "Blue shirt", "the aunty with the pram", "Bilal". Empty for the shop in
   *  too much of a hurry to type one — the screen falls back to the time and
   *  what was on it. */
  label: string;
  customerId: string | null;
  /** Resolved on the server, so the till can show who it was for without
   *  looking the id up in a list it may not hold. */
  customerName: string;
  /** Item ids and quantities only. The prices are deliberately not stored:
   *  resuming re-prices from the catalog, so a bill parked before a rate
   *  change settles at the rate on the shelf. */
  /** What is on it, and which size or colour where the item has a grid. No
   *  prices: resuming re-prices from the catalog, and a stored price is a quiet
   *  way to sell at yesterday's cost. `variantId` is null for everything a
   *  shop does not sell by variant, which is most of it. */
  lines: { itemId: string; variantId: string | null; quantity: number }[];
  /** What was agreed off it, as it was agreed. Re-checked against the
   *  cashier's ceiling when it settles, never when it was parked. */
  discount: Discount;
  /** Who put it down, already resolved to a name. */
  by: string;
  at: string;
};

/**
 * What the list calls a bill with no label.
 *
 * The count of items is the most recognisable thing about an unlabelled bill —
 * "three items" is something a cashier can match against what is sitting on the
 * counter, where a truncated uuid is not.
 */
export const heldTitle = (bill: Pick<HeldBill, "label" | "lines">) =>
  bill.label ||
  `${bill.lines.length} ${bill.lines.length === 1 ? "item" : "items"}`;

/**
 * How long it has been sitting there, in the words a cashier would use.
 *
 * Worth showing rather than a clock time: "held 4 minutes ago" is the customer
 * who just walked off, and "held 2 days ago" is a bill somebody forgot, which
 * are two different things to do about it.
 */
export function heldAge(at: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(at)) / 60_000));

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;

  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/** A bill left overnight. Flagged rather than swept away — deleting a shop's
 *  own data on a timer is how a cashier loses a bill they were coming back to,
 *  and the list is short enough to read. */
export const isStale = (at: string, now = Date.now()) =>
  now - Date.parse(at) > 12 * 60 * 60 * 1000;
