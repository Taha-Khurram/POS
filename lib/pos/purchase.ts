/**
 * Buying: the shape of an order and a delivery, and the arithmetic on both.
 *
 * No `server-only`, the same exception `counter.ts`, `catalog.ts`,
 * `customer.ts` and `history.ts` carry. The order builder and the receiving
 * sheet are client components — a shopkeeper standing at the door with a
 * delivery note types twelve lines and watches the total move — and the Server
 * Actions behind them have to re-derive every one of those figures. One module,
 * read from both sides, so a total the screen showed is the total the action
 * writes.
 *
 * **The browser never decides what anything costs here either**, exactly as it
 * does not at the till. It sends item ids, quantities and the unit cost off the
 * supplier's invoice; `public.record_receipt` re-does the apportionment, the
 * landed cost and the total inside the transaction that writes them. What is in
 * this file is the same arithmetic written twice over on purpose — once so the
 * screen can show it live, once in SQL so it is what lands — and the two are
 * kept in step by being this short and this explicit.
 *
 * The rows live in `public.purchase_orders`, `public.goods_receipts` and their
 * line tables, and are read by `lib/pos/purchases.ts`.
 */

import { round2, round3 } from "@/lib/pos/counter";

/* ---------------- The order ---------------- */

/**
 * Where an order has got to, as a *human* lifecycle and nothing more.
 *
 * Whether it has been delivered is deliberately not one of these. That is
 * counted off the receipt lines pointing at the order's lines — the same call
 * `0024` made for how much of a bill has been refunded — because a stored
 * "part received" flag is a second copy of the truth, and the copy that drifts
 * is the one telling a shop it is still owed forty bottles it took last week.
 */
export const ORDER_STATUSES = [
  {
    id: "draft",
    label: "Draft",
    note: "Being built. Nobody has been rung.",
    tone: "quiet",
  },
  {
    id: "placed",
    label: "Placed",
    note: "The supplier has been told.",
    tone: "live",
  },
  {
    id: "closed",
    label: "Closed",
    note: "Done with. The rest is not coming.",
    tone: "quiet",
  },
  {
    id: "cancelled",
    label: "Cancelled",
    note: "Never happening. Kept so you can see why.",
    tone: "warn",
  },
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number]["id"];

export const isOrderStatus = (value: unknown): value is OrderStatus =>
  ORDER_STATUSES.some((status) => status.id === value);

export const orderStatus = (id: OrderStatus) =>
  ORDER_STATUSES.find((status) => status.id === id) ?? ORDER_STATUSES[0];

/** One line of an order, as the builder holds it and the action re-reads it. */
export type OrderLine = {
  /** Client-side row key. Never stored — the database mints its own. */
  key: string;
  /** Null for a line typed against nothing in the catalog, which is how a shop
   *  orders something it does not stock yet. */
  itemId: string | null;
  name: string;
  unit: string;
  quantity: number;
  unitCost: number;
  /** How much of this line has already arrived, counted off the receipt lines
   *  pointing at it. Zero on a line being typed. */
  received: number;
};

export type PurchaseOrder = {
  id: string;
  orderNumber: string;
  supplierId: string;
  supplierName: string;
  status: OrderStatus;
  /** `YYYY-MM-DD`, or null for "when he comes" — which is most of them. */
  expectedOn: string | null;
  note: string;
  subtotal: number;
  total: number;
  /** ISO. */
  createdAt: string;
  /** How many lines, so the list can say so without fetching them. */
  lines: number;
  /** Whether anything has landed against it, and whether all of it has. Both
   *  derived by the reader off the receipt lines, never stored. */
  receivedLines: number;
};

export type PurchaseOrderDetail = Omit<PurchaseOrder, "lines" | "receivedLines"> & {
  items: OrderLine[];
};

/** What is still owed on one line. Never negative: a supplier who sent
 *  thirty-two against an order for thirty has over-delivered, which is a
 *  conversation, not a negative number on a screen. */
export const outstanding = (line: OrderLine) =>
  Math.max(0, round3(line.quantity - line.received));

/**
 * How far along an order is, in one word, worked out rather than stored.
 *
 * `"none"` and `"full"` are the two that matter; `"part"` is the one a shop
 * chases. An order with no lines reads as `"none"`, which is right — nothing
 * has arrived because nothing was asked for.
 */
export function deliveryState(
  lines: { quantity: number; received: number }[],
): "none" | "part" | "full" {
  if (lines.length === 0) return "none";

  const asked = lines.reduce((total, line) => total + line.quantity, 0);
  const got = lines.reduce(
    (total, line) => total + Math.min(line.received, line.quantity),
    0,
  );

  if (got <= 0) return "none";
  return got >= asked ? "full" : "part";
}

/* ---------------- The delivery ---------------- */

