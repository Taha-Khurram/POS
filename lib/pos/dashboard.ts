import "server-only";

import type { Timeframe } from "./timeframes";

/**
 * The dashboard's data contract.
 *
 * Every figure below is shaped the way the register's tables already store it —
 * `method` and `status` are the exact check constraints from
 * `0008_register_foundation.sql`, so wiring this to real rows is a query swap,
 * not a refactor of the page.
 *
 * Two honest gaps, both worth knowing before anyone quotes these numbers:
 *
 * 1. **There is no cost column yet.** `public.items` carries `selling_price`
 *    and nothing else, so profit, investment and margin cannot be derived from
 *    the current schema at all. They need `items.cost_price` plus a cost
 *    snapshot on `sale_lines` (the cost *at the time of sale*, or last week's
 *    margins silently rewrite themselves every time a supplier raises a price).
 *    Until that migration lands, the three cost-side KPIs are sample figures.
 * 2. **`getDashboardData` returns sample data.** It is deterministic — seeded
 *    off the tenant and the window — so it does not flicker between renders and
 *    reads like a real shop. `isSample` is true, and the UI says so out loud.
 *    Nothing here reaches Supabase; see the note at the bottom of this file for
 *    the queries that replace it.
 */

export type TenderMethod =
  | "cash"
  | "card"
  | "raast"
  | "easypaisa"
  | "jazzcash"
  | "udhaar";

export type SaleStatus = "completed" | "held" | "returned";

export type TrendPoint = {
  /** Axis label, already Pakistan-local. */
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
  /** "2:41 pm", Pakistan time. */
  at: string;
  items: number;
  method: TenderMethod;
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
  totals: PeriodTotals;
  /** The equally long window immediately before, for the "vs" figures. */
  previous: PeriodTotals;
  trend: TrendPoint[];
  categories: CategorySlice[];
  recent: RecentSale[];
  topProducts: TopProduct[];
  /** False only once the queries below are real. The UI leans on this. */
  isSample: boolean;
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

const CATEGORIES = [
  "Atta, rice & pulses",
  "Cooking oil & ghee",
  "Dairy & eggs",
  "Beverages",
  "Snacks & confectionery",
  "Household & cleaning",
];

const PRODUCTS: { name: string; unit: string; price: number }[] = [
  { name: "Sufi cooking oil 5L", unit: "carton", price: 3_150 },
  { name: "Olper's milk 1L", unit: "piece", price: 320 },
  { name: "Tapal Danedar 950g", unit: "piece", price: 1_680 },
  { name: "Basmati (loose)", unit: "kilo", price: 385 },
  { name: "Dalda banaspati 1kg", unit: "piece", price: 640 },
  { name: "Lays masala 60g", unit: "piece", price: 120 },
  { name: "Surf Excel 1kg", unit: "piece", price: 780 },
  { name: "Anda (desi)", unit: "piece", price: 45 },
];

const METHODS: TenderMethod[] = [
  "cash",
  "cash",
  "cash",
  "easypaisa",
  "jazzcash",
  "raast",
  "card",
  "udhaar",
];

const HOUR = new Intl.DateTimeFormat("en-PK", {
  hour: "numeric",
  hour12: true,
  timeZone: "Asia/Karachi",
});

const TIME = new Intl.DateTimeFormat("en-PK", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "Asia/Karachi",
});

const DAY = new Intl.DateTimeFormat("en-PK", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Karachi",
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** mulberry32 — small, fast, and identical on every render for a given seed. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (value: string) => {
  let out = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    out ^= value.charCodeAt(i);
    out = Math.imul(out, 16777619);
  }
  return out >>> 0;
};

/**
 * Friday through Sunday carry a kiryana. Monday is the trough. Shaping the
 * sample data this way is not decoration — it is what makes an unlabelled
 * y-axis or a mis-bucketed week obvious on sight during review.
 */
const WEEKDAY_WEIGHT = [0.86, 0.78, 0.84, 0.9, 1.18, 1.26, 1.1];

/** Counter traffic across a shop day: dead at dawn, peaks after Maghrib. */
const HOUR_WEIGHT = [
  0.15, 0.4, 0.62, 0.7, 0.66, 0.58, 0.72, 0.95, 1.2, 1.35, 1.1, 0.7,
];

const round = (value: number) => Math.round(value);

