/**
 * Variants: one item, many rows on the shelf.
 *
 * No `server-only`, the same exception `batch.ts` and `catalog.ts` carry — the
 * grid editor and the till's picker are client components and the Server
 * Actions behind them validate against the same limits. `lib/pos/variants.ts`
 * is the reader.
 *
 * **This is the batch problem one shape over**, and it is deliberately solved
 * the same way: an item's stock lives in rows under it, `private.move_stock`
 * writes the row and `items.stock` together, and `items.stock` stays the
 * running total every reader already asks. What differs is who chooses — a
 * batch is picked by the till, soonest date first, and a variant is picked by
 * the customer.
 *
 * **An item is variant-tracked or batch-tracked, never both.** A check
 * constraint in `0031` enforces it, `checkVariantSetup` says it in words before
 * the save, and the product sheet greys the other switch. A pharmacy has no
 * colours and a cloth house has no expiry.
 */

/** One sellable row: a size, a colour, its own stock and code. */
export type Variant = {
  id: string;
  itemId: string;
  /** The two values, in the order `axes` names them. `optionB` is empty for an
   *  item that varies on one axis only — a bakery's cake has sizes and no
   *  colours. */
  optionA: string;
  optionB: string;
  sku: string;
  barcode: string;
  /** Null means "the item's own price". Most of a cloth house's sizes are one
   *  price and the XXL is not, so the exception is stored and the rule is an
   *  absence. */
  price: number | null;
  cost: number | null;
  quantity: number;
  isActive: boolean;
  sortOrder: number;
};

/* ---------------- Field limits ----------------
   The same numbers as the check constraints in `0031_variants.sql`. */

export const OPTION_MAX = 40;
export const AXIS_MAX = 24;
export const VARIANT_SKU_MAX = 40;
export const VARIANT_BARCODE_MAX = 32;
/** A grid wider than this is not a grid, it is a spreadsheet — and it is a
 *  touchscreen somebody has to find one row on. Six sizes by eight colours is
 *  already forty-eight taps of setup. */
export const VARIANTS_MAX = 120;

/* ---------------- The grid ---------------- */

/** What the editor holds while somebody is building the grid: two axis names
 *  and their values, typed as comma-separated lists the way a shopkeeper
 *  actually writes them out. */
export type GridDraft = {
  axisA: string;
  valuesA: string;
  axisB: string;
  valuesB: string;
};

/** A comma-separated list into trimmed, de-duplicated values, in the order they
 *  were typed — so the grid comes out in the order the shop arranged it rather
 *  than alphabetically. Case-folded for the duplicate check only: "Blue" typed
 *  twice is one colour, and the first spelling is the one kept. */
export function splitValues(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const part of raw.split(",")) {
    const value = part.trim().replace(/\s+/g, " ");
    if (!value || value.length > OPTION_MAX) continue;

    const key = value.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(value);
  }

  return out;
}

export type GridRow = { optionA: string; optionB: string };

/**
 * Every combination, in the order the two lists were typed.
 *
 * Axis A varies slowest, which is what makes the grid readable: all the smalls
 * together, then all the mediums. A shopkeeper counting a shelf works down one
 * size at a time.
 */
export function gridOf(draft: GridDraft): GridRow[] {
  const a = splitValues(draft.valuesA);
  const b = splitValues(draft.valuesB);

  if (a.length === 0) return [];
  if (b.length === 0) return a.map((optionA) => ({ optionA, optionB: "" }));

  return a.flatMap((optionA) => b.map((optionB) => ({ optionA, optionB })));
}

/** The axis names, dropping an empty second one. What `items.variant_axes`
 *  stores and what every screen labels its columns from. */
export function axesOf(draft: GridDraft): string[] {
  const a = draft.axisA.trim();
  const b = draft.axisB.trim();
  return b && splitValues(draft.valuesB).length > 0 ? [a, b] : [a];
}

/** "Medium / Blue", or just "Medium". How a variant reads on a receipt, in the
 *  till's bill panel and in the stock list — one function, so the three cannot
 *  come to write it differently. */
export const writeVariant = (variant: Pick<Variant, "optionA" | "optionB">) =>
  variant.optionB ? `${variant.optionA} / ${variant.optionB}` : variant.optionA;

