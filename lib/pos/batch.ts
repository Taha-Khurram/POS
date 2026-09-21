/**
 * Batches: what a shop has of an item, split by the date on the box.
 *
 * No `server-only`, the same exception `catalog.ts` and `counter.ts` carry: the
 * batch panel on the product sheet and the batch fields on the receiving sheet
 * are client components, and the Server Actions behind them validate against
 * the same limits. `lib/pos/batches.ts` is the reader.
 *
 * **Tracking is opt-in per item.** A kiryana's flour has no batch and asking
 * for one would be a second dropdown between a shopkeeper and a saved item —
 * the mistake `0016` undid when it dropped `items.subcategory`. Everything here
 * is a no-op for an item with `tracksBatches` false, which is every item until
 * somebody says otherwise.
 *
 * **`items.stock` is still the running total.** A batch is a row in the
 * sub-ledger under it, and `private.move_stock` writes both together, so
 * nothing in the console has to reconcile them. Every existing reader, report
 * and stock gate goes on asking `items.stock` and goes on being right.
 */

/** A batch as the screens hold it. */
export type Batch = {
  id: string;
  itemId: string;
  /** What is printed on the carton. Null for stock identified only by a date —
   *  a dairy line, usually. */
  batchNo: string | null;
  /** `YYYY-MM-DD`. Null for a batch tracked by number alone, like a paint lot. */
  expiresOn: string | null;
  quantity: number;
  /** What one unit of *this* batch landed at, carriage included. Two batches of
   *  one item bought three months apart cost different money. */
  unitCost: number;
  /** The delivery that brought it in, when there was one. */
  goodsReceiptId: string | null;
  grnNumber: string;
  receivedOn: string;
  note: string;
};

/* ---------------- Field limits ----------------
   The same numbers as the check constraints in `0030_batches.sql`. */

export const BATCH_NO_MAX = 60;
export const BATCH_NOTE_MAX = 200;

/**
 * How near the end a batch is.
 *
 * Four states rather than a boolean, because a shop acts differently on each
 * one: expired stock comes off the shelf today, `critical` goes on the front
 * of the shelf and gets marked down, `soon` is a reorder decision, and `ok` is
 * left alone. A boolean would flatten the two that need a person.
 *
 * `none` is a batch with no expiry at all — a paint lot, a hardware line. It is
 * not "fine", it is "this question does not apply", and the screens say so
 * rather than drawing a green tick nobody asked for.
 */
export type ExpiryState = "expired" | "critical" | "soon" | "ok" | "none";

/** The shelf-life thresholds, in days. Not per shop and not settings: a
 *  pharmacist and a dairy would pick different numbers, but neither would pick
 *  them in a settings screen before they had seen the list once. If a shop ever
 *  asks, this is the one place to change. */
export const CRITICAL_DAYS = 14;
export const SOON_DAYS = 60;

/**
 * Which state a batch is in, against the shop's own today.
 *
 * `today` is passed in and never read from the browser's clock — the same rule
 * the till, the history and the dashboard follow. A counter tablet bought in
 * Dubai and shipped to Lahore keeps the wrong date for months, and a wrong
 * date here marks good stock as expired.
 *
 * A batch that expires *today* is not expired. It has until the shutter comes
 * down, which is both the kinder reading and the one `take_from_batches`
 * enforces — the two have to agree or the till refuses stock this says is fine.
 */
export function expiryState(expiresOn: string | null, today: string): ExpiryState {
  if (!expiresOn) return "none";

  const days = daysUntil(expiresOn, today);

  if (days < 0) return "expired";
  if (days <= CRITICAL_DAYS) return "critical";
  if (days <= SOON_DAYS) return "soon";
  return "ok";
}

const DAY_MS = 86_400_000;

/** Whole days from `today` to `day`, negative once it is past. Through
 *  `Date.UTC` rather than local getters, for the reason `history.ts` is: the
 *  accountant opening this from Dubai is not on the shop's clock. */
