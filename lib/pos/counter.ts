/**
 * Counters: what Settings stores about each one, and the arithmetic the
 * register does on top of them.
 *
 * No `server-only` and no server imports, the same exception `catalog.ts` and
 * `timeframe-options.ts` carry — the till is a client component and the Server
 * Actions that validate its input have to agree with it exactly. One module,
 * read from both sides.
 *
 * Everything under "The bill" is written against the types rather than against
 * the sample catalog, so it survives the switch to real `items` rows.
 */

import { unitShort, type UnitId } from "@/lib/pos/catalog";
import {
  type Currency,
  type Option,
  type ShopSettings,
} from "@/lib/pos/settings-options";

export type Counter = {
  id: string;
  name: string;
  /** Off until the owner says the prices are right. */
  isActive: boolean;
  receiptPrefix: string;
  acceptsCash: boolean;
  acceptsCard: boolean;
  /** A line at the foot of the roll — a return policy, or the WhatsApp number
   *  to ring. Null for the shop that prints neither. */
  receiptFooter: string | null;
  autoPrint: boolean;
  /** The order they are listed and picked in. A shop names its tills by where
   *  they stand, not alphabetically. */
  sortOrder: number;
  /** The last receipt number this counter issued, for the day it issued it.
   *  Read-only here — `public.record_sale` owns the series. */
  lastReceiptNo: string | null;
};

/**
 * Upper-case, no spaces, eight characters at the outside — the same shape as
 * the check constraint on `counters.receipt_prefix`. It is read down a phone
 * line ("which bill? A-L-M dash…") and printed on a 32-character line, and
 * both of those are why it is not free text. Unique per shop, because it is the
 * only thing telling two counters' receipts apart.
 */
export const RECEIPT_PREFIX_RE = /^[A-Z0-9][A-Z0-9-]{0,7}$/;

/** One line of paper. A second is a second line of paper on every sale. */
export const RECEIPT_FOOTER_MAX = 80;

/**
 * What a counter looks like the moment it is added, before the owner has
 * touched it. Shut, because a till that opens the instant it is created is a
 * till that can sell at prices nobody has checked.
 */
export const newCounterDefaults = (position: number) => ({
  name: `Counter ${position}`,
  receiptPrefix: position === 1 ? "INV" : `INV${position}`,
  isActive: false,
  acceptsCash: true,
  acceptsCard: false,
  receiptFooter: null,
  autoPrint: true,
  sortOrder: position,
});

/* ---------------- Tenders ---------------- */

/**
 * The two the counter can take today. `sale_tenders` also allows raast,
 * easypaisa and jazzcash, and those need a wallet integration — so offering
 * them here would be a button that cannot settle. `udhaar` was a fourth and is
 * gone: 0018 took it off the column with the rest of the khata, because a
 * tender meaning "not paid" with no ledger under it is a sale the shop cannot
 * account for.
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
export const tendersOn = (counter: Pick<Counter, "acceptsCash" | "acceptsCard">) =>
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
  /** The catalog unit, stored as-is on `sale_lines.unit`. Shortened to "pc" or
   *  "kg" only where it is printed. */
  unit: UnitId;
  /** Decimal for anything sold off a scale, whole otherwise. */
  quantity: number;
  price: number;
  /** Per cent, and inclusive: the price already contains it. */
  taxRate: number;
  /** Loose items take 0.25 kg; a bottle does not take a quarter of a bottle. */
  fractional: boolean;
  /**
   * What the shelf holds, as the till last read it.
   *
   * A limit, not a hint: the till will not put an item at zero on a bill and
   * will not step one past this, and `recordSale` refuses on the server with
   * its own fresher read. The cost of that is worth stating, because it is
   * paid at the counter — the count goes stale the moment the till by the door
   * sells one, so a cashier holding stock the console has not caught up with
   * has to count it in on Products & stock before they can sell it.
   */
  stock: number;
};

/** What is left on the shelf once this line is rung up. Negative is a bill the
 *  Charge button refuses — it means the count and the shelf disagree, and the
 *  screen names the item and both numbers rather than failing silently. */
export const stockLeft = (line: CartLine) => round3(line.stock - line.quantity);

export const lineTotal = (line: CartLine) => round2(line.price * line.quantity);

export type Bill = {
  /** Distinct lines — what the cashier counts to check nothing was missed. */
  lines: number;
  /** Units, which is not the same number and is what the customer counts. */
  units: number;
  /** The bill before haggling — what the shelf labels add up to. */
  subtotal: number;
  /** What came off it, in rupees. Zero on the overwhelming majority of bills. */
  discount: number;
  /**
   * Sales tax already inside the total, not added to it. Retail prices in
   * Pakistan are what the customer hands over — printing an exclusive tax line
   * under them would overstate every bill in the shop by 18 per cent.
   */
  taxIncluded: number;
  /** What the customer hands over. */
  total: number;
};

