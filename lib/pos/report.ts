/**
 * Reports: the periods, the arithmetic, the words that explain the arithmetic,
 * and the spreadsheets that come off the screen.
 *
 * No `server-only` and no server imports, the same exception `history.ts`,
 * `counter.ts`, `catalog.ts` and `customer.ts` carry. The page resolves the
 * window on the server so the read is scoped before it leaves the database, and
 * the period picker draws the same list in the browser — one module, read from
 * both sides, so a period the control offers is a period the page knows how to
 * resolve. The export button runs in the browser too, and it writes the same
 * figures the table drew.
 *
 * Two things in here are load-bearing beyond the usual:
 *
 * **`EXPLAIN` is the single source for how every figure is worked out.** The
 * hover tip beside a heading, the caption under a card and the column name in
 * the CSV all read from it. A report is only worth anything if the owner
 * believes the number, and the fastest way to lose that is for the screen to
 * say "profit is sales minus cost" while the spreadsheet quietly means
 * something else. There is one sentence per figure and everything quotes it.
 *
 * **The window arithmetic is `history.ts`'s**, imported rather than rewritten.
 * Reports offers a longer list of periods — a quarter and a financial year are
 * questions for this screen and not for one somebody opened to find a bill —
 * but the day and month shifting underneath is the same, and written twice it
 * would eventually disagree about February.
 *
 * Every date here is a `YYYY-MM-DD` trading day off `sales.business_day`, never
 * a timestamp. The register stamped it once from the shop's own `day_ends_at`,
 * so a dhaba that shuts at 1 am gets its last hour on the day it opened and
 * nothing in this file has to know the setting exists.
 */

import {
  addMonths,
  isDay,
  monthEnd,
  monthStart,
  shiftDay,
  writeDay,
  writeDayLong,
  type Window,
} from "@/lib/pos/history";
import type { FiscalYearStart, ShopSettings } from "@/lib/pos/settings-options";

export { isDay, writeDay, writeDayLong, type Window };

/* -------------------------------------------------------------------------- */
/*  The periods                                                               */
/* -------------------------------------------------------------------------- */

export type ReportRangeId =
  | "7d"
  | "30d"
  | "this-month"
  | "last-month"
  | "90d"
  | "this-year"
  | "last-year"
  | "custom";

/** What the screen opens on. A month is the unit a shop's own questions come
 *  in — "how did September go" — where the sales history opens on today,
 *  because that is the bill somebody is holding. */
export const DEFAULT_RANGE: ReportRangeId = "this-month";

/**
 * The periods, in the order an owner reaches for them, with the financial year
 * written out from the shop's own setting.
 *
 * A function rather than a constant precisely because of that last part: "This
 * financial year" means July in Lahore and January in a shop that set it to
 * January, and a period list that said "From 1 July" to both of them would be
 * wrong for one of them on the screen where being wrong costs the most.
 */
export function reportRanges(
  settings: ShopSettings,
  today: string,
): { id: ReportRangeId; label: string; note: string }[] {
  const fyStarts = writeDay(`2000-${settings.fiscalYearStarts}`);

  return [
    { id: "7d", label: "Last 7 days", note: "This one and the six before" },
    { id: "30d", label: "Last 30 days", note: "A month of trading" },
    { id: "this-month", label: "This month", note: "From the 1st to today" },
    { id: "last-month", label: "Last month", note: "The whole of it" },
    { id: "90d", label: "Last 90 days", note: "A quarter of trading" },
    {
      id: "this-year",
      label: "This financial year",
      note: `From ${fyStarts} to today`,
    },
    {
      id: "last-year",
      label: "Last financial year",
      note: `The twelve months to ${writeDay(shiftDay(fiscalStart(today, settings.fiscalYearStarts), -1))}`,
    },
    { id: "custom", label: "Pick your own dates…", note: "Any two days" },
  ];
}

const REPORT_RANGE_IDS: ReportRangeId[] = [
  "7d",
  "30d",
  "this-month",
  "last-month",
  "90d",
  "this-year",
  "last-year",
  "custom",
];

export const isReportRange = (value: unknown): value is ReportRangeId =>
  REPORT_RANGE_IDS.includes(value as ReportRangeId);

/**
 * The first day of the financial year `day` falls in.
 *
 * Compared as strings, which works because both sides are `YYYY-MM-DD` and
 * that sorts the same way the calendar does — the reason every date in this
 * codebase is stored and passed around in that spelling.
 */
