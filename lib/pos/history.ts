/**
 * Sales history: the window, the filters, and the arithmetic over a list of
 * bills.
 *
 * No `server-only` and no server imports, the same exception `counter.ts` and
 * `catalog.ts` carry. The page resolves the window on the server so the read is
 * scoped before it leaves the database, and the filter bar draws the same list
 * of periods in the browser — one module, read from both sides, so a range the
 * control offers is a range the page knows how to resolve.
 *
 * Every date in here is a `YYYY-MM-DD` trading day off `sales.business_day`,
 * never a timestamp. The register stamps it once from the shop's own
 * `day_ends_at`, so a dhaba that shuts at 1 am gets its last hour on the day it
 * opened and nothing in this file has to know the setting exists. The
 * arithmetic runs through `Date.UTC` rather than local getters, for the reason
 * `date-range-modal.tsx` does: the tablet behind the counter is on Pakistan
 * time and the accountant opening the same link from Dubai is not.
 */

/* ---------------- What a bill is, on this screen ---------------- */

/** How one bill was settled. A list, because `sale_tenders` is one-to-many by
 *  design — today the payment sheet writes exactly one row, and a split bill
 *  must not silently count as its first half the day it writes two. */
export type BillTender = { method: string; amount: number };

/**
 * One row of the history.
 *
 * Denormalised on the server: the counter, the cashier and the customer arrive
 * as names, not as ids the browser would have to join. That is what lets the
 * search box match "Bilal" against the person who rang the bill up without
 * shipping the roster into the filter.
 */
export type BillRow = {
  id: string;
  receiptNo: string;
  businessDay: string;
  /** When it was rung up, ISO. Written in the shop's timezone where it shows. */
  at: string;
  counterId: string | null;
  counterName: string;
  cashierId: string | null;
  cashierName: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  tenders: BillTender[];
  subtotal: number;
  discount: number;
  total: number;
  status: string;
};

/** A line as it was rung up. `name` is `sale_lines.name_snapshot` — what the
 *  roll was printed from, and what survives the item being deleted. */
export type BillLine = {
  id: string;
  itemId: string | null;
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type BillDetail = BillRow & { lines: BillLine[] };

/** What came back for one window, and whether it is all of it. */
export type BillPage = {
  window: Window;
  rows: BillRow[];
  /** Every bill in the window, counted by the database rather than by the rows
   *  that fit. More than `rows.length` is a window that hit the cap. */
  bills: number;
};

/* ---------------- The window ---------------- */

const DAY_MS = 86_400_000;

const shift = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

const monthStart = (day: string) => `${day.slice(0, 7)}-01`;

const addMonths = (day: string, count: number) => {
  const [year, month] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + count, 1)).toISOString().slice(0, 10);
};

/** The last day of the month `day` falls in. */
const monthEnd = (day: string) => shift(addMonths(monthStart(day), 1), -1);

export type RangeId =
  | "today"
  | "yesterday"
  | "7d"
  | "30d"
  | "this-month"
  | "last-month"
  | "custom";

/**
 * The periods worth a button, in the order a shopkeeper reaches for them.
 *
 * Deliberately not the dashboard's list. This screen is opened to find a bill,
 * and a bill is nearly always from today, yesterday, or some time last week.
 * Anything longer is a question for Reports — and the custom range is there for
 * the accountant who asks it anyway.
 */
export const RANGES: { id: RangeId; label: string; note: string }[] = [
  { id: "today", label: "Today", note: "The trading day in progress" },
  { id: "yesterday", label: "Yesterday", note: "The day before it" },
  { id: "7d", label: "Last 7 days", note: "This one and the six before" },
  { id: "30d", label: "Last 30 days", note: "A month of trading" },
  { id: "this-month", label: "This month", note: "From the 1st" },
  { id: "last-month", label: "Last month", note: "The whole of it" },
  { id: "custom", label: "Pick your own dates…", note: "Any two days" },
];

export const isRangeId = (value: unknown): value is RangeId =>
  RANGES.some((range) => range.id === value);

export const isDay = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

export type Window = { from: string; to: string };

/**
 * A period into two trading days.
 *
 * `today` is the shop's own current business day, resolved once on the server
 * and handed to the control, so the browser never decides what day it is — a
 * counter tablet bought in Dubai and shipped to Lahore keeps the wrong clock
 * for months.
 *
 * A custom range with its ends the wrong way round is swapped rather than
 * refused: that is how a mis-tap looks, and there is exactly one thing it can
 * have meant.
 */