/** One line of a delivery being typed in. */
export type ReceiptLine = {
  key: string;
  itemId: string | null;
  /** The order line this satisfies, when receiving against an order. */
  orderLineId: string | null;
  name: string;
  unit: string;
  quantity: number;
  /** What the supplier's invoice says for one, before freight. */
  unitCost: number;
};

export type GoodsReceipt = {
  id: string;
  grnNumber: string;
  supplierId: string;
  supplierName: string;
  /** The order it was received against, if there was one. Most deliveries in a
   *  kiryana have none — a van turns up and that is the whole paperwork. */
  orderId: string | null;
  orderNumber: string;
  /** `YYYY-MM-DD`. The day the goods arrived, not the day somebody typed it. */
  receivedOn: string;
  supplierInvoiceNo: string;
  note: string;
  subtotal: number;
  freight: number;
  otherCost: number;
  total: number;
  createdAt: string;
  lines: number;
};

export type GoodsReceiptDetail = Omit<GoodsReceipt, "lines"> & {
  items: (ReceiptLine & {
    /** What it cost to get one onto the shelf, freight included. Read back off
     *  the stored column and never re-derived — that is the whole point of
     *  storing it. */
    landedUnitCost: number;
    lineTotal: number;
  })[];
};

/* ---------------- The arithmetic ---------------- */

export const lineTotalOf = (line: { quantity: number; unitCost: number }) =>
  round2(line.quantity * line.unitCost);

export type ReceiptTotals = {
  subtotal: number;
  extra: number;
  total: number;
  units: number;
  /** Per line, in the order given: what it lands at, and what one unit of it
   *  lands at. Indexed the same as the input, so a table can zip them. */
  landed: { lineTotal: number; landedLineTotal: number; landedUnitCost: number }[];
};

/**
 * Freight spread across the lines, and what each one therefore costs.
 *
 * **This is `public.record_receipt`'s arithmetic, restated.** The two are
 * deliberately duplicated: the screen has to show a shopkeeper what a Rs 500
 * bhaara does to the cost of a carton *before* they save, and the database has
 * to be the one that decides it. They are kept honest by being the same four
 * lines — pro rata by line value, the remainder onto the last line — which is
 * also exactly how `record_sale` apportions a bill discount, and for the same
 * reason: `sum(landedLineTotal)` has to come to `total` exactly, or the shop's
 * stock valuation and its purchase ledger differ by a rupee nobody can find.
 *
 * Free goods with a real freight bill are the edge worth handling rather than
 * refusing. There is no line value to spread against, so it spreads by the
 * units themselves — the bhaara was really paid, and it really is what those
 * units cost to get onto the shelf.
 */
export function receiptTotals(
  lines: { quantity: number; unitCost: number }[],
  freight: number,
  otherCost: number,
): ReceiptTotals {
  const totals = lines.map(lineTotalOf);
  const subtotal = round2(totals.reduce((sum, value) => sum + value, 0));
  const units = lines.reduce((sum, line) => sum + line.quantity, 0);
  const extra = round2(Math.max(0, freight) + Math.max(0, otherCost));

  let spread = 0;

  const landed = lines.map((line, index) => {
    const lineTotal = totals[index];

    const share =
      index === lines.length - 1
        ? // The last line takes what is left, so the shares add to `extra`
          // exactly however the divisions rounded.
          round2(extra - spread)
        : subtotal > 0
          ? round2((extra * lineTotal) / subtotal)
          : units > 0
            ? round2((extra * line.quantity) / units)
            : 0;

    spread = round2(spread + share);

    const landedLineTotal = round2(lineTotal + share);

    return {
      lineTotal,
      landedLineTotal,
      // Four decimals, matching `goods_receipt_lines.landed_unit_cost`: a
      // carton of 48 sachets with Rs 300 of freight on it lands at a cost two
      // decimals would round away.
      landedUnitCost:
        line.quantity > 0
          ? Math.round((landedLineTotal / line.quantity) * 10_000) / 10_000
          : 0,
    };
  });

  return { subtotal, extra, total: round2(subtotal + extra), units, landed };
}

/* ---------------- Field limits ----------------
   The same numbers as the check constraints in `0028_purchasing.sql`. Both
   sides, because a value that slips past this file still cannot reach the
   table — and a value the table would take but the form refuses is a refusal
   somebody can read instead of a 500. */

export const NOTE_MAX = 500;
export const INVOICE_NO_MAX = 60;
export const LINE_NAME_MAX = 160;
/** Well above any delivery, low enough that a mis-keyed row is refused rather
 *  than booked. The same bargain `PRICE_MAX` strikes on an item. */
export const COST_MAX = 9_999_999;
export const QUANTITY_MAX = 999_999;
/** More lines than this on one delivery is a spreadsheet, not a van. */
export const LINES_MAX = 300;

/* ---------------- Validation ----------------
   One function per document, called by the sheet to grey out its own save
   button and by the Server Action to refuse. Returning the sentence rather
   than a boolean keeps the two saying the same thing. */

