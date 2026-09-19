import "server-only";

import { cookies } from "next/headers";

import type {
  BillDetail,
  BillLine,
  BillPage,
  BillRow,
  BillTender,
  Window,
} from "@/lib/pos/history";
import { HISTORY_MAX } from "@/lib/pos/history";
import { createClient } from "@/utils/supabase/server";

/**
 * The shop's bills, read as rows.
 *
 * Through the shop's own JWT rather than the service role, like `takings.ts`,
 * `items.ts` and the readers in `shop.ts`: `sales_read_own`, `sale_lines_read_own`
 * and `sale_tenders_read_own` all scope to the `tenant_id` claim, so RLS is the
 * gate and a bug in this file cannot hand one shop another's takings. It also
 * doubles as a live check that the access-token hook is stamping claims — a
 * service-role read would happily return the list with the hook switched off
 * and hide the one failure that breaks everything else.
 *
 * Nothing here writes. There is no update path for a recorded sale and there
 * should not be one: a bill is what happened, and correcting it is a return,
 * which needs stock movements this build does not have yet.
 *
 * Deliberately NOT wrapped in React `cache()`, for the reason none of the
 * readers in `shop.ts`, `items.ts` or `customers.ts` are — a Server Action plus
 * the re-render its `revalidatePath` triggers are one request, and a memoised
 * read hands that re-render the list as it stood before the write. The register
 * revalidates `/app/sales` the moment a sale lands, and a bill that does not
 * appear on the history the cashier switches to is the whole problem.
 */

/** The counters and people a bill's ids are written out with. Both are already
 *  in hand wherever this is called from — the filter bar needs them to offer a
 *  counter and a cashier to narrow by — so they are handed in rather than
 *  re-read per call. */
export type NameBooks = {
  counters: { id: string; name: string }[];
  staff: { id: string; name: string }[];
};

/**
 * What the register selects to build a row. `sale_tenders` is embedded rather
 * than fetched separately because a second query would need the sale ids from
 * the first, and two sequential round trips on shop 3G is the difference
 * between a screen that opens and one a shopkeeper stops using.
 *
 * `customers` is embedded on `sales.customer_id`, and comes back null for the
 * walk-in that most bills are — and also for a customer since deleted, because
 * `0018` made that column `on delete set null` precisely so the receipt
 * survives the person.
 */
const COLUMNS = `
  id,
  receipt_number,
  business_day,
  created_at,
  counter_id,
  created_by,
  customer_id,
  status,
  subtotal,
  discount_total,
  total,
  customers ( name, phone ),
  sale_tenders ( method, amount )
`;

type Row = {
  id: string;
  receipt_number: string;
  business_day: string;
  created_at: string;
  counter_id: string | null;
  created_by: string | null;
  customer_id: string | null;
  status: string;
  subtotal: number | string;
  discount_total: number | string;
  total: number | string;
  customers: { name: string; phone: string | null } | null;
  sale_tenders: { method: string; amount: number | string }[] | null;
};

/**
 * A stored sale into a row of the history.
 *
 * Every name is resolved here rather than in the browser, so the search box can
 * match a cashier without the roster crossing the wire. A counter that has
 * since been deleted keeps its money and loses its name — the sale is still the
 * shop's, and dropping the row would be dropping takings on the floor.
 */
function toBill(row: Row, books: NameBooks): BillRow {
  const counter = books.counters.find((entry) => entry.id === row.counter_id);
  const cashier = books.staff.find((entry) => entry.id === row.created_by);

  const tenders: BillTender[] = (row.sale_tenders ?? []).map((tender) => ({
    method: tender.method,
    amount: Number(tender.amount) || 0,
  }));

  return {
    id: row.id,
    receiptNo: row.receipt_number,
    businessDay: row.business_day,
    at: row.created_at,
    counterId: row.counter_id,
    counterName: counter?.name ?? (row.counter_id ? "Deleted counter" : "No counter"),
    cashierId: row.created_by,
    // A sale whose author has left keeps the bill. `sales.created_by` is
    // `on delete set null`, so this is the honest answer and not a bug.
    cashierName: cashier?.name ?? (row.created_by ? "Former staff" : "—"),
    customerId: row.customer_id,
    customerName: row.customers?.name ?? "",
    customerPhone: row.customers?.phone ?? "",
    tenders,
    subtotal: Number(row.subtotal) || 0,
    discount: Number(row.discount_total) || 0,
    total: Number(row.total) || 0,
    status: row.status,
  };
}

