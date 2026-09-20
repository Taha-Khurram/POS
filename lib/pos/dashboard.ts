import "server-only";

import { cookies } from "next/headers";

import { businessDayOf, currentBusinessDay, round2 } from "@/lib/pos/counter";
import { writeClock, writeDay } from "@/lib/pos/history";
import { writeReadError } from "@/lib/pos/read-error";
import type { ShopSettings } from "@/lib/pos/settings-options";
import type { Timeframe } from "@/lib/pos/timeframes";
import { createClient } from "@/utils/supabase/server";

/**
 * The dashboard's figures.
 *
 * Real rows since 0019. Everything on `/app` is one call to
 * `public.dashboard_summary` — the current window and the one before it, the
 * trend, the departments, the best sellers and the last eight bills, grouped in
 * Postgres and added up there. A month of a busy kiryana is tens of thousands
 * of sale lines, and `takings.ts`'s bargain (fetch the rows, total them in
 * TypeScript) stops being the right one somewhere around the end of a week.
 *
 * Read through the shop's own JWT rather than the service role, like every
 * other reader in `lib/pos/`: the function is `security invoker`, so RLS is the
 * gate and `p_tenant` is only a filter. It doubles as a live check that the
 * access-token hook is stamping claims — a service-role read would return the
 * dashboard with the hook switched off and hide the one failure that breaks
 * everything else.
 *
 * Deliberately NOT wrapped in React `cache()`, for the reason none of the
 * readers in `shop.ts`, `items.ts`, `customers.ts` or `bills.ts` are: a Server
 * Action plus the re-render its `revalidatePath` triggers are one request, and
 * a memoised read would hand that re-render the shop as it stood before the
 * write.
 *
 * **The window is `sales.business_day`, never a timestamp.** The register
 * stamped it once from the shop's own `day_ends_at`, so a dhaba that shuts at
 * 1 am gets its last hour on the day it opened and this file never learns the
 * setting exists. The time filter resolves to instants because it also has to
 * fill two date inputs; `businessWindow` below is where those become trading
 * days, and it is the only place the two ideas touch.
 *
 * One honest gap remains, worth knowing before anyone quotes profit: a line's
 * cost is `sale_lines.cost_snapshot`, stamped at the moment of sale, and it is
 * zero for anything sold before 0019 that has since lost its catalog row, and
 * for any item whose cost the shop never filled in. Both show as pure profit
 * rather than as unknown, which is the wrong way round — but a margin of 100%
 * on the Products screen is the same signal, and it is one an owner already
 * knows how to read.
 */

export type TenderMethod =
  | "cash"
  | "card"
  | "raast"
  | "easypaisa"
  | "jazzcash";

export type SaleStatus = "completed" | "held" | "refund";

export type TrendPoint = {
  /** Axis label, already in the shop's own words. */
  label: string;
  sales: number;
  profit: number;
};

export type CategorySlice = {
  name: string;
  sales: number;
  /** 0–1 share of the window's sales. */
  share: number;
};

export type RecentSale = {
  id: string;
  receipt: string;
  /** "2:41 pm", in the shop's timezone. */
  at: string;
  items: number;
  /** Null for a bill with no tender row at all, which a held one will be. */
  method: TenderMethod | null;
  /** More than one tender against the bill, so `method` is the larger half. */
  split: boolean;
  total: number;
  status: SaleStatus;
};

export type TopProduct = {
  name: string;
  unit: string;
  quantity: number;
  sales: number;
  /** 0–1 against the best seller, for the meter bar. */
  share: number;
};

export type PeriodTotals = {
  sales: number;
  profit: number;
  cost: number;
  /** Percent, 0–100. */
  margin: number;
  transactions: number;
};