export function resolveWindow(
  id: RangeId,
  today: string,
  custom?: { from?: string; to?: string },
): Window {
  if (id === "custom") {
    const from = isDay(custom?.from) ? custom.from : today;
    const to = isDay(custom?.to) ? custom.to : from;
    return from <= to ? { from, to } : { from: to, to: from };
  }

  if (id === "yesterday") {
    const day = shift(today, -1);
    return { from: day, to: day };
  }

  if (id === "7d") return { from: shift(today, -6), to: today };
  if (id === "30d") return { from: shift(today, -29), to: today };
  if (id === "this-month") return { from: monthStart(today), to: today };

  if (id === "last-month") {
    const last = addMonths(monthStart(today), -1);
    return { from: last, to: monthEnd(last) };
  }

  return { from: today, to: today };
}

const DAY_SHORT = new Intl.DateTimeFormat("en-PK", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
});

const DAY_LONG = new Intl.DateTimeFormat("en-PK", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** "16 Sep" — a trading day in a table cell. */
export const writeDay = (day: string) =>
  DAY_SHORT.format(Date.parse(`${day}T00:00:00Z`));

/** "Wed, 16 Sep 2026" — a trading day given room. */
export const writeDayLong = (day: string) =>
  DAY_LONG.format(Date.parse(`${day}T00:00:00Z`));

/**
 * The time of day a bill was rung up, in the shop's own timezone and not the
 * tablet's — the same reason `receiptStamp` takes one. The formatter is kept
 * per timezone rather than built per row: fifty rows is fifty `Intl` objects
 * otherwise, on the one screen a shopkeeper scrolls.
 */
const CLOCKS = new Map<string, Intl.DateTimeFormat>();

export function writeClock(iso: string, timezone: string): string {
  let clock = CLOCKS.get(timezone);

  if (!clock) {
    clock = new Intl.DateTimeFormat("en-PK", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    CLOCKS.set(timezone, clock);
  }

  return clock.format(new Date(iso));
}

/** How many trading days a window covers, both ends counted. */
export const windowDays = (window: Window) =>
  Math.round((Date.parse(window.to) - Date.parse(window.from)) / DAY_MS) + 1;

/**
 * The window in its own words, for the button that opens the period menu.
 *
 * A named period keeps its name — "Last 7 days" says more about what you are
 * looking at than the two dates it resolved to. Only a custom range spells the
 * dates out, because nothing else can.
 */
export function writeWindow(id: RangeId, window: Window, today: string): string {
  if (id !== "custom") {
    return RANGES.find((range) => range.id === id)?.label ?? "Today";
  }

  if (window.from === window.to) {
    return window.from === today ? "Today" : writeDayLong(window.from);
  }

  return `${writeDay(window.from)} – ${writeDayLong(window.to)}`;
}

/* ---------------- Narrowing the list ---------------- */

/**
 * How a bill was paid, as one word.
 *
 * A bill with more than one tender has no single answer, so it gets none rather
 * than the first half of one — the same call `takings.ts` makes.
 */
export function writeTender(tenders: BillTender[]): string {
  if (tenders.length === 0) return "—";
  if (tenders.length > 1) return "Split";

  return tenders[0].method === "cash"
    ? "Cash"
    : tenders[0].method === "card"
      ? "Card"
      : tenders[0].method;
}

export const TENDER_FILTERS = [
  { id: "all", label: "Any payment", note: "Cash, card and split" },
  { id: "cash", label: "Cash", note: "Notes in the drawer" },
  { id: "card", label: "Card", note: "On the shop's machine" },
  { id: "split", label: "Split", note: "More than one tender" },
] as const;

export type TenderFilterId = (typeof TENDER_FILTERS)[number]["id"];

export function matchesTender(bill: BillRow, filter: TenderFilterId): boolean {
  if (filter === "all") return true;
  if (filter === "split") return bill.tenders.length > 1;
  return bill.tenders.length === 1 && bill.tenders[0].method === filter;
}

const digitsOf = (value: string) => value.replace(/\D/g, "");

/**
 * The search box.
 *
 * It matches the things somebody standing at the counter actually has in their
 * hand: the number on the customer's receipt, the customer's own name or phone,
 * which till rang it, and who was on it. The phone matches on digits alone, so
 * "0300 1234" finds `03001234567` — the same bargain `matchesCustomer` strikes,
 * because a cashier reads the number off the customer's screen with the spaces
 * that are printed on it.
 *
 * A query of digits also tries the total, so typing "1250" finds the
 * twelve-fifty bill. That is how somebody looks for a sale they remember the
 * size of and not the number of.
 */
export function matchesBill(bill: BillRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  if (
    bill.receiptNo.toLowerCase().includes(needle) ||
    bill.customerName.toLowerCase().includes(needle) ||
    bill.counterName.toLowerCase().includes(needle) ||
    bill.cashierName.toLowerCase().includes(needle)
  ) {
    return true;
  }

  const digits = digitsOf(needle);

  if (digits) {
    if (bill.customerPhone.includes(digits)) return true;
    // Both spellings, so "1250" finds a bill of 1250.00 and "1250.5" one of
    // 1250.50.
    if (String(bill.total).startsWith(digits)) return true;
    if (bill.total.toFixed(2).startsWith(needle)) return true;
  }

  return false;
}

/* ---------------- What the window came to ---------------- */

const round2 = (value: number) => Math.round(value * 100) / 100;

export type BillSummary = {
  bills: number;
  gross: number;
  cash: number;
  card: number;
  /** Anything settled by neither — nothing today, and a figure rather than a
   *  silence the moment a wallet tender ships. */
  other: number;
  average: number;
};

/**
 * Totalled over the rows on screen, in TypeScript, for the reason `takings.ts`
 * totals a day the same way: the shape of the answer stays in the language of
 * the screen drawing it, and a window this page will load is a few hundred
 * rows. What it must never do is quietly total a *different* set from the one
 * in the table — so it takes the filtered rows, and the screen says beside the
 * figures which rows they are.
 */
export function summarise(bills: BillRow[]): BillSummary {
  let gross = 0;
  let cash = 0;
  let card = 0;
  let other = 0;

  for (const bill of bills) {
    gross += bill.total;

    for (const tender of bill.tenders) {
      if (tender.method === "cash") cash += tender.amount;
      else if (tender.method === "card") card += tender.amount;
      else other += tender.amount;
    }
  }

  return {
    bills: bills.length,
    gross: round2(gross),
    cash: round2(cash),
    card: round2(card),
    other: round2(other),
    average: bills.length ? round2(gross / bills.length) : 0,
  };
}

/* ---------------- Off the screen and into a spreadsheet ---------------- */

/** Fifty rows a page: a tablet draws them in a frame, and a thumb reaches the
 *  pager without scrolling the table twice. */
export const PAGE_SIZE = 50;

/**
 * The most bills one window will load.
 *
 * A cap rather than a round trip per page, because filtering and paging in the
 * browser is what makes this screen usable on shop 3G — one read, and then
 * every keystroke is instant. Two thousand bills is a fortnight for a busy
 * kiryana and a whole quarter for most shops; past that the screen says so out
 * loud and names the control that fixes it, which is the same bargain the
 * customer record strikes at a hundred.
 */
export const HISTORY_MAX = 2_000;

const escape = (value: string) =>
  /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/**
 * The filtered list as a CSV.
 *
 * Money goes out as bare numbers with the currency in the column heading, not
 * as "Rs 1,250.00" — a spreadsheet cannot add up a string, and adding it up is
 * the one thing anybody does with this file. The leading BOM is what makes
 * Excel on a Windows machine read it as UTF-8, without which a customer named
 * in Urdu arrives as mojibake.
 */
export function billsToCsv(
  bills: BillRow[],
  options: { currency: string; stamp: (iso: string) => string },
): string {
  const header = [
    "Bill",
    "Trading day",
    "Rung up",
    "Counter",
    "Cashier",
    "Customer",
    "Phone",
    "Paid by",
    `Total (${options.currency})`,
  ];

  const lines = bills.map((bill) =>
    [
      bill.receiptNo,
      bill.businessDay,
      options.stamp(bill.at),
      bill.counterName,
      bill.cashierName,
      bill.customerName,
      bill.customerPhone,
      writeTender(bill.tenders),
      bill.total.toFixed(2),
    ]
      .map((cell) => escape(String(cell)))
      .join(","),
  );

  return `﻿${[header.join(","), ...lines].join("\r\n")}\r\n`;
}

/** `flo-bills-2026-09-01-to-2026-09-16.csv` — the window is in the name, so two
 *  exports in a downloads folder are told apart without opening them. */
export const csvFilename = (window: Window) =>
  window.from === window.to
    ? `flo-bills-${window.from}.csv`
    : `flo-bills-${window.from}-to-${window.to}.csv`;