function fiscalStart(day: string, start: FiscalYearStart): string {
  const year = Number(day.slice(0, 4));
  const begins = `${year}-${start}`;
  return day >= begins ? begins : `${year - 1}-${start}`;
}

export type ReportWindow = {
  from: string;
  to: string;
  /** Trading days covered, both ends counted. */
  days: number;
  /** The equally long stretch immediately before, for every "vs" figure on the
   *  screen. One rule for every period, so the comparison never needs its own
   *  explanation — see `EXPLAIN.previous`. */
  previous: Window;
};

const DAY_MS = 86_400_000;

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;

/**
 * A period into two trading days, and the stretch before it.
 *
 * `today` is the shop's own current business day, resolved on the server and
 * handed in, so the browser never decides what day it is — a counter tablet
 * bought in Dubai and shipped to Lahore keeps the wrong clock for months.
 *
 * Both ends are clamped to `today` for the reason `businessWindow` in
 * `dashboard.ts` clamps: at 1 am in a shop that shuts at 3 the calendar says
 * today and the books still say yesterday, so a window running past the shop's
 * own current day is asking for a day that has not opened, and it would come
 * back empty with a shop full of customers.
 */
export function resolveReportWindow(
  id: ReportRangeId,
  today: string,
  settings: ShopSettings,
  custom?: { from?: string; to?: string },
): ReportWindow {
  const window = periodOf(id, today, settings, custom);

  const to = window.to > today ? today : window.to;
  const from = window.from > to ? to : window.from;
  const days = daysBetween(from, to);

  return {
    from,
    to,
    days,
    previous: { from: shiftDay(from, -days), to: shiftDay(from, -1) },
  };
}

function periodOf(
  id: ReportRangeId,
  today: string,
  settings: ShopSettings,
  custom?: { from?: string; to?: string },
): Window {
  if (id === "custom") {
    const from = isDay(custom?.from) ? custom.from : monthStart(today);
    const to = isDay(custom?.to) ? custom.to : today;
    // The ends the wrong way round is how a mis-tap looks, and there is exactly
    // one thing it can have meant. Swapped rather than refused.
    return from <= to ? { from, to } : { from: to, to: from };
  }

  if (id === "7d") return { from: shiftDay(today, -6), to: today };
  if (id === "30d") return { from: shiftDay(today, -29), to: today };
  if (id === "90d") return { from: shiftDay(today, -89), to: today };
  if (id === "this-month") return { from: monthStart(today), to: today };

  if (id === "last-month") {
    const last = addMonths(monthStart(today), -1);
    return { from: last, to: monthEnd(last) };
  }

  const opens = fiscalStart(today, settings.fiscalYearStarts);

  if (id === "last-year") {
    const year = Number(opens.slice(0, 4)) - 1;
    return { from: `${year}-${settings.fiscalYearStarts}`, to: shiftDay(opens, -1) };
  }

  return { from: opens, to: today };
}

/**
 * The window in its own words, for the button that opens the period menu.
 *
 * A named period keeps its name — "Last month" says more about what you are
 * looking at than the two dates it resolved to. Only a custom range spells them
 * out, because nothing else can.
 */
export function writeReportWindow(
  id: ReportRangeId,
  window: ReportWindow,
  settings: ShopSettings,
  today: string,
): string {
  if (id !== "custom") {
    return (
      reportRanges(settings, today).find((range) => range.id === id)?.label ??
      "This month"
    );
  }

  if (window.from === window.to) return writeDayLong(window.from);
  return `${writeDay(window.from)} – ${writeDayLong(window.to)}`;
}

/* -------------------------------------------------------------------------- */
/*  The arithmetic                                                            */
/* -------------------------------------------------------------------------- */

export const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Profit as a percentage of sales, not of cost.
 *
 * Worth being explicit about, because the two are different numbers and a shop
 * buying at 80 and selling at 100 will hear "25%" from a supplier and read
 * "20%" here. Margin is the share of the rupee that stayed, which is the one
 * that answers "can the shop afford the rent". `EXPLAIN.margin` says so on the
 * screen rather than leaving the owner to work out which convention this is.
 */
export const marginOf = (sales: number, cost: number) =>
  sales > 0 ? ((sales - cost) / sales) * 100 : 0;

/** A part over a whole, 0–1, with nothing to divide by handled as nothing. */
export const shareOf = (part: number, whole: number) =>
  whole > 0 ? part / whole : 0;