export type DashboardData = {
  /** The trading days every figure below was read from. Handed back rather than
   *  left implicit because the filter's window and the shop's are not always
   *  the same one — see `businessWindow` — and the page captions what it drew. */
  window: BusinessWindow;
  totals: PeriodTotals;
  /** The equally long window immediately before, for the "vs" figures. */
  previous: PeriodTotals;
  trend: TrendPoint[];
  categories: CategorySlice[];
  recent: RecentSale[];
  topProducts: TopProduct[];
};

export type Delta = {
  /** Percent change against the comparison window. */
  pct: number;
  direction: "up" | "down" | "flat";
};

/**
 * Change against the previous window. "Flat" is anything inside half a point,
 * because a KPI that reports +0.2% every morning trains people to ignore the
 * whole row. A previous window of zero has no percentage to give — a first week
 * of trading is new, not infinitely up.
 */
export function delta(current: number, previous: number): Delta | null {
  if (previous <= 0) return null;

  const pct = ((current - previous) / previous) * 100;
  return {
    pct,
    direction: Math.abs(pct) < 0.5 ? "flat" : pct > 0 ? "up" : "down",
  };
}

/* ---------------- The window, as trading days ---------------- */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar date an instant falls on in the shop's timezone. A business day
 *  with the cut at midnight *is* the calendar day, which is what makes this a
 *  reuse rather than a second implementation of the same arithmetic. */
const calendarDay = (at: Date, timezone: string) =>
  businessDayOf(at, timezone, "00:00");

const shiftDay = (day: string, by: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + by * DAY_MS).toISOString().slice(0, 10);

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;

export type BusinessWindow = {
  from: string;
  to: string;
  days: number;
  previous: { from: string; to: string };
};

/**
 * The time filter's instants into the trading days the register actually
 * stamped.
 *
 * The clamp at the top end is the part that earns its keep. At 1 am in a shop
 * that shuts at 3, the calendar says today and the books still say yesterday;
 * a window running to the calendar date would be asking for a day that has not
 * opened, and "today" would come back empty with a shop full of customers.
 */
export function businessWindow(
  range: Timeframe,
  settings: ShopSettings,
): BusinessWindow {
  const today = currentBusinessDay(settings);
  const opens = calendarDay(range.from, settings.timezone);
  // `range.to` is exclusive, so the last day in the window is the one the
  // instant a millisecond before it falls on.
  const shuts = calendarDay(new Date(range.to.getTime() - 1), settings.timezone);

  const to = shuts > today ? today : shuts;
  const from = opens > to ? to : opens;
  const days = daysBetween(from, to);

  return {
    from,
    to,
    days,
    previous: { from: shiftDay(from, -days), to: shiftDay(from, -1) },
  };
}

/* ---------------- What the function hands back ---------------- */

type Money = { sales: number | string | null; cost: number | string | null };

type SummaryRow = {
  totals?: (Money & { bills: number | string | null }) | null;
  previous?: (Money & { bills: number | string | null }) | null;
  days?: (Money & { at: string })[] | null;
  hours?: (Money & { at: number })[] | null;
  departments?: { name: string; sales: number | string | null }[] | null;
  products?: {
    name: string;
    unit: string;
    quantity: number | string | null;
    sales: number | string | null;
  }[] | null;
  recent?: {
    id: string;
    receipt: string;
    at: string;
    items: number | string | null;
    method: string | null;
    split: boolean | null;
    total: number | string | null;
    status: string;
  }[] | null;
};

/** Every money column arrives as a string: `numeric` has more precision than a
 *  JSON number can carry, so PostgREST does not guess. */
const num = (value: number | string | null | undefined) => Number(value) || 0;

const TENDERS: TenderMethod[] = ["cash", "card", "raast", "easypaisa", "jazzcash"];
const STATUSES: SaleStatus[] = ["completed", "held", "refund"];

const EMPTY_TOTALS: PeriodTotals = {
  sales: 0,
  profit: 0,
  cost: 0,
  margin: 0,
  transactions: 0,
};

