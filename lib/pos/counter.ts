/**
 * The counter: what Settings stores about it, and the arithmetic the register
 * does on top of it.
 *
 * No `server-only` and no server imports, the same exception `catalog.ts` and
 * `timeframe-options.ts` carry — the till is a client component and the Server
 * Action that validates its settings has to agree with it exactly. One module,
 * read from both sides.
 *
 * Everything under "The bill" is written against the types rather than against
 * the sample catalog, so it survives the switch to real `items` rows.
 */

import {
  type Currency,
  type Option,
  type ShopSettings,
} from "@/lib/pos/settings-options";

export type CounterSettings = {
  name: string;
  /** Off until the owner says the prices are right. */
  isActive: boolean;
  receiptPrefix: string;
  acceptsCash: boolean;
  acceptsCard: boolean;
  /** A line at the foot of the roll — a return policy, or the udhaar number.
   *  Null for the shop that prints neither. */
  receiptFooter: string | null;
  autoPrint: boolean;
};

/** What a shop with no `counters` row reads as — the column defaults in 0010. */
export const DEFAULT_COUNTER: CounterSettings = {
  name: "Counter 1",
  isActive: false,
  receiptPrefix: "INV",
  acceptsCash: true,
  acceptsCard: false,
  receiptFooter: null,
  autoPrint: true,
};

/**
 * Upper-case, no spaces, eight characters at the outside — the same shape as
 * the check constraint on `counters.receipt_prefix`. It is read down a phone
 * line ("which bill? A-L-M dash…") and printed on a 32-character line, and
 * both of those are why it is not free text.
 */
export const RECEIPT_PREFIX_RE = /^[A-Z0-9][A-Z0-9-]{0,7}$/;

/** One line of paper. A second is a second line of paper on every sale. */
export const RECEIPT_FOOTER_MAX = 80;

/* ---------------- Tenders ---------------- */

/**
 * The two the counter can take today. `sale_tenders` in 0008 already allows
 * raast, easypaisa, jazzcash and udhaar; those need a wallet integration and a
 * customer's khata respectively, so offering them here would be a button that
 * cannot settle.
 */
export const TENDERS = [
  {
    id: "cash",
    label: "Cash",
    description: "Notes in the drawer. The register works out the change.",
  },
  {
    id: "card",
    label: "Card",
    description: "Swiped on the shop's own machine, then confirmed here.",
  },
] as const satisfies readonly Option<string>[];

export type TenderId = (typeof TENDERS)[number]["id"];

export const isTender = (value: unknown): value is TenderId =>
  TENDERS.some((tender) => tender.id === value);

/** The tenders this counter is switched on for, in the order they are offered. */
export const tendersOn = (counter: CounterSettings) =>
  TENDERS.filter((tender) =>
    tender.id === "cash" ? counter.acceptsCash : counter.acceptsCard,
  );

/* ---------------- The bill ---------------- */

export type CartLine = {
  /** The catalog item's id. One line per item — scanning the same bottle twice
   *  raises the quantity rather than opening a second row. */
  id: string;
  name: string;
  urdu: string;
  /** `unitShort()` of the catalog unit — "pc", "kg". Printed after the count. */
  unit: string;
  /** Decimal for anything sold off a scale, whole otherwise. */
  quantity: number;
  price: number;
  /** Per cent, and inclusive: the price already contains it. */
  taxRate: number;
  /** Loose items take 0.25 kg; a bottle does not take a quarter of a bottle. */
  fractional: boolean;
};

export const lineTotal = (line: CartLine) => round2(line.price * line.quantity);

export type Bill = {
  /** Distinct lines — what the cashier counts to check nothing was missed. */
  lines: number;
  /** Units, which is not the same number and is what the customer counts. */
  units: number;
  subtotal: number;
  /**
   * Sales tax already inside the total, not added to it. Retail prices in
   * Pakistan are what the customer hands over — printing an exclusive tax line
   * under them would overstate every bill in the shop by 18 per cent.
   */
  taxIncluded: number;
  total: number;
};

export function billOf(lines: CartLine[]): Bill {
  let subtotal = 0;
  let taxIncluded = 0;
  let units = 0;

  for (const line of lines) {
    const money = lineTotal(line);
    subtotal += money;
    units += line.quantity;
    // Inclusive: the 18% inside Rs 118 is Rs 18, not Rs 21.24.
    taxIncluded += money - money / (1 + line.taxRate / 100);
  }

  return {
    lines: lines.length,
    units: round2(units),
    subtotal: round2(subtotal),
    taxIncluded: round2(taxIncluded),
    total: round2(subtotal),
  };
}

/** Change owed on a cash sale. Never negative — short is not change. */
export const changeDue = (tendered: number, total: number) =>
  round2(Math.max(0, tendered - total));

/**
 * The notes a cashier reaches for: the exact amount first, because most kiryana
 * bills are settled to the rupee, then whatever it takes to cover the bill in
 * 50s, 100s, 500s and 1000s.
 */