export type Totals = {
  sales: number;
  cost: number;
  profit: number;
  margin: number;
  /** Completed bills. Held and returned ones are not takings. */
  bills: number;
  /** Lines on those bills — see `EXPLAIN.lines` for why this is not "items". */
  lines: number;
  discount: number;
  average: number;
};

export const EMPTY_TOTALS: Totals = {
  sales: 0,
  cost: 0,
  profit: 0,
  margin: 0,
  bills: 0,
  lines: 0,
  discount: 0,
  average: 0,
};

/** The four derived figures, worked out in one place so the day table, the
 *  KPI row and the CSV cannot each round differently. */
export function totalsOf(raw: {
  sales: number;
  cost: number;
  bills: number;
  lines: number;
  discount: number;
}): Totals {
  const sales = round2(raw.sales);
  const cost = round2(raw.cost);

  return {
    sales,
    cost,
    profit: round2(sales - cost),
    margin: marginOf(sales, cost),
    bills: raw.bills,
    lines: raw.lines,
    discount: round2(raw.discount),
    average: raw.bills > 0 ? round2(sales / raw.bills) : 0,
  };
}

export type Delta = { pct: number; direction: "up" | "down" | "flat" };

/**
 * Change against the previous window. "Flat" is anything inside half a point,
 * because a report that says +0.2% trains people to ignore the whole column. A
 * previous window of zero has no percentage to give — a first month of trading
 * is new, not infinitely up.
 */
export function delta(current: number, previous: number): Delta | null {
  if (previous <= 0) return null;

  const pct = ((current - previous) / previous) * 100;
  return {
    pct,
    direction: Math.abs(pct) < 0.5 ? "flat" : pct > 0 ? "up" : "down",
  };
}

/* -------------------------------------------------------------------------- */
/*  The rows                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * How the day table is bucketed.
 *
 * A quarter drawn one row per day is 90 rows an owner scrolls past without
 * reading; a month drawn one row per month is one row. Sixty-two days is the
 * line — two months of daily rows is still a table you can scan, and anything
 * longer is a question about months.
 */
export type Grain = "day" | "month";

export const grainOf = (days: number): Grain => (days > 62 ? "month" : "day");

export type DayRow = {
  /** The first trading day of the bucket, `YYYY-MM-DD`. */
  day: string;
  /** "16 Sep" or "Sep 2026", depending on the grain. */
  label: string;
  sales: number;
  cost: number;
  profit: number;
  margin: number;
  bills: number;
  lines: number;
  average: number;
};

const MONTH = new Intl.DateTimeFormat("en-PK", {
  timeZone: "UTC",
  month: "short",
  year: "numeric",
});

/** "Sep 2026" — a month in a table cell. */
export const writeMonth = (day: string) =>
  MONTH.format(Date.parse(`${day}T00:00:00Z`));

/**
 * The days the shop took money into one row per day, or per month.
 *
 * **Every bucket in the window appears, whether or not it sold anything.** A
 * Friday the shop was shut is a zero and not a gap: a table that skipped it
 * would draw the month as though it had 25 days, and the first thing an owner
 * does with this table is count the bad days.
 */
export function rollDays(
  window: ReportWindow,
  rows: { at: string; sales: number; cost: number; bills: number; lines: number }[],
  grain: Grain,
): DayRow[] {
  const byDay = new Map(rows.map((row) => [row.at, row]));
  const buckets = new Map<string, { sales: number; cost: number; bills: number; lines: number }>();

  for (let index = 0; index < window.days; index += 1) {
    const day = shiftDay(window.from, index);
    const key = grain === "month" ? monthStart(day) : day;

    const bucket = buckets.get(key) ?? { sales: 0, cost: 0, bills: 0, lines: 0 };
    const row = byDay.get(day);

    if (row) {
      bucket.sales += row.sales;
      bucket.cost += row.cost;
      bucket.bills += row.bills;
      bucket.lines += row.lines;
    }

    buckets.set(key, bucket);
  }

  return [...buckets].map(([day, bucket]) => {
    const totals = totalsOf({ ...bucket, discount: 0 });

    return {
      day,
      label: grain === "month" ? writeMonth(day) : writeDay(day),
      sales: totals.sales,
      cost: totals.cost,
      profit: totals.profit,
      margin: totals.margin,
      bills: totals.bills,
      lines: totals.lines,
      average: totals.average,
    };
  });
}

export type ProductRow = {
  key: string;
  name: string;
  unit: string;
  department: string;
  quantity: number;
  sales: number;
  cost: number;
  profit: number;
  margin: number;
  bills: number;
  /** Share of the window's sales, 0–1. */
  share: number;
};