function buildTrend(range: Timeframe, random: () => number): TrendPoint[] {
  const points: TrendPoint[] = [];

  if (range.bucket === "hour") {
    // 9 am to 9 pm — before and after that the shutter is down.
    for (let i = 0; i < HOUR_WEIGHT.length; i += 1) {
      const at = new Date(range.from.getTime() + (9 + i) * 60 * 60 * 1000);
      const sales = 9_400 * HOUR_WEIGHT[i] * (0.85 + random() * 0.3);
      points.push({
        label: HOUR.format(at),
        sales: round(sales),
        profit: round(sales * (0.17 + random() * 0.07)),
      });
    }
    return points;
  }

  // Beyond about a month a daily axis is unreadable, so bucket by week.
  const weekly = range.days > 31;
  const step = weekly ? 7 : 1;
  const buckets = Math.ceil(range.days / step);

  for (let i = 0; i < buckets; i += 1) {
    const at = new Date(range.from.getTime() + i * step * DAY_MS);
    const weight = weekly
      ? 7
      : WEEKDAY_WEIGHT[new Date(at.getTime() + 5 * 60 * 60 * 1000).getUTCDay()];
    const sales = 96_000 * weight * (0.82 + random() * 0.36);

    points.push({
      label: weekly ? `w/c ${DAY.format(at)}` : DAY.format(at),
      sales: round(sales),
      profit: round(sales * (0.16 + random() * 0.08)),
    });
  }

  return points;
}

function totalsFrom(trend: TrendPoint[], random: () => number): PeriodTotals {
  const sales = trend.reduce((sum, point) => sum + point.sales, 0);
  const profit = trend.reduce((sum, point) => sum + point.profit, 0);

  return {
    sales,
    profit,
    cost: sales - profit,
    margin: sales > 0 ? (profit / sales) * 100 : 0,
    // ~Rs 1,050 a basket, which is about right for a neighbourhood kiryana.
    transactions: Math.max(1, round(sales / (980 + random() * 160))),
  };
}

/**
 * Everything the dashboard renders, for one tenant and one window.
 *
 * Async and tenant-scoped from the start so the call site never changes: when
 * the queries land, only this function's body does.
 */
export async function getDashboardData(
  tenantId: string,
  range: Timeframe,
): Promise<DashboardData> {
  const random = seeded(hash(`${tenantId}:${range.id}:${range.from.getTime()}`));

  const trend = buildTrend(range, random);
  const totals = totalsFrom(trend, random);

  // The comparison window is a shade quieter, so the deltas read as growth.
  const drift = 0.86 + random() * 0.12;
  const previous: PeriodTotals = {
    sales: round(totals.sales * drift),
    profit: round(totals.profit * drift * (0.94 + random() * 0.1)),
    cost: 0,
    margin: 0,
    transactions: round(totals.transactions * drift),
  };
  previous.cost = previous.sales - previous.profit;
  previous.margin = previous.sales > 0 ? (previous.profit / previous.sales) * 100 : 0;

  const weights = CATEGORIES.map(() => 0.4 + random());
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const categories: CategorySlice[] = CATEGORIES.map((name, index) => ({
    name,
    sales: round((weights[index] / weightTotal) * totals.sales),
    share: weights[index] / weightTotal,
  })).sort((a, b) => b.sales - a.sales);

  const ranked = PRODUCTS.map((product) => {
    const quantity = round(8 + random() * 120);
    return { ...product, quantity, sales: round(quantity * product.price) };
  }).sort((a, b) => b.sales - a.sales);

  const best = ranked[0]?.sales ?? 1;
  const topProducts: TopProduct[] = ranked.slice(0, 6).map((product) => ({
    name: product.name,
    unit: product.unit,
    quantity: product.quantity,
    sales: product.sales,
    share: product.sales / best,
  }));

  const recent: RecentSale[] = Array.from({ length: 8 }, (_, index) => {
    const at = new Date(range.to.getTime() - (index * 17 + 4) * 60 * 1000);
    const roll = random();

    return {
      id: `sale-${index}`,
      receipt: `#${(4820 - index).toString().padStart(4, "0")}`,
      at: TIME.format(at),
      items: 1 + round(random() * 11),
      method: METHODS[round(random() * (METHODS.length - 1))],
      total: round(180 + random() * 4_600),
      // Roughly one in twelve receipts is parked or comes back over the counter.
      status: roll > 0.94 ? "returned" : roll > 0.88 ? "held" : "completed",
    };
  });

  return { totals, previous, trend, categories, recent, topProducts, isSample: true };
}

/**
 * Wiring this up, when the register starts writing rows:
 *
 *   - totals + trend → one `date_trunc` aggregate over `sales` joined to
 *     `sale_lines`, grouped by bucket, filtered on `created_at >= range.from
 *     and created_at < range.to` and `status = 'completed'`. Put it behind a
 *     Postgres function so the grouping is not re-derived per caller.
 *   - categories → the same aggregate grouped by the item's category, which
 *     means `items` needs a category column too.
 *   - recent → `sales` joined to `sale_tenders`, ordered by `created_at desc`,
 *     limit 10. Split tenders mean a receipt can carry two methods; the table
 *     shows the largest and marks it "split".
 *   - topProducts → `sale_lines` grouped by `item_id`, ordered by
 *     `sum(line_total) desc`.
 *
 * All of it reads through the owner's own JWT, not the service role: the read
 * policies in 0008 already scope every one of those tables to the tenant, and
 * running the dashboard through RLS is what proves they still work.
 */