export type OrderDraft = {
  supplierId: string;
  expectedOn: string;
  note: string;
  lines: { name: string; quantity: number; unitCost: number }[];
};

export function checkOrder(draft: OrderDraft): string | null {
  if (!draft.supplierId) return "Pick who you are ordering from.";

  if (draft.lines.length === 0) {
    return "An order needs at least one line. Search for an item and add it.";
  }

  if (draft.lines.length > LINES_MAX) {
    return `That is ${draft.lines.length} lines. Split it — ${LINES_MAX} is the most one order carries.`;
  }

  const complaint = checkLines(draft.lines);
  if (complaint) return complaint;

  if (draft.expectedOn && !/^\d{4}-\d{2}-\d{2}$/.test(draft.expectedOn)) {
    return "That expected date is not a date.";
  }

  if (draft.note.trim().length > NOTE_MAX) {
    return `That note is too long. ${NOTE_MAX} characters is the margin of the order book.`;
  }

  return null;
}

export type ReceiptDraft = {
  supplierId: string;
  receivedOn: string;
  supplierInvoiceNo: string;
  note: string;
  freight: number;
  otherCost: number;
  lines: { name: string; quantity: number; unitCost: number }[];
};

export function checkReceipt(draft: ReceiptDraft): string | null {
  if (!draft.supplierId) return "Pick who the delivery came from.";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.receivedOn)) {
    return "Say which day the goods arrived.";
  }

  if (draft.lines.length === 0) {
    return "A delivery needs at least one line. Search for an item and add it.";
  }

  if (draft.lines.length > LINES_MAX) {
    return `That is ${draft.lines.length} lines. Split it — ${LINES_MAX} is the most one delivery carries.`;
  }

  const complaint = checkLines(draft.lines);
  if (complaint) return complaint;

  for (const [label, value] of [
    ["Freight", draft.freight],
    ["The other cost", draft.otherCost],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) return `${label} is not an amount.`;
    if (value > COST_MAX) return `${label} is too large. Check for a stray digit.`;
  }

  if (draft.supplierInvoiceNo.trim().length > INVOICE_NO_MAX) {
    return "That invoice number is too long.";
  }

  if (draft.note.trim().length > NOTE_MAX) {
    return `That note is too long. ${NOTE_MAX} characters is the margin of the delivery book.`;
  }

  return null;
}

/** Shared by both, because a line is a line: the two documents differ in what
 *  surrounds them, never in what a line may contain. */
function checkLines(
  lines: { name: string; quantity: number; unitCost: number }[],
): string | null {
  for (const line of lines) {
    const name = line.name.trim();

    if (!name || name.length > LINE_NAME_MAX) {
      return "Every line needs a name — that is what prints on the order.";
    }

    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      return `How many ${name}? A line has to be for more than nothing.`;
    }

    if (line.quantity > QUANTITY_MAX) {
      return `That quantity of ${name} is too large. Check for a stray digit.`;
    }

    if (!Number.isFinite(line.unitCost) || line.unitCost < 0) {
      return `What does one ${name} cost? Zero is allowed — free goods are real.`;
    }

    if (line.unitCost > COST_MAX) {
      return `That cost for ${name} is too large. Check for a stray digit.`;
    }
  }

  return null;
}

/* ---------------- Finding one ---------------- */

/**
 * Does this order match what was typed?
 *
 * The things somebody actually has in their hand: the order number off a
 * printout, or the distributor's name. Shared by the panel and nothing else
 * today, and here rather than in the panel for the reason every other matcher
 * is — the day the supplier record grows its own order list, the two must find
 * the same rows.
 */
export function matchesOrder(order: PurchaseOrder, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  return (
    order.orderNumber.toLowerCase().includes(needle) ||
    order.supplierName.toLowerCase().includes(needle) ||
    order.note.toLowerCase().includes(needle)
  );
}

export function matchesReceipt(receipt: GoodsReceipt, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  return (
    receipt.grnNumber.toLowerCase().includes(needle) ||
    receipt.supplierName.toLowerCase().includes(needle) ||
    receipt.supplierInvoiceNo.toLowerCase().includes(needle) ||
    receipt.orderNumber.toLowerCase().includes(needle) ||
    receipt.note.toLowerCase().includes(needle)
  );
}

/* ---------------- How much is loaded ---------------- */

/**
 * The most orders or deliveries one screen will load.
 *
 * A cap and then filtering in the browser, the same bargain `/app/sales`
 * strikes at 2,000 and for the same reason — one read, then every keystroke is
 * instant on shop 3G. Lower than the bills cap because a shop takes a few
 * deliveries a week and thousands of bills: two hundred is well over a year of
 * buying for most shops, and the screen says so when it bites.
 */
export const PURCHASE_MAX = 400;