export type GroupRow = {
  name: string;
  sales: number;
  cost: number;
  profit: number;
  margin: number;
  lines: number;
  share: number;
};

export type CategoryRow = GroupRow & { department: string };

export type TenderRow = {
  method: string;
  label: string;
  amount: number;
  bills: number;
  share: number;
};

export type PersonRow = {
  id: string | null;
  name: string;
  sales: number;
  cost: number;
  profit: number;
  margin: number;
  bills: number;
  average: number;
  share: number;
};

export type HourRow = {
  hour: number;
  label: string;
  sales: number;
  bills: number;
  /** Against the busiest hour in the window, for the meter bar. */
  share: number;
};

export type ReportData = {
  window: ReportWindow;
  totals: Totals;
  previous: Totals;
  days: DayRow[];
  hours: HourRow[];
  products: ProductRow[];
  /** Every distinct item sold in the window, counted by the database. More
   *  than `products.length` is a window that hit `PRODUCT_MAX`. */
  productCount: number;
  departments: GroupRow[];
  categories: CategoryRow[];
  tenders: TenderRow[];
  counters: PersonRow[];
  cashiers: PersonRow[];
};

/**
 * The most items one window will list.
 *
 * Matches the `limit` in `reports_summary`. Five hundred rows of a shop's best
 * sellers is a page nobody scrolls to the end of, and the tail is counted
 * rather than hidden — the screen says "the top 500 of 1,342 items sold" and
 * names the control that narrows it, the same bargain `HISTORY_MAX` strikes.
 */
export const PRODUCT_MAX = 500;

/** What an item with no department reads as. `sale_lines` keeps the name a
 *  thing was sold under and not where it was filed, so an item since deleted
 *  has no department — that money is still the shop's and is named rather than
 *  dropped. */
export const UNFILED = "Not filed";

/** A category that was never set. Category is optional on an item by design:
 *  department is the filing, category is the refinement. */
export const UNCATEGORISED = "No category";

/* -------------------------------------------------------------------------- */
/*  How every figure is worked out                                            */
/* -------------------------------------------------------------------------- */

export type Explainer = {
  /** The sum in symbols, for somebody who wants the arithmetic. Left off where
   *  a figure is counted rather than calculated. */
  formula?: string;
  /** The same thing in the shop's own words, for somebody who wants the
   *  answer. Always present — the formula is the footnote, not the point. */
  plain: string;
};

/**
 * The one place that says how a figure is worked out.
 *
 * Every hover tip on `/app/reports` reads from here, and so does every caption
 * that quotes a sum. The rule this enforces is the whole reason the file
 * exists: **a number on this screen has exactly one explanation**, and it is
 * the same one whether the owner hovers the KPI, hovers the column, or opens
 * the CSV.
 *
 * Written the way a shopkeeper would say it, not the way an accountant would.
 * "What is left after what you paid your supplier" is a sentence somebody acts
 * on; "gross profit" is a sentence somebody nods at.
 */
