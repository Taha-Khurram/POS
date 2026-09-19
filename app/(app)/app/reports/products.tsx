import Link from "next/link";

import { ChartCard } from "@/components/pos/chart-card";
import { ReportTable, type ReportColumn } from "@/components/pos/report-table";
import { EXPLAIN, type ProductRow, type ReportData } from "@/lib/pos/report";

import { ExportButton } from "./export-button";
import { CostCaveat, Meter, Note, Pct } from "./parts";

/**
 * What sold, and what it made.
 *
 * The screen the placeholder promised as "profit by item, once purchase prices
 * are in" — they are in, stamped onto every line at the moment of sale by
 * `record_sale`, which is what makes this table honest about a month whose
 * supplier prices have since moved.
 *
 * The sort is a link, not a control. It lives in the URL beside the period, so
 * "our best sellers last month" and "what actually makes us money last month"
 * are two links an owner can keep — and the page stays a server component,
 * which is what keeps a five-hundred-row table fast on a counter tablet.
 */

export const PRODUCT_SORTS = [
  { id: "sales", label: "Sales", note: "What brought the most money in" },
  { id: "profit", label: "Profit", note: "What actually made the most" },
  { id: "quantity", label: "Quantity sold", note: "What moved off the shelf" },
] as const;

export type ProductSort = (typeof PRODUCT_SORTS)[number]["id"];

export const isProductSort = (value: unknown): value is ProductSort =>
  PRODUCT_SORTS.some((sort) => sort.id === value);

/** Sorted here rather than in SQL: the rows are already in hand, the list is
 *  capped at 500, and a round trip to re-order a table somebody is looking at
 *  is a round trip over shop 3G. */
function sortProducts(rows: ProductRow[], sort: ProductSort): ProductRow[] {
  const by =
    sort === "profit"
      ? (row: ProductRow) => row.profit
      : sort === "quantity"
        ? (row: ProductRow) => row.quantity
        : (row: ProductRow) => row.sales;

  return [...rows].sort((a, b) => by(b) - by(a));
}

export function ProductsTab({
  data,
  money,
  sort,
  params,
}: {
  data: ReportData;
  money: (amount: number) => string;
  sort: ProductSort;
  params: { range?: string; from?: string; to?: string };
}) {
  const rows = sortProducts(data.products, sort);
  const shown = rows.length;
  const capped = data.productCount > shown;

  const sum = (pick: (row: ProductRow) => number) =>
    rows.reduce((total, row) => total + pick(row), 0);

  const sales = sum((row) => row.sales);
  const cost = sum((row) => row.cost);

  const columns: ReportColumn<ProductRow>[] = [
    {
      key: "rank",
      header: "#",
      cell: (_row, index) => (
        <span className="pos-rank" data-lead={index === 0}>
          {index + 1}
        </span>
      ),
    },
    {
      key: "name",
      header: "Item",
      cell: (row) => (
        <span className="font-medium text-graphite-900">{row.name}</span>
      ),
    },
    {
      key: "department",
      header: "Department",
      explain: EXPLAIN.department,
      hideBelow: "lg",
      cell: (row) => <span className="text-graphite-500">{row.department}</span>,
    },
    {
      key: "quantity",
      header: "Sold",
      explain: EXPLAIN.quantity,
      align: "end",
      cell: (row) => (
        <>
          {row.quantity.toLocaleString("en-PK", { maximumFractionDigits: 3 })}
          <span className="ml-1 text-graphite-500">{row.unit}</span>
        </>
      ),
    },
    {
      key: "bills",
      header: "Bills",
      explain: EXPLAIN.bills,
      align: "end",
      hideBelow: "lg",
      cell: (row) => row.bills.toLocaleString("en-PK"),
    },
    {
      key: "sales",
      header: "Sales",
      explain: EXPLAIN.sales,
      align: "end",
      cell: (row) => money(row.sales),
      total: money(sales),
    },
    {
      key: "cost",
      header: "Cost of goods",
      explain: EXPLAIN.cost,
      align: "end",
      hideBelow: "lg",
      cell: (row) => money(row.cost),
      total: money(cost),
    },
    {
      key: "profit",
      header: "Profit",
      explain: EXPLAIN.profit,
      align: "end",
      cell: (row) => (
        <span className="font-semibold text-graphite-900">{money(row.profit)}</span>
      ),
      total: money(sales - cost),
    },
    {
      key: "margin",
      header: "Margin",
      explain: EXPLAIN.margin,
      align: "end",
      hideBelow: "sm",
      cell: (row) => <Pct value={row.margin} />,
    },
    {
      key: "share",
      header: "Share of sales",
      explain: EXPLAIN.share,
      align: "end",
      hideBelow: "md",
      cell: (row) => <Meter share={row.share} />,
    },
  ];

  return (
    <div className="space-y-4">
      <ChartCard
        title="Every item you sold"
        caption={
          capped
            ? `The top ${shown.toLocaleString("en-PK")} of ${data.productCount.toLocaleString("en-PK")} items sold — narrow the period to see the rest`
            : `${shown.toLocaleString("en-PK")} ${shown === 1 ? "item" : "items"} sold in this period`
        }
        bleed
        actions={<ExportButton kind="products" params={params} what="items" />}
      >
        <nav
          className="flex flex-wrap items-center gap-2 px-4 pb-3"
          aria-label="Sort the items"
        >
          <span className="text-[0.75rem] text-graphite-500">Sort by</span>
          {PRODUCT_SORTS.map((option) => {
            const on = option.id === sort;

            return (
              <Link
                key={option.id}
                href={{
                  pathname: "/app/reports",
                  query: { ...params, tab: "products", sort: option.id },
                }}
                scroll={false}
                title={option.note}
                aria-current={on ? "true" : undefined}
                className={`pos-btn pos-btn-sm ${on ? "pos-btn-soft" : "pos-btn-quiet"}`}
              >
                {option.label}
              </Link>
            );
          })}
        </nav>

        <ReportTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.key}
          totalLabel={capped ? `These ${shown.toLocaleString("en-PK")} items` : "All items"}
          empty="Nothing was sold in this period."
        />

        <div className="px-4 pt-1 pb-4">
          {capped ? (
            <Note tone="warn">
              <strong className="font-semibold">
                This is the top {shown.toLocaleString("en-PK")} items by sales.
              </strong>{" "}
              The totals row adds up these rows, not all{" "}
              {data.productCount.toLocaleString("en-PK")} — the figures at the top
              of the page are the whole period. A shorter period brings the rest
              into view.
            </Note>
          ) : (
            <Note>
              {EXPLAIN.quantity.plain} Items you have since deleted keep the name
              they were sold under, so their sales are still counted here.
            </Note>
          )}
          <CostCaveat />
        </div>
      </ChartCard>
    </div>
  );
}