/**
 * Every bill in one window of trading days, newest first.
 *
 * The window is `sales.business_day`, not a timestamp range, for the reason
 * `takings.ts` uses it: the register stamped it once from the shop's own
 * `day_ends_at`, so a dhaba's 1 am sale lands on the day it opened without this
 * file knowing the setting exists. It runs straight down `sales_tenant_day_idx`.
 *
 * `count: "exact"` is asked for alongside so the screen knows how many bills
 * are really in the window even when the cap bites. A list that stops at two
 * thousand and says "2,000 of 4,812" is honest; one that stops and says nothing
 * is a screen that has quietly lost half the month.
 *
 * Held bills are excluded with the same `status = 'completed'` filter the
 * takings use, so the history and the day-close total can never disagree about
 * what the shop sold.
 */
export async function listBills(
  tenantId: string,
  window: Window,
  books: NameBooks,
): Promise<BillPage> {
  const supabase = createClient(await cookies());

  const { data, count } = await supabase
    .from("sales")
    .select(COLUMNS, { count: "exact" })
    .eq("tenant_id", tenantId)
    .eq("status", "completed")
    .gte("business_day", window.from)
    .lte("business_day", window.to)
    .order("business_day", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(HISTORY_MAX);

  const rows = ((data ?? []) as unknown as Row[]).map((row) => toBill(row, books));

  return {
    window,
    rows,
    // The count is the database's answer. Falling back to the rows that came
    // back keeps the screen truthful if PostgREST declines to count rather than
    // claiming the window is empty.
    bills: typeof count === "number" ? count : rows.length,
  };
}

/**
 * One bill, with the lines it was rung up from.
 *
 * Read on demand rather than with the list: a window of two thousand bills is
 * twenty thousand lines, and nobody opens more than a handful of them. The
 * lines are what make a reprint possible, so this is the read the drawer waits
 * on and the only round trip opening a bill costs.
 *
 * `null` for an id that is not this shop's — RLS refuses it, and the caller
 * turns that into the same "no such bill" the caller would get for a typo. A
 * screen that distinguishes the two has confirmed the bill exists.
 */
export async function getBill(
  tenantId: string,
  saleId: string,
  books: NameBooks,
): Promise<BillDetail | null> {
  const supabase = createClient(await cookies());

  const [bill, lines] = await Promise.all([
    supabase
      .from("sales")
      .select(COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("id", saleId)
      .maybeSingle(),
    supabase
      .from("sale_lines")
      .select("id, item_id, name_snapshot, unit, quantity, unit_price, line_total")
      .eq("tenant_id", tenantId)
      .eq("sale_id", saleId)
      // Deterministic, so two duplicates of one bill print identically. It is
      // not the order they were rung up in: every line of a sale is inserted
      // in one transaction and shares a `created_at` to the microsecond, and
      // `sale_lines` keeps no position column to fall back on.
      .order("created_at")
      .order("id"),
  ]);

  if (!bill.data) return null;

  const rows: BillLine[] = (lines.data ?? []).map((line) => ({
    id: line.id,
    itemId: line.item_id,
    name: line.name_snapshot,
    unit: line.unit,
    quantity: Number(line.quantity) || 0,
    unitPrice: Number(line.unit_price) || 0,
    lineTotal: Number(line.line_total) || 0,
  }));

  return { ...toBill(bill.data as unknown as Row, books), lines: rows };
}