function totalsOf(row: Money & { bills: number | string | null }): PeriodTotals {
  const sales = round2(num(row.sales));
  const cost = round2(num(row.cost));
  const profit = round2(sales - cost);

  return {
    sales,
    cost,
    profit,
    margin: sales > 0 ? (profit / sales) * 100 : 0,
    transactions: num(row.bills),
  };
}

/* ---------------- The trend ---------------- */

/** "2 pm". Built from the bucket number rather than from an instant, because
 *  the hour is already the shop's own — Postgres shifted it before grouping. */
const writeHour = (hour: number) =>
  `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "am" : "pm"}`;

const point = (label: string, sales: number, cost: number): TrendPoint => ({
  label,
  sales: round2(sales),
  profit: round2(sales - cost),
});

/**
 * One day, split by hour.
 *
 * The frame runs from the first hour that took money to the last, so a shop
 * that opens at seven is not given six empty columns to prove it was shut. A
 * day with nothing on it yet gets a 9-to-9 frame rather than no axis at all:
 * an empty chart with hours on it reads as "nothing sold", and an empty chart
 * with nothing on it reads as broken.
 */
function hourlyTrend(rows: (Money & { at: number })[]): TrendPoint[] {
  const byHour = new Map(rows.map((row) => [row.at, row]));
  const hours = rows.map((row) => row.at);
  const first = hours.length > 0 ? Math.min(...hours) : 9;
  const last = hours.length > 0 ? Math.max(...hours) : 21;

  const points: TrendPoint[] = [];
  for (let hour = first; hour <= last; hour += 1) {
    const row = byHour.get(hour);
    points.push(point(writeHour(hour), num(row?.sales), num(row?.cost)));
  }
  return points;
}

/**
 * A window of trading days.
 *
 * Every day in the window is a point, whether or not it sold anything — a
 * closed Friday is a gap in the line, and a chart that skipped it would draw
 * the week as though it never happened. Beyond about a month a daily axis is
 * unreadable, so days are rolled up into weeks from the start of the window.
 */
function dailyTrend(
  window: BusinessWindow,
  rows: (Money & { at: string })[],
): TrendPoint[] {
  const byDay = new Map(rows.map((row) => [row.at, row]));
  const step = window.days > 31 ? 7 : 1;
  const points: TrendPoint[] = [];

  for (let index = 0; index < window.days; index += step) {
    const opens = shiftDay(window.from, index);
    let sales = 0;
    let cost = 0;

    for (let offset = 0; offset < step && index + offset < window.days; offset += 1) {
      const row = byDay.get(shiftDay(window.from, index + offset));
      sales += num(row?.sales);
      cost += num(row?.cost);
    }

    points.push(point(step === 1 ? writeDay(opens) : `w/c ${writeDay(opens)}`, sales, cost));
  }

  return points;
}

/* ---------------- The rest of the screen ---------------- */

/** An item since deleted kept its name on the bill and not where it was filed,
 *  and an item nobody filed never had a department. Both are real money and
 *  both are named rather than dropped. */
const UNFILED = "Not filed";

/** Six bars is what the card has room for. A shop with forty departments still
 *  has to see all of its money, so the tail is summed rather than cut off. */
const DEPARTMENT_BARS = 6;

function categoriesOf(
  rows: { name: string; sales: number | string | null }[],
): CategorySlice[] {
  const ranked = rows
    .map((row) => ({ name: row.name.trim() || UNFILED, sales: round2(num(row.sales)) }))
    .filter((row) => row.sales > 0);

  const total = ranked.reduce((sum, row) => sum + row.sales, 0);
  if (total <= 0) return [];

  const head = ranked.slice(0, DEPARTMENT_BARS);
  const tail = ranked.slice(DEPARTMENT_BARS);

  if (tail.length > 0) {
    head.push({
      name: `${tail.length} more departments`,
      sales: round2(tail.reduce((sum, row) => sum + row.sales, 0)),
    });
  }

  // Share of the departments' own sum rather than of `sales.total`, so the
  // percentages on the card add up to a hundred. The two agree to the rupee
  // today — nothing discounts a bill — and this is what keeps them agreeing
  // the day something does.
  return head.map((row) => ({ ...row, share: row.sales / total }));
}