export const daysUntil = (day: string, today: string) =>
  Math.round(
    (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS,
  );

/** "in 12 days", "today", "8 days ago" — how a shopkeeper says it. */
export function writeExpiry(expiresOn: string | null, today: string): string {
  if (!expiresOn) return "no expiry";

  const days = daysUntil(expiresOn, today);

  if (days === 0) return "expires today";
  if (days === 1) return "expires tomorrow";
  if (days > 0) return `expires in ${days} days`;
  if (days === -1) return "expired yesterday";
  return `expired ${Math.abs(days)} days ago`;
}

/** The word, the tone and the sentence for each state, in one place so the
 *  badge on the item list and the row on the product sheet cannot disagree. */
export const EXPIRY_STATES: Record<
  ExpiryState,
  { label: string; tone: "bad" | "warn" | "good" | "quiet"; note: string }
> = {
  expired: {
    label: "Expired",
    tone: "bad",
    note: "Off the shelf. The till will not sell it.",
  },
  critical: {
    label: "Going off",
    tone: "warn",
    note: `Within ${CRITICAL_DAYS} days. Front of the shelf, or marked down.`,
  },
  soon: {
    label: "Use soon",
    tone: "warn",
    note: `Within ${SOON_DAYS} days. Worth thinking about before you reorder.`,
  },
  ok: { label: "In date", tone: "good", note: "Nothing to do." },
  none: {
    label: "No expiry",
    tone: "quiet",
    note: "Tracked by batch number alone.",
  },
};

/* ---------------- What an item's batches come to ---------------- */

export type BatchSummary = {
  /** Everything on the shelf, expired included — this has to equal
   *  `items.stock`, and the product sheet says so when it does not. */
  total: number;
  /** What the till can actually sell: unexpired only. */
  sellable: number;
  expired: number;
  /** Within `CRITICAL_DAYS`. */
  critical: number;
  /** The soonest date anything unexpired goes off, for the item list's badge. */
  nextExpiry: string | null;
  batches: number;
};

export function summarise(batches: Batch[], today: string): BatchSummary {
  let total = 0;
  let sellable = 0;
  let expired = 0;
  let critical = 0;
  let nextExpiry: string | null = null;

  for (const batch of batches) {
    if (batch.quantity <= 0) continue;

    total += batch.quantity;
    const state = expiryState(batch.expiresOn, today);

    if (state === "expired") {
      expired += batch.quantity;
      continue;
    }

    sellable += batch.quantity;
    if (state === "critical") critical += batch.quantity;

    if (batch.expiresOn && (!nextExpiry || batch.expiresOn < nextExpiry)) {
      nextExpiry = batch.expiresOn;
    }
  }

  return {
    total: round3(total),
    sellable: round3(sellable),
    expired: round3(expired),
    critical: round3(critical),
    nextExpiry,
    batches: batches.filter((batch) => batch.quantity > 0).length,
  };
}

/** Three decimals, matching `item_batches.quantity numeric(12, 3)`. */
const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * The order the till takes stock in, written for the browser.
 *
 * The same ordering `private.take_from_batches` uses — soonest expiry first,
 * undated last, ties broken on arrival. Restated here so the product sheet can
 * show the batches in the order they will actually go out, which is the one
 * thing that makes a batch list legible: the top row is what the next customer
 * gets.
 */
export const byFefo = (a: Batch, b: Batch) => {
  if (a.expiresOn && b.expiresOn) {
    return a.expiresOn.localeCompare(b.expiresOn) ||
      a.receivedOn.localeCompare(b.receivedOn);
  }
  if (a.expiresOn) return -1;
  if (b.expiresOn) return 1;
  return a.receivedOn.localeCompare(b.receivedOn);
};

/* ---------------- Validation ---------------- */

export type BatchDraft = {
  batchNo: string;
  expiresOn: string;
  quantity: number;
  unitCost: number;
};

/**
 * The complaint, or null.
 *
 * A batch needs a number or a date — that is the table's own check, and it is
 * the definition of a batch rather than a rule imposed on one: stock with
 * neither is just the item's ordinary stock, and there is already a place for
 * that.
 */
export function checkBatch(draft: BatchDraft): string | null {
  const no = draft.batchNo.trim();

  if (!no && !draft.expiresOn) {
    return "A batch needs a number off the carton, an expiry date, or both — otherwise it is just ordinary stock.";
  }

  if (no.length > BATCH_NO_MAX) {
    return `That batch number is too long — ${BATCH_NO_MAX} characters is the most a carton carries.`;
  }

  if (draft.expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(draft.expiresOn)) {
    return "That expiry date is not a date.";
  }

  if (!Number.isFinite(draft.quantity) || draft.quantity <= 0) {
    return "How many are in this batch? It has to be more than nothing.";
  }

  if (!Number.isFinite(draft.unitCost) || draft.unitCost < 0) {
    return "What did one cost? Zero is allowed — free goods are real.";
  }

  return null;
}

/** What `adjust_batch` will take. `expired` is the write-off. */
export const ADJUST_REASONS = [
  {
    id: "count",
    label: "Counted it",
    note: "Somebody counted this batch and typed what was there.",
  },
  {
    id: "expired",
    label: "Wrote it off — expired",
    note: "Off the shelf and out of stock value. Counted as a loss, not a sale.",
  },
  {
    id: "correction",
    label: "Corrected it",
    note: "The number was wrong and nobody counted.",
  },
] as const;

export type AdjustReason = (typeof ADJUST_REASONS)[number]["id"];

export const isAdjustReason = (value: unknown): value is AdjustReason =>
  ADJUST_REASONS.some((reason) => reason.id === value);