/** The full name a sale line is stamped with: the item and which one of it. */
export const writeVariantLine = (
  itemName: string,
  variant: Pick<Variant, "optionA" | "optionB">,
) => `${itemName} — ${writeVariant(variant)}`;

/** What a variant sells for: its own price where it has one, the item's
 *  otherwise. One function, because the till, the grid and the Server Action
 *  all have to agree — and the action re-derives it rather than trusting what
 *  the browser sent, exactly as it does for an ordinary item. */
export const priceOf = (variant: Pick<Variant, "price">, itemPrice: number) =>
  variant.price ?? itemPrice;

export const costOf = (variant: Pick<Variant, "cost">, itemCost: number) =>
  variant.cost ?? itemCost;

/* ---------------- What a grid comes to ---------------- */

export type VariantSummary = {
  /** Live rows only. A switched-off colour is not something the till offers. */
  rows: number;
  /** Everything across the live rows — this equals `items.stock` once the grid
   *  covers all of it, and the editor says so when it does not. */
  total: number;
  /** Rows with nothing left. The number a cloth house reorders against. */
  out: number;
  /** The best-selling shape of question: which row has the most. */
  deepest: string;
};

export function summariseVariants(variants: Variant[]): VariantSummary {
  const live = variants.filter((variant) => variant.isActive);

  let total = 0;
  let out = 0;
  let deepest = "";
  let most = -1;

  for (const variant of live) {
    total += variant.quantity;
    if (variant.quantity <= 0) out += 1;
    if (variant.quantity > most) {
      most = variant.quantity;
      deepest = writeVariant(variant);
    }
  }

  return {
    rows: live.length,
    total: Math.round(total * 1000) / 1000,
    out,
    deepest,
  };
}

/** What the till may ring up: live rows with something on the shelf. The stock
 *  gate is the server's, as always — this is what the picker draws. */
export const sellableVariants = (variants: Variant[]) =>
  variants.filter((variant) => variant.isActive);

/* ---------------- Validation ---------------- */

/**
 * The complaint about a grid, or null.
 *
 * Called by the editor to grey its own save button and by the Server Action to
 * refuse, so the two say the same thing in the same words.
 */
export function checkGrid(draft: GridDraft): string | null {
  const axisA = draft.axisA.trim();

  if (!axisA) return "What does the first column vary by? Size, colour, flavour.";
  if (axisA.length > AXIS_MAX) return "That column name is too long.";

  const a = splitValues(draft.valuesA);
  if (a.length === 0) {
    return `List the ${axisA.toLowerCase()} values, separated by commas — Small, Medium, Large.`;
  }

  const b = splitValues(draft.valuesB);

  if (b.length > 0 && !draft.axisB.trim()) {
    return "The second column has values but no name. What do they vary by?";
  }

  if (draft.axisB.trim().length > AXIS_MAX) return "That column name is too long.";

  const rows = a.length * Math.max(1, b.length);

  if (rows > VARIANTS_MAX) {
    return `That is ${rows} rows. ${VARIANTS_MAX} is the most one item carries — past that it is a grid nobody can find a size in.`;
  }

  return null;
}

/**
 * Whether an item may be variant-tracked at all.
 *
 * The one rule the database also holds as a check constraint: an item is split
 * by variant or by batch, never both. Said here so the product sheet can grey
 * the other switch rather than letting somebody fill a form that bounces.
 */
export const checkVariantSetup = (item: {
  tracking: string;
  tracksBatches: boolean;
}): string | null =>
  item.tracking === "variant" && item.tracksBatches
    ? "An item is counted by batch or sold by variant, not both. A pharmacy has no colours and a cloth house has no expiry — pick the one this item needs."
    : null;

/** What `adjust_variant` will take. No `expired` here: a colour does not go
 *  off, and a row that is wrong is either counted or corrected. */
export const VARIANT_ADJUST_REASONS = [
  { id: "count", label: "Counted it", note: "Somebody counted this row." },
  {
    id: "correction",
    label: "Corrected it",
    note: "The number was wrong and nobody counted.",
  },
] as const;

export type VariantAdjustReason = (typeof VARIANT_ADJUST_REASONS)[number]["id"];

export const isVariantAdjustReason = (
  value: unknown,
): value is VariantAdjustReason =>
  VARIANT_ADJUST_REASONS.some((reason) => reason.id === value);
