import "server-only";

import { cookies } from "next/headers";

import { stockState, unitShort, type UnitId } from "@/lib/pos/catalog";
import { TENDERS } from "@/lib/pos/counter";
import { listProducts } from "@/lib/pos/items";
import { writeReadError } from "@/lib/pos/read-error";
import {
  EMPTY_TOTALS,
  grainOf,
  marginOf,
  rollDays,
  round2,
  shareOf,
  totalsOf,
  UNCATEGORISED,
  UNFILED,
  type CategoryRow,
  type GroupRow,
  type HourRow,
  type PersonRow,
  type ProductRow,
  type ReportData,
  type ReportWindow,
  type StockRow,
  type TenderRow,
} from "@/lib/pos/report";
import type { ShopSettings } from "@/lib/pos/settings-options";
import { createClient } from "@/utils/supabase/server";

/**
 * Everything `/app/reports` draws, read as rows.
 *
 * One call to `public.reports_summary` per window — the same bargain
 * `dashboard.ts` strikes with `dashboard_summary`, and for a sharper version of
 * the same reason. A financial year of a busy kiryana is hundreds of thousands
 * of sale lines, grouped eleven ways; none of that has any business crossing
 * shop 3G to be added up in a browser runtime.
 *
 * Read through the shop's own JWT rather than the service role, like every
 * other reader in `lib/pos/`: the function is `security invoker`, so RLS is the
 * gate and `p_tenant` is only a filter. It doubles as a live check that the
 * access-token hook is stamping claims — a service-role read would return the
 * whole report with the hook switched off and hide the one failure that breaks
 * everything else.
 *
 * Deliberately NOT wrapped in React `cache()`, for the reason none of the
 * readers in `shop.ts`, `items.ts`, `customers.ts`, `bills.ts` or
 * `dashboard.ts` are: a Server Action plus the re-render its `revalidatePath`
 * triggers are one request, and a memoised read would hand that re-render the
 * shop as it stood before the write.
 *
 * **Nothing here is derived twice.** Profit, margin, averages and shares are
 * all worked out by `report.ts`, which is also what the hover tips quote and
 * what the CSV writes. A figure calculated in two places is a figure that will
 * eventually disagree with itself, and on this screen that disagreement is an
 * owner deciding the software is lying to them.
 */

/** The counters and people an id is written out with. Both are already in hand
 *  wherever this is called from, so they are handed in rather than re-read —
 *  the same call `listBills` makes. */
export type NameBooks = {
  counters: { id: string; name: string }[];
  staff: { id: string; name: string }[];
};

/* ---------------- What the function hands back ---------------- */

/** Every money column arrives as a string: `numeric` has more precision than a
 *  JSON number can carry, so PostgREST does not guess. */
const num = (value: number | string | null | undefined) => Number(value) || 0;

type Money = { sales: number | string | null; cost: number | string | null };

type SummaryRow = {
  totals?: RawTotals | null;
  previous?: RawTotals | null;
  days?: (Money & { at: string; bills: number | string; lines: number | string })[] | null;
  hours?: { at: number; sales: number | string; bills: number | string }[] | null;
  product_count?: number | string | null;
  products?: (Money & {
    key: string;
    name: string;
    unit: string;
    department: string;
    quantity: number | string;
    bills: number | string;
  })[] | null;
  departments?: (Money & { name: string; lines: number | string })[] | null;
  categories?: (Money & {
    department: string;
    name: string;
    lines: number | string;
  })[] | null;
  tenders?: { method: string; amount: number | string; bills: number | string }[] | null;
  counters?: (Money & { id: string | null; bills: number | string })[] | null;
  cashiers?: (Money & { id: string | null; bills: number | string })[] | null;
};

type RawTotals = Money & {
  bills: number | string | null;
  lines: number | string | null;
  discount: number | string | null;
};

const readTotals = (row: RawTotals | null | undefined) =>
  totalsOf({
    sales: num(row?.sales),
    cost: num(row?.cost),
    bills: num(row?.bills),
    lines: num(row?.lines),
    discount: num(row?.discount),
  });

/* ---------------- Shaping ---------------- */

/** "2 pm". Built from the bucket number rather than from an instant, because
 *  the hour is already the shop's own — Postgres shifted it before grouping. */
const writeHour = (hour: number) =>
  `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "am" : "pm"}`;

const TENDER_LABELS = new Map(TENDERS.map((tender) => [tender.id as string, tender.label]));

/** A method the register does not offer yet still has to be shown rather than
 *  dropped: money that came in under a name this build has not heard of is
 *  money the shop took. */
const tenderLabel = (method: string) =>
  TENDER_LABELS.get(method) ?? method.charAt(0).toUpperCase() + method.slice(1);

function groupRow(
  row: { name: string; sales: number; cost: number; lines: number },
  whole: number,
  fallback: string,
): GroupRow {
  const sales = round2(row.sales);
  const cost = round2(row.cost);

  return {
    name: row.name.trim() || fallback,
    sales,
    cost,
    profit: round2(sales - cost),
    margin: marginOf(sales, cost),
    lines: row.lines,
    share: shareOf(sales, whole),
  };
}