/**
 * What the bill comes to.
 *
 * `discount` is rupees, already resolved and already checked against the
 * cashier's ceiling by `discountOf`. Never a percentage: a percentage stored or
 * passed around is a figure every reader has to re-multiply, and two readers
 * rounding differently is two answers to what the shop was paid.
 */
export function billOf(lines: CartLine[], discount = 0): Bill {
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

  subtotal = round2(subtotal);

  // Never below nothing. A discount larger than the bill is the shop paying
  // the customer, which is a typo every time.
  const off = Math.min(round2(Math.max(0, discount)), subtotal);
  const total = round2(subtotal - off);

  return {
    lines: lines.length,
    units: round2(units),
    subtotal,
    discount: off,
    // Scaled with the bill. The tax was inside the shelf price, so giving away
    // a tenth of the bill gives away a tenth of the tax that was inside it —
    // printing the undiscounted figure would have the receipt claim more tax
    // was collected than the customer paid.
    taxIncluded: subtotal > 0 ? round2((taxIncluded * total) / subtotal) : 0,
    total,
  };
}

/* ---------------- Taking something off ---------------- */

/**
 * How the cashier said it.
 *
 * Both, because both are how it is actually said across a counter. "Ten per
 * cent for you" is a percentage; "make it 450" is an amount; and rounding the
 * paisa off a weighed bill is neither, which is why the till offers it as a
 * button rather than as a third kind.
 */
export type Discount = {
  kind: "amount" | "percent";
  /** Rupees for `amount`, per cent for `percent`. */
  value: number;
};

export const NO_DISCOUNT: Discount = { kind: "amount", value: 0 };

/**
 * The rupees that actually come off, clamped to the bill and to what this
 * cashier is allowed.
 *
 * One function, called by the till and again by the Server Action, because a
 * ceiling the browser applies and the server does not is not a ceiling. The
 * server also hands the figure to `record_sale`, which checks it a third time
 * — the action is the gate and the function is the floor, and a discount is the
 * one field on a bill where the person typing it benefits from the number being
 * wrong.
 *
 * The ceiling is rounded up to the paisa in the shop's favour, matching
 * `record_sale`: 5% of Rs 478 is Rs 23.90, and a cashier refused for one paisa
 * would rightly conclude the limit is broken rather than that it is exact.
 */
export function discountOf(
  subtotal: number,
  discount: Discount,
  ceilingPct: number,
): number {
  if (!(subtotal > 0)) return 0;

  const raw =
    discount.kind === "percent"
      ? (subtotal * discount.value) / 100
      : discount.value;

  if (!Number.isFinite(raw) || raw <= 0) return 0;

  const ceiling = Math.ceil(subtotal * Math.max(0, ceilingPct)) / 100;

  return round2(Math.min(raw, ceiling, subtotal));
}

/**
 * A discount typed into a box. Blank is none rather than zero-as-an-error, the
 * same reading `parseTendered` gives an empty tendered box.
 */
export function parseDiscount(value: string, kind: Discount["kind"]): number | null {
  const trimmed = value.trim().replace(/[,\s]/g, "").replace(/%$/, "");
  if (trimmed === "") return 0;

  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0) return null;
  if (kind === "percent" && amount > 100) return null;
  if (kind === "amount" && amount > 9_999_999) return null;

  return round2(amount);
}

/**
 * "Make it 470" — the commonest discount in a Pakistani shop, and the one a
 * cashier would otherwise do in their head and get wrong on a queue.
 *
 * Rounds the bill down to the next ten, then the next fifty, then the next
 * hundred, offering only the ones that are inside the ceiling and actually
 * take something off. A bill already at a round figure offers nothing, which
 * is right: there is nothing to round.
 */