export const EXPLAIN = {
  /* ---- the window itself ---- */
  window: {
    plain:
      "Every figure here is counted over trading days, not clock days. A shop that shuts at 1 am gets that last hour on the day it opened, exactly as the register stamped it.",
  },
  previous: {
    formula: "the same number of days, immediately before",
    plain:
      "Each “vs” compares this period against the stretch of the same length just before it. Thirty days is compared with the thirty before, a month with the month before.",
  },
  completed: {
    plain:
      "Only completed bills are counted. A held bill has not been paid for and a returned one has been given back, so neither is takings.",
  },

  /* ---- money ---- */
  sales: {
    formula: "total of every completed bill",
    plain:
      "What customers actually paid, added up across every bill rung up in this period. It is the bill total, so nothing is added or taken off after it.",
  },
  cost: {
    formula: "cost when sold × quantity, added up over every line",
    plain:
      "What the goods you sold had cost you. Each line carries the cost price as it stood the moment it was rung up, so a supplier raising a price tomorrow does not rewrite last month.",
  },
  profit: {
    formula: "Sales − Cost of goods",
    plain:
      "What is left after what you paid your supplier. It is before rent, wages, bills and everything else the shop spends — Flo does not know those yet.",
  },
  margin: {
    formula: "Profit ÷ Sales × 100",
    plain:
      "How much of every hundred rupees that came in stayed with you. Note this is out of the selling price, not out of the cost — a supplier quoting you “25% on cost” is the same as 20% here.",
  },
  costGap: {
    plain:
      "An item you never filled a cost price in for counts as costing nothing, so it reads as pure profit. Fill in cost prices on Products and this figure corrects itself.",
  },
  discount: {
    plain:
      "Taken off bills before they were paid. The register cannot discount a bill yet, so this stays at zero until it can.",
  },

  /* ---- counts ---- */
  bills: {
    plain:
      "How many separate completed bills were rung up. One customer buying twelve things is one bill.",
  },
  average: {
    formula: "Sales ÷ Bills",
    plain:
      "What a typical customer spent in one visit. It is the quickest thing to move — one more item suggested at the counter lifts it on every bill.",
  },
  lines: {
    formula: "one per item on a bill",
    plain:
      "How many lines were rung up. Two kilos of sugar is one line, not two — this counts trips to the scanner, not units sold.",
  },
  quantity: {
    plain:
      "How much of this item went out the door, in its own unit — pieces, kilos, litres. Only ever added up within one item, because two kilos and two pieces are not four of anything.",
  },

  /* ---- shares and groupings ---- */
  share: {
    formula: "this row's sales ÷ everything sold in the period × 100",
    plain:
      "How much of the period's sales this row accounts for. Departments add up to a hundred, and so do categories; the item list only does when it is showing every item sold.",
  },
  department: {
    plain:
      "Read from where the item is filed on Products today. An item you have since deleted kept its name on the bill but not its shelf, so its money is shown as “Not filed” rather than dropped.",
  },
  tender: {
    plain:
      "Counted from what was actually handed over, not from the bill total, so a bill settled two ways would show in both rows the day the register can split one.",
  },
  counter: {
    plain:
      "Which till rang the bill up. A counter you have since deleted keeps its takings and loses its name — the money was still the shop's.",
  },
  cashier: {
    plain:
      "Who was signed in when the bill was rung up. Somebody who has since left keeps their sales; the bills are the shop's record, not theirs.",
  },
  hour: {
    plain:
      "Every bill in the period sorted into the hour of day it was rung up, in your shop's own timezone. This is the staffing question — the busiest hour of a whole month, not of one day.",
  },

  /* ---- stock ---- */
  stockCost: {
    formula: "stock on hand × cost price, added up",
    plain:
      "What the goods on your shelves cost you. This is money sitting in the shop rather than in the bank.",
  },
  stockRetail: {
    formula: "stock on hand × selling price, added up",
    plain:
      "What those same shelves would bring in if every unit sold at today's price. Nothing is reserved for spoilage or theft.",
  },
  stockGap: {
    formula: "Stock at retail − Stock at cost",
    plain:
      "The profit still sitting on the shelf, waiting to be sold. It is not money you have.",
  },
  stockLow: {
    plain:
      "Items at or below the low-stock level you set on that item. Each item has its own — a shop does not reorder rice and razor blades at the same number.",
  },
  stockToday: {
    plain:
      "Stock is counted as it stands right now, not as it stood during the period above. There is no stock ledger yet, so Flo cannot rewind what was on the shelf.",
  },
} as const satisfies Record<string, Explainer>;

export type ExplainKey = keyof typeof EXPLAIN;

/* -------------------------------------------------------------------------- */
/*  Off the screen and into a spreadsheet                                     */
/* -------------------------------------------------------------------------- */

const escape = (value: string) =>
  /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/**
 * A heading row and its rows into a CSV file.
 *
 * Money goes out as bare numbers with the currency in the column heading, never
 * as "Rs 1,250.00" — a spreadsheet cannot add up a string, and adding it up is
 * the one thing anybody does with this file. The leading BOM is what makes
 * Excel on a Windows machine read it as UTF-8, without which an item named in
 * Urdu arrives as mojibake. Both are the same calls `billsToCsv` makes.
 */