function personRow(
  row: { id: string | null; sales: number; cost: number; bills: number },
  whole: number,
  name: string,
): PersonRow {
  const sales = round2(row.sales);
  const cost = round2(row.cost);

  return {
    id: row.id,
    name,
    sales,
    cost,
    profit: round2(sales - cost),
    margin: marginOf(sales, cost),
    bills: row.bills,
    average: row.bills > 0 ? round2(sales / row.bills) : 0,
    share: shareOf(sales, whole),
  };
}

/* ---------------- The read ---------------- */

const empty = (window: ReportWindow): ReportData => ({
  window,
  totals: EMPTY_TOTALS,
  previous: EMPTY_TOTALS,
  days: rollDays(window, [], grainOf(window.days)),
  hours: [],
  products: [],
  productCount: 0,
  departments: [],
  categories: [],
  tenders: [],
  counters: [],
  cashiers: [],
});

/**
 * One shop, one window, every table on the screen.
 *
 * `tenantId` is nullable for the reason `getDashboardData`'s is: an account not
 * attached to a shop still reaches the console to be told so, and gets a shop
 * that has sold nothing — which is exactly what it has.
 */
export async function getReportData(
  tenantId: string | null,
  window: ReportWindow,
  settings: ShopSettings,
  books: NameBooks,
): Promise<ReportData> {
  if (!tenantId) return empty(window);

  const supabase = createClient(await cookies());

  const { data, error } = await supabase.rpc("reports_summary", {
    p_tenant: tenantId,
    p_from: window.from,
    p_to: window.to,
    p_prev_from: window.previous.from,
    p_prev_to: window.previous.to,
    p_timezone: settings.timezone,
  });

  if (error) {
    // A report that throws is a screen an owner cannot get into. Zeroes are
    // wrong, but they are wrong in a way that is visible on the screen and in
    // the log, where a crash is only visible in the log. The same call
    // `getDashboardData` makes.
    //
    // Spelled out field by field rather than handed the whole object, because
    // a PostgrestError prints as `{}` in the server console — and a screen
    // that silently falls back to zeroes, whose only evidence is an empty pair
    // of braces, is a screen nobody can debug. The first thing this catches is
    // the migration not having been applied: PGRST202, the function missing
    // from the schema cache.
    console.error(`[reports] summary failed — ${writeReadError(error)}`);
    return empty(window);
  }

  const row = (data ?? {}) as SummaryRow;

  const totals = readTotals(row.totals);
  const previous = readTotals(row.previous);

  const departments = (row.departments ?? []).map((entry) => ({
    name: entry.name,
    sales: num(entry.sales),
    cost: num(entry.cost),
    lines: num(entry.lines),
  }));

  // **One denominator for every share on the screen.** Line totals rather than
  // bill totals, because that is what the department, category and item tables
  // are all summing — so departments add up to a hundred, categories add up to
  // a hundred, and an item's share is comparable with both. The two figures
  // agree to the rupee today, since nothing discounts a bill; this is what
  // keeps them agreeing the day something does.
  const lineSales = round2(
    departments.reduce((sum, entry) => sum + entry.sales, 0),
  );

  const tenderTotal = (row.tenders ?? []).reduce(
    (sum, entry) => sum + num(entry.amount),
    0,
  );

  const hours = (row.hours ?? []).map((entry) => ({
    hour: entry.at,
    sales: round2(num(entry.sales)),
    bills: num(entry.bills),
  }));
  // Against the busiest hour rather than against the day, because the bar is
  // answering "when is it worth having a second person on" and a 24-hour
  // denominator flattens every bar into the same short stub.
  const busiest = Math.max(...hours.map((entry) => entry.sales), 1);

  return {
    window,
    totals,
    previous,
    days: rollDays(
      window,
      (row.days ?? []).map((entry) => ({
        at: entry.at,
        sales: num(entry.sales),
        cost: num(entry.cost),
        bills: num(entry.bills),
        lines: num(entry.lines),
      })),
      grainOf(window.days),
    ),
    hours: hours.map(
      (entry): HourRow => ({
        ...entry,
        label: writeHour(entry.hour),
        share: shareOf(entry.sales, busiest),
      }),
    ),
    productCount: num(row.product_count),
    products: (row.products ?? []).map((entry): ProductRow => {
      const sales = round2(num(entry.sales));
      const cost = round2(num(entry.cost));

      return {
        key: entry.key,
        name: entry.name,
        // The unit is stored as it was on the line. `unitShort` folds 'kilo'
        // into 'kg' the same way `items.ts` does, so a report and the Products
        // screen do not name the same unit two ways.
        unit: unitShort(entry.unit as UnitId),
        department: entry.department.trim() || UNFILED,
        quantity: num(entry.quantity),
        sales,
        cost,
        profit: round2(sales - cost),
        margin: marginOf(sales, cost),
        bills: num(entry.bills),
        share: shareOf(sales, lineSales),
      };
    }),
    departments: departments.map((entry) => groupRow(entry, lineSales, UNFILED)),
    categories: (row.categories ?? []).map(
      (entry): CategoryRow => ({
        ...groupRow(
          {
            name: entry.name,
            sales: num(entry.sales),
            cost: num(entry.cost),
            lines: num(entry.lines),
          },
          lineSales,
          UNCATEGORISED,
        ),
        department: entry.department.trim() || UNFILED,
      }),
    ),
    tenders: (row.tenders ?? []).map((entry): TenderRow => {
      const amount = round2(num(entry.amount));

      return {
        method: entry.method,
        label: tenderLabel(entry.method),
        amount,
        bills: num(entry.bills),
        share: shareOf(amount, tenderTotal),
      };
    }),
    // Ids into names here rather than in SQL, so a counter or a cashier since
    // deleted keeps its takings and loses only its label — the same call
    // `bills.ts` makes for the history, in the same words.
    counters: (row.counters ?? []).map((entry) =>
      personRow(
        {
          id: entry.id,
          sales: num(entry.sales),
          cost: num(entry.cost),
          bills: num(entry.bills),
        },
        totals.sales,
        books.counters.find((counter) => counter.id === entry.id)?.name ??
          (entry.id ? "Deleted counter" : "No counter"),
      ),
    ),
    cashiers: (row.cashiers ?? []).map((entry) =>
      personRow(
        {
          id: entry.id,
          sales: num(entry.sales),
          cost: num(entry.cost),
          bills: num(entry.bills),
        },
        totals.sales,
        books.staff.find((member) => member.id === entry.id)?.name ??
          (entry.id ? "Former staff" : "—"),
      ),
    ),
  };
}