export function roundOffs(subtotal: number, ceilingPct: number): number[] {
  if (!(subtotal > 0)) return [];

  const ceiling = Math.ceil(subtotal * Math.max(0, ceilingPct)) / 100;

  return [10, 50, 100]
    .map((step) => round2(subtotal - Math.floor(subtotal / step) * step))
    .filter((off) => off > 0 && off <= ceiling)
    // Two steps can land on the same figure — Rs 478 rounds to 470 by ten and
    // 450 by fifty, but Rs 500 rounds to 500 by both.
    .filter((off, index, all) => all.indexOf(off) === index);
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

/** A quantity as it prints beside the line: "2 pc", "0.75 kg". */
export const writeQuantity = (line: CartLine) =>
  `${line.quantity.toLocaleString("en-PK", { maximumFractionDigits: 3 })} ${unitShort(line.unit)}`;

/* ---------------- Receipt numbers ---------------- */

/**
 * `ALM-260916-0042` — the counter's prefix, the trading day, and the sale's
 * place in it. The series resets each morning, so it never grows past four
 * digits and a cashier can say "the forty-second bill today" without
 * subtracting anything.
 *
 * The number is issued by `public.record_sale` inside the same transaction that
 * inserts the sale, not here. That is the only way two tablets pointed at one
 * counter cannot print the same number, and the only way a number is never
 * burnt on a sale that failed to save.
 */
export const PROVISIONAL_PREFIX = "UNSAVED";

/**
 * What prints when the sale could not be recorded — a dead connection, most
 * likely, which on a Pakistani counter is a Tuesday.
 *
 * Deliberately not a number in the counter's own series: it has to be
 * impossible to mistake for one, because it is not in the takings and never
 * will be until the offline outbox lands. The receipt says so out loud rather
 * than looking like every other bill.
 */
export const provisionalReceiptNumber = (at: Date) =>
  `${PROVISIONAL_PREFIX}-${String(at.getHours()).padStart(2, "0")}${String(at.getMinutes()).padStart(2, "0")}${String(at.getSeconds()).padStart(2, "0")}`;

export const isProvisional = (receiptNo: string) =>
  receiptNo.startsWith(`${PROVISIONAL_PREFIX}-`);

/**
 * The id a sale is minted with on the tablet, before it is sent anywhere.
 *
 * Client-generated so that a retry after a dropped connection replays rather
 * than records a second bill — `public.record_sale` hands back the receipt the
 * first attempt issued when it sees an id it already has.
 *
 * `crypto.randomUUID` is absent on a page served over plain http, which is
 * exactly how a shop's own Wi-Fi is usually set up, so there is a fallback.
 * It is not cryptographic and does not need to be: this is an idempotency key
 * checked against one shop's own sales, not a secret.
 */
export function newSaleId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (char) =>
    (
      Number(char) ^
      (Math.random() * 16) >> (Number(char) / 4)
    ).toString(16),
  );
}

/* ---------------- The trading day ---------------- */

/**
 * Which day's books a sale belongs to.
 *
 * Not the calendar day it happened on. `tenant_settings.day_ends_at` is where
 * the shop cuts its books — a dhaba that shuts at 1 am wants that sale on the
 * day it opened — so a sale before that hour counts to the day before. Stamped
 * once by the register onto `sales.business_day`, so every report afterwards
 * agrees without re-deriving it from a setting that can change.
 *
 * `YYYY-MM-DD` in the shop's own timezone, which is not the tablet's: a counter
 * device bought in Dubai and shipped to Lahore keeps the wrong clock for
 * months.
 */
export function businessDayOf(
  at: Date,
  timezone: string,
  dayEndsAt: string,
): string {
  const local = shopParts(at, timezone);
  const cut = Number(dayEndsAt.slice(0, 2));

  // Before the cut, the shop is still trading yesterday. Built from the local
  // Y/M/D as a UTC date purely so the -1 day rolls month and year correctly.
  const day = Date.UTC(local.year, local.month - 1, local.day);
  const belongs = new Date(local.hour < cut ? day - 86_400_000 : day);

  return belongs.toISOString().slice(0, 10);
}

/** Today's trading day, for a report opened with no day asked for. */
export const currentBusinessDay = (settings: ShopSettings) =>
  businessDayOf(new Date(), settings.timezone, settings.dayEndsAt);

/** `Intl` is the only thing that knows what o'clock it is in Karachi on a
 *  server running in UTC, so the parts are read out of it rather than from
 *  `getHours()` on a Date that has no timezone of its own. */
function shopParts(at: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(at);

  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    // Midnight comes back as "24" from some ICU builds.
    hour: read("hour") % 24,
  };
}

/* ---------------- Time on the receipt ---------------- */

/**
 * The stamp printed on the roll, in the shop's timezone rather than the
 * tablet's — the same reason `businessDayOf` takes one.
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

/** "16 Sep 2026" — a trading day as a report writes it. */
export const writeBusinessDay = (day: string) =>
  new Intl.DateTimeFormat("en-PK", {
    timeZone: "UTC",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${day}T00:00:00Z`));

/* ---------------- Arithmetic ---------------- */

/** Two decimals, matching the `numeric(12, 2)` every money column is. */
export const round2 = (value: number) => Math.round(value * 100) / 100;

/** Three, matching `sale_lines.quantity numeric(12, 3)` — and enough that
 *  adding 0.25 four times comes to exactly 1. */
export const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * A quantity off a form field. Weighed items take three decimals; everything
 * else is whole units, so a typed "2.5" against a bottle of Coke is refused
 * rather than rounded into a sale nobody can hand over.
 */
export function parseQuantity(value: string, fractional: boolean): number | null {
  const trimmed = value.trim().replace(/,/g, "");
  if (trimmed === "") return null;

  const quantity = Number(trimmed);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 99_999) return null;
  if (!fractional && !Number.isInteger(quantity)) return null;

  return fractional ? round3(quantity) : quantity;
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
