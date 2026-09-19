"use server";

import { getModuleAccess } from "@/lib/pos/access";
import { currentBusinessDay } from "@/lib/pos/counter";
import {
  csvFilename,
  daysToCsv,
  grainOf,
  groupsToCsv,
  hoursToCsv,
  isReportRange,
  peopleToCsv,
  productsToCsv,
  resolveReportWindow,
  stockToCsv,
  tendersToCsv,
  type ReportRangeId,
} from "@/lib/pos/report";
import { getReportData, getStockReport } from "@/lib/pos/reports";
import { getShopSettings, listCounters } from "@/lib/pos/shop";
import { listStaff } from "@/lib/pos/staff";
import { requireSession } from "@/lib/auth";

/**
 * A report off the screen and into a spreadsheet.
 *
 * A Server Action that reads rather than writes, like `loadBill` next door and
 * for a sharper version of the same reason. The tables on Reports are server
 * components, so the browser is not holding the rows — the alternative would be
 * shipping every figure twice, once as the table and once as a CSV string
 * waiting in the payload for a button nobody may press. An export is a rare,
 * deliberate act and a page load is not, so the file is built when it is asked
 * for.
 *
 * **The window is resolved here, not sent.** The action takes the same period
 * id the URL carries and turns it into trading days with the same
 * `resolveReportWindow` the page used, against the shop's own current business
 * day — so a crafted request cannot ask for a wider window than the screen
 * would draw, and the file can never disagree with the table it came from.
 *
 * Both reads run on the shop's own JWT, so RLS refuses another shop's rows
 * before this code sees them. The module check below is what turns that
 * refusal into a sentence rather than an empty file.
 */

export type ExportKind =
  | "days"
  | "products"
  | "departments"
  | "categories"
  | "payments"
  | "counters"
  | "cashiers"
  | "hours"
  | "stock";

export type ExportResult =
  | { ok: true; csv: string; filename: string; rows: number }
  | { ok: false; error: string };

export async function exportReport(
  kind: ExportKind,
  params: { range?: string; from?: string; to?: string },
): Promise<ExportResult> {
  const session = await requireSession();

  if (!session.tenantId) {
    return { ok: false, error: "This login is not linked to a shop." };
  }

  const access = await getModuleAccess(session);

  // Re-checked here rather than trusted from the page that drew the button. An
  // action is a public endpoint whatever component calls it.
  if (!access.reports) {
    return { ok: false, error: "Reports are not yours to export." };
  }

  const settings = await getShopSettings(session.tenantId);
  const currency = settings.currency;
  const today = currentBusinessDay(settings);

  const range: ReportRangeId = isReportRange(params.range)
    ? params.range
    : "this-month";
  const window = resolveReportWindow(range, today, settings, params);

  if (kind === "stock") {
    const stock = await getStockReport(session.tenantId);

    return {
      ok: true,
      csv: stockToCsv(stock.rows, { currency }),
      // The day rather than the window: a stock count is what is on the shelf
      // now, and naming it after a period would invite it being read as a
      // stock report *for* that period, which is the one thing it is not.
      filename: `flo-stock-${today}.csv`,
      rows: stock.rows.length,
    };
  }

  const [counters, staff] = await Promise.all([
    listCounters(session.tenantId),
    listStaff(session.tenantId),
  ]);

  const data = await getReportData(session.tenantId, window, settings, {
    counters: counters.map((counter) => ({ id: counter.id, name: counter.name })),
    staff: staff.map((member) => ({ id: member.id, name: member.name })),
  });

  const file = (name: string, csv: string, rows: number): ExportResult => ({
    ok: true,
    csv,
    filename: csvFilename(name, window),
    rows,
  });

  switch (kind) {
    case "days":
      return file(
        "sales-by-day",
        daysToCsv(data.days, { currency, grain: grainOf(window.days) }),
        data.days.length,
      );
    case "products":
      return file(
        "items",
        productsToCsv(data.products, { currency }),
        data.products.length,
      );
    case "departments":
      return file(
        "departments",
        groupsToCsv(data.departments, { currency, heading: "Department" }),
        data.departments.length,
      );
    case "categories":
      return file(
        "categories",
        groupsToCsv(data.categories, { currency, heading: "Category" }),
        data.categories.length,
      );
    case "payments":
      return file(
        "payments",
        tendersToCsv(data.tenders, { currency }),
        data.tenders.length,
      );
    case "counters":
      return file(
        "counters",
        peopleToCsv(data.counters, { currency, heading: "Counter" }),
        data.counters.length,
      );
    case "cashiers":
      return file(
        "cashiers",
        peopleToCsv(data.cashiers, { currency, heading: "Cashier" }),
        data.cashiers.length,
      );
    default:
      return file("busy-hours", hoursToCsv(data.hours, { currency }), data.hours.length);
  }
}