/* -------------------------------------------------------------------------- */
/*  Stock                                                                     */
/* -------------------------------------------------------------------------- */

export type StockReport = {
  /** Items counted — the ones the register can sell. */
  items: number;
  atCost: number;
  atRetail: number;
  /** What is still to be made on the shelf: retail minus cost. */
  gap: number;
  margin: number;
  low: number;
  out: number;
  /** Every counted item, richest first, for the table and the CSV. */
  rows: StockRow[];
  /** What the shelves are worth, by department. */
  departments: { name: string; items: number; atCost: number; atRetail: number }[];
};

/**
 * What is on the shelves, valued two ways.
 *
 * **This one is not windowed, and the screen says so.** `items.stock` is a
 * single column holding what is on the shelf right now — there is no stock
 * ledger, so Flo cannot rewind it to what was there on the 1st. A stock report
 * that carried the period's dates at the top would be read as a stock report
 * *for* that period, which is the one thing it is not.
 *
 * Built off `listProducts`, so it is the same rows, the same JWT and the same
 * `stockState` the Products screen paints its badges with — a report that
 * disagreed with the screen it was reported from would be worse than no report.
 * Inactive items are left out: an item switched off is not stock the register
 * can turn into money.
 */
export async function getStockReport(tenantId: string | null): Promise<StockReport> {
  const blank: StockReport = {
    items: 0,
    atCost: 0,
    atRetail: 0,
    gap: 0,
    margin: 0,
    low: 0,
    out: 0,
    rows: [],
    departments: [],
  };

  if (!tenantId) return blank;

  const products = (await listProducts(tenantId)).filter(
    (product) => product.isActive,
  );

  const rows: StockRow[] = products.map((product) => ({
    id: product.id,
    name: product.name,
    department: product.department.trim() || UNFILED,
    unit: unitShort(product.unit),
    stock: product.stock,
    lowAt: product.lowAt,
    cost: product.cost,
    price: product.price,
    atCost: round2(product.stock * product.cost),
    atRetail: round2(product.stock * product.price),
    state: stockState({ stock: product.stock, lowAt: product.lowAt }),
  }));

  const atCost = round2(rows.reduce((sum, row) => sum + row.atCost, 0));
  const atRetail = round2(rows.reduce((sum, row) => sum + row.atRetail, 0));

  const byDepartment = new Map<string, { items: number; atCost: number; atRetail: number }>();

  for (const row of rows) {
    const entry = byDepartment.get(row.department) ?? {
      items: 0,
      atCost: 0,
      atRetail: 0,
    };

    entry.items += 1;
    entry.atCost += row.atCost;
    entry.atRetail += row.atRetail;
    byDepartment.set(row.department, entry);
  }

  return {
    items: rows.length,
    atCost,
    atRetail,
    gap: round2(atRetail - atCost),
    // The margin the shelf would earn if it all sold at today's prices. Shares
    // its arithmetic with the sales margin above deliberately: an owner
    // comparing "what I make" against "what I would make" is comparing two
    // figures worked out the same way.
    margin: marginOf(atRetail, atCost),
    low: rows.filter((row) => row.state === "low").length,
    out: rows.filter((row) => row.state === "out").length,
    rows: rows.sort((a, b) => b.atCost - a.atCost),
    departments: [...byDepartment]
      .map(([name, entry]) => ({
        name,
        items: entry.items,
        atCost: round2(entry.atCost),
        atRetail: round2(entry.atRetail),
      }))
      .sort((a, b) => b.atCost - a.atCost),
  };
}