export function toCsv(header: string[], rows: (string | number)[][]): string {
  const lines = [header, ...rows].map((row) =>
    row.map((cell) => escape(String(cell))).join(","),
  );

  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Two decimals and no separators, which is what a spreadsheet can add up. */
const cash = (value: number) => value.toFixed(2);
const pct = (value: number) => value.toFixed(1);

export type CsvOptions = { currency: string };

export function daysToCsv(
  rows: DayRow[],
  { currency, grain }: CsvOptions & { grain: Grain },
): string {
  return toCsv(
    [
      grain === "month" ? "Month" : "Trading day",
      "Bills",
      "Lines",
      `Sales (${currency})`,
      `Cost of goods (${currency})`,
      `Profit (${currency})`,
      "Margin (%)",
      `Average bill (${currency})`,
    ],
    rows.map((row) => [
      grain === "month" ? row.label : row.day,
      row.bills,
      row.lines,
      cash(row.sales),
      cash(row.cost),
      cash(row.profit),
      pct(row.margin),
      cash(row.average),
    ]),
  );
}

export function productsToCsv(rows: ProductRow[], { currency }: CsvOptions): string {
  return toCsv(
    [
      "Item",
      "Department",
      "Unit",
      "Quantity sold",
      "Bills",
      `Sales (${currency})`,
      `Cost of goods (${currency})`,
      `Profit (${currency})`,
      "Margin (%)",
      "Share of sales (%)",
    ],
    rows.map((row) => [
      row.name,
      row.department,
      row.unit,
      row.quantity,
      row.bills,
      cash(row.sales),
      cash(row.cost),
      cash(row.profit),
      pct(row.margin),
      pct(row.share * 100),
    ]),
  );
}

export function groupsToCsv(
  rows: (GroupRow & { department?: string })[],
  { currency, heading }: CsvOptions & { heading: string },
): string {
  const nested = rows.some((row) => row.department !== undefined);

  return toCsv(
    [
      ...(nested ? ["Department"] : []),
      heading,
      "Lines",
      `Sales (${currency})`,
      `Cost of goods (${currency})`,
      `Profit (${currency})`,
      "Margin (%)",
      "Share of sales (%)",
    ],
    rows.map((row) => [
      ...(nested ? [row.department ?? ""] : []),
      row.name,
      row.lines,
      cash(row.sales),
      cash(row.cost),
      cash(row.profit),
      pct(row.margin),
      pct(row.share * 100),
    ]),
  );
}

export function peopleToCsv(
  rows: PersonRow[],
  { currency, heading }: CsvOptions & { heading: string },
): string {
  return toCsv(
    [
      heading,
      "Bills",
      `Sales (${currency})`,
      `Cost of goods (${currency})`,
      `Profit (${currency})`,
      "Margin (%)",
      `Average bill (${currency})`,
      "Share of sales (%)",
    ],
    rows.map((row) => [
      row.name,
      row.bills,
      cash(row.sales),
      cash(row.cost),
      cash(row.profit),
      pct(row.margin),
      cash(row.average),
      pct(row.share * 100),
    ]),
  );
}

export function tendersToCsv(rows: TenderRow[], { currency }: CsvOptions): string {
  return toCsv(
    ["Paid by", "Bills", `Taken (${currency})`, "Share of takings (%)"],
    rows.map((row) => [
      row.label,
      row.bills,
      cash(row.amount),
      pct(row.share * 100),
    ]),
  );
}

export function hoursToCsv(rows: HourRow[], { currency }: CsvOptions): string {
  return toCsv(
    ["Hour", "Bills", `Sales (${currency})`],
    rows.map((row) => [row.label, row.bills, cash(row.sales)]),
  );
}

export type StockRow = {
  id: string;
  name: string;
  department: string;
  unit: string;
  stock: number;
  lowAt: number;
  cost: number;
  price: number;
  /** stock × cost. */
  atCost: number;
  /** stock × price. */
  atRetail: number;
  state: "out" | "low" | "ok";
};

export function stockToCsv(rows: StockRow[], { currency }: CsvOptions): string {
  return toCsv(
    [
      "Item",
      "Department",
      "Unit",
      "On hand",
      "Low at",
      `Cost price (${currency})`,
      `Selling price (${currency})`,
      `Value at cost (${currency})`,
      `Value at retail (${currency})`,
      "State",
    ],
    rows.map((row) => [
      row.name,
      row.department,
      row.unit,
      row.stock,
      row.lowAt,
      cash(row.cost),
      cash(row.price),
      cash(row.atCost),
      cash(row.atRetail),
      row.state === "out" ? "Out of stock" : row.state === "low" ? "Running low" : "In stock",
    ]),
  );
}

/** `flo-products-2026-09-01-to-2026-09-16.csv` — the report and the window are
 *  both in the name, so four exports in a downloads folder are told apart
 *  without opening any of them. */
export const csvFilename = (report: string, window: Window) =>
  window.from === window.to
    ? `flo-${report}-${window.from}.csv`
    : `flo-${report}-${window.from}-to-${window.to}.csv`;
