/**
 * Why a shelf count changed.
 *
 * No `server-only` and no imports, the same exception `catalog.ts` and
 * `counter.ts` carry: the reasons are drawn in the browser (the movements list
 * in the product sheet) and written on the server (`set_stock`, the import),
 * and a word one side would accept and the other would not is a movement
 * nobody can read. One list, read from both sides — and every id below is also
 * a check constraint on `public.stock_movements` in `0022_stock_moves.sql`, so
 * a value that slips past this file still cannot reach the table — widened by
 * one in `0028_purchasing.sql`, which added the first reason that is positive
 * by design.
 *
 * `items.stock` is a running total and this is what it is running over. The
 * table is the evidence and the number is the summary: the first time an owner
 * disagrees with the count, the only useful answer is a list of what moved.
 */

export const STOCK_REASONS = [
  {
    id: "sale",
    label: "Sold",
    blurb: "Rung up at a counter.",
  },
  {
    id: "return",
    label: "Returned",
    blurb: "Came back over the counter and went back on the shelf.",
  },
  {
    id: "count",
    label: "Counted",
    blurb: "Somebody counted the shelf and typed what was there.",
  },
  {
    id: "correction",
    label: "Corrected",
    blurb: "The number was changed without a count behind it.",
  },
  {
    id: "opening",
    label: "Opening count",
    blurb: "What the item was added with.",
  },
  {
    id: "import",
    label: "From a spreadsheet",
    blurb: "Arrived through Bulk import.",
  },
  {
    id: "purchase",
    label: "Delivered",
    blurb: "Came in on a delivery and went on the shelf.",
  },
  {
    id: "expired",
    label: "Written off — expired",
    blurb:
      "Taken off the shelf past its date. The one reason stock leaves without anybody paying for it.",
  },
] as const;

export type StockReason = (typeof STOCK_REASONS)[number]["id"];

export const isStockReason = (value: unknown): value is StockReason =>
  STOCK_REASONS.some((reason) => reason.id === value);

export const reasonLabel = (id: string) =>
  STOCK_REASONS.find((reason) => reason.id === id)?.label ?? "Changed";

/**
 * One line of the ledger.
 *
 * `quantity` is signed — negative off the shelf, positive onto it — because
 * every question anybody asks of the table is a sum, and a separate in/out flag
 * would put a branch inside each one. `stockAfter` is what the count read the
 * instant the row was written, which is what lets somebody read one screen and
 * find where a number went wrong rather than re-adding a year of movements.
 */
export type Movement = {
  id: string;
  reason: StockReason | string;
  quantity: number;
  stockAfter: number;
  /** The bill that moved it, for a sale or a return. Null for everything an
   *  owner did on the Products screen, and for a delivery — which names a
   *  goods receipt instead. */
  receiptNo: string | null;
  saleId: string | null;
  /** The delivery that brought it in, for a `purchase`. Its GRN number, so the
   *  movements list can be read back to an invoice without a second query. */
  grnNumber: string | null;
  /** What the owner typed when they corrected a count. */
  note: string;
  /** Who did it, already resolved to a name — the browser never sees the
   *  roster. "—" for a movement whose author has left. */
  by: string;
  at: string;
};

/** How many movements the product sheet asks for. A screen's worth, and the
 *  cap is stated on it rather than papered over: a fast-moving line in a busy
 *  kiryana is fifty rows a day, and "the last 50" is a more honest promise
 *  than a list that quietly stops. */
export const MOVEMENTS_MAX = 50;

/** "+12" / "−3.5" — signed on purpose, because the sign is the whole meaning
 *  of the row. A true minus sign rather than a hyphen: it is set beside a
 *  number in tabular figures and a hyphen reads as a dash. */
export const writeMovement = (quantity: number) =>
  `${quantity > 0 ? "+" : "−"}${Math.abs(quantity).toLocaleString("en-PK", {
    maximumFractionDigits: 3,
  })}`;