export function quickTenders(total: number): number[] {
  if (!(total > 0)) return [];

  const covered = [50, 100, 500, 1000, 5000]
    .map((note) => Math.ceil(total / note) * note)
    .filter((amount) => amount > total);

  return [...new Set([round2(total), ...covered])].slice(0, 4);
}

/* ---------------- Money on the page ---------------- */

const SYMBOL: Record<Currency, string> = {
  PKR: "₨",
  AED: "د.إ",
  SAR: "﷼",
  USD: "$",
};

const CODE_PREFIX: Record<Currency, string> = {
  PKR: "Rs",
  AED: "AED",
  SAR: "SAR",
  USD: "$",
};

/**
 * A formatter bound to the shop's own currency card, because that is what the
 * card is for — "Rs 1,250" against "₨ 1,250" against "1,250 PKR" is a choice
 * about what the shop's thermal printer can draw, and it has to reach the
 * receipt or the setting is decoration.
 *
 * Two decimals rather than `rupees()`'s none: a weighed line settles to the
 * paisa, and dropping them on the receipt makes the total disagree with the
 * lines printed above it.
 */
export function moneyFormatter({ currency, currencyFormat }: ShopSettings) {
  const digits = new Intl.NumberFormat("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (amount: number) => {
    const written = digits.format(amount);

    if (currencyFormat === "symbol") return `${SYMBOL[currency]} ${written}`;
    if (currencyFormat === "suffix") return `${written} ${currency}`;
    return `${CODE_PREFIX[currency]} ${written}`;
  };
}

/** A quantity as it prints beside the line: "2", "0.75 kg". */
export const writeQuantity = (line: CartLine) =>
  `${line.quantity.toLocaleString("en-PK", { maximumFractionDigits: 3 })} ${line.unit}`;

/* ---------------- Receipt numbers ---------------- */

/**
 * `ALM-260916-0042` — prefix, the day, and the sale's place in it.
 *
 * The serial is the counter's own and resets daily, so it never grows past four
 * digits and a cashier can say "the forty-second bill today" without
 * subtracting anything.
 *
 * It is issued in the browser rather than by the database, which is honest
 * about what this is: nothing is written to `sales` yet, so a server-issued
 * number would be a number burnt on a sale no table remembers. When the sale is
 * recorded, the same string gets claimed in the statement that inserts it.
 */
export const receiptNumber = (prefix: string, at: Date, serial: number) =>
  `${prefix}-${stamp(at)}-${String(serial).padStart(4, "0")}`;

/** YYMMDD off the tablet's own calendar, which is the day the cashier is in. */
function stamp(at: Date) {
  const yy = String(at.getFullYear()).slice(2);
  const mm = String(at.getMonth() + 1).padStart(2, "0");
  const dd = String(at.getDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

export const serialKey = (prefix: string, at: Date) =>
  `flo.receipt.${prefix}.${stamp(at)}`;

/**
 * Where the day's serial lives until `sales` does.
 *
 * Per counter and per day, so tomorrow starts at 1. Storage that is unavailable
 * — a private window, blocked site data — falls back to 1 rather than refusing
 * to sell: a duplicate receipt number is a bad afternoon, and a register that
 * will not ring up is a shut shop.
 */
export function claimSerial(prefix: string, at: Date): number {
  const key = serialKey(prefix, at);

  try {
    const next = Number(window.localStorage.getItem(key) ?? 0) + 1;
    window.localStorage.setItem(key, String(next));
    return Number.isFinite(next) && next > 0 ? next : 1;
  } catch {
    return 1;
  }
}

/* ---------------- Time on the receipt ---------------- */

/**
 * The stamp printed on the roll, in the shop's timezone rather than the
 * tablet's. A counter tablet bought in Dubai and shipped to Lahore keeps the
 * wrong clock for months, and the receipt is the one place it shows.
 */
export const receiptStamp = (at: Date, timezone: string) =>
  new Intl.DateTimeFormat("en-PK", {
    timeZone: timezone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(at);

/* ---------------- Arithmetic ---------------- */

/** Two decimals, matching the `numeric(12, 2)` every money column is. */
export const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * A quantity off a form field. Weighed items take three decimals, matching
 * `sale_lines.quantity numeric(12, 3)`; everything else is whole units, so a
 * typed "2.5" against a bottle of Coke is refused rather than rounded into a
 * sale nobody can hand over.
 */
export function parseQuantity(value: string, fractional: boolean): number | null {
  const trimmed = value.trim().replace(/,/g, "");
  if (trimmed === "") return null;

  const quantity = Number(trimmed);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 99_999) return null;
  if (!fractional && !Number.isInteger(quantity)) return null;

  return fractional ? Math.round(quantity * 1000) / 1000 : quantity;
}

/**
 * A rupee amount typed into the tendered box. Blank is null rather than zero —
 * an empty box is a cashier who has not counted the notes yet, not a customer
 * who handed over nothing.
 */
export function parseTendered(value: string): number | null {
  const trimmed = value.trim().replace(/,/g, "");
  if (trimmed === "") return null;

  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0 || amount > 9_999_999_999) return null;

  return round2(amount);
}