function productsOf(
  rows: {
    name: string;
    unit: string;
    quantity: number | string | null;
    sales: number | string | null;
  }[],
): TopProduct[] {
  const best = Math.max(...rows.map((row) => num(row.sales)), 1);

  return rows.map((row) => ({
    name: row.name,
    unit: row.unit,
    quantity: num(row.quantity),
    sales: round2(num(row.sales)),
    share: num(row.sales) / best,
  }));
}

function recentOf(
  rows: NonNullable<SummaryRow["recent"]>,
  timezone: string,
): RecentSale[] {
  return rows.map((row) => ({
    id: row.id,
    receipt: row.receipt,
    at: writeClock(row.at, timezone),
    items: num(row.items),
    method: TENDERS.includes(row.method as TenderMethod)
      ? (row.method as TenderMethod)
      : null,
    split: row.split === true,
    total: round2(num(row.total)),
    // A status the column allows and this file has not heard of is a schema
    // that moved; showing the bill as paid would be the one wrong answer.
    status: STATUSES.includes(row.status as SaleStatus)
      ? (row.status as SaleStatus)
      : "held",
  }));
}

/* ---------------- The read ---------------- */

const empty = (window: BusinessWindow): DashboardData => ({
  window,
  totals: EMPTY_TOTALS,
  previous: EMPTY_TOTALS,
  trend: window.days === 1 ? hourlyTrend([]) : dailyTrend(window, []),
  categories: [],
  recent: [],
  topProducts: [],
});

/**
 * Everything the dashboard renders, for one shop and one window.
 *
 * `tenantId` is nullable because an account that is not attached to a shop yet
 * still reaches this screen to be told so — the layout's rail and the dashboard
 * both fall back rather than fail, and that has to stay true. It gets a shop
 * that has sold nothing, which is exactly what it has.
 */
export async function getDashboardData(
  tenantId: string | null,
  range: Timeframe,
  settings: ShopSettings,
): Promise<DashboardData> {
  const window = businessWindow(range, settings);

  if (!tenantId) return empty(window);

  const supabase = createClient(await cookies());

  const { data, error } = await supabase.rpc("dashboard_summary", {
    p_tenant: tenantId,
    p_from: window.from,
    p_to: window.to,
    p_prev_from: window.previous.from,
    p_prev_to: window.previous.to,
    p_timezone: settings.timezone,
  });

  if (error) {
    // A dashboard that throws is a console an owner cannot get into. Zeroes are
    // wrong, but they are wrong in a way that is visible on the screen and in
    // the log, where a crash is only visible in the log — so the log has to say
    // something. A PostgrestError handed to `console.error` whole prints as
    // `{}`; see `writeReadError`.
    console.error(`[dashboard] summary failed — ${writeReadError(error)}`);
    return empty(window);
  }

  const row = (data ?? {}) as SummaryRow;

  return {
    window,
    totals: totalsOf(row.totals ?? { sales: 0, cost: 0, bills: 0 }),
    previous: totalsOf(row.previous ?? { sales: 0, cost: 0, bills: 0 }),
    // `window.days`, not `range.bucket`: the filter counts calendar days and
    // the clamp can turn its answer into one trading day — a 1 am "today" in a
    // shop that shuts at 3 — and `hours` is only filled for the single-day
    // case. Splitting on the same number the function did keeps the axis and
    // the rows from disagreeing about which chart this is.
    trend:
      window.days === 1
        ? hourlyTrend(row.hours ?? [])
        : dailyTrend(window, row.days ?? []),
    categories: categoriesOf(row.departments ?? []),
    topProducts: productsOf(row.products ?? []),
    recent: recentOf(row.recent ?? [], settings.timezone),
  };
}
