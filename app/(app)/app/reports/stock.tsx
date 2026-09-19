import Link from "next/link";

import { ChartCard } from "@/components/pos/chart-card";
import {
  IconAlert,
  IconBox,
  IconInventory,
  IconTag,
} from "@/components/pos/icons";
import { KpiCard } from "@/components/pos/kpi-card";
import { ReportTable, type ReportColumn } from "@/components/pos/report-table";
import { EXPLAIN, type StockRow } from "@/lib/pos/report";
import type { StockReport } from "@/lib/pos/reports";

import { ExportButton } from "./export-button";
import { Figure, Note, Pct } from "./parts";

/**
 * What is sitting on the shelves, valued two ways.
 *
 * **This tab is not windowed, and it says so twice** — once in the caption and
 * once in a note. `items.stock` is a single column holding what is on the shelf
 * right now; there is no stock ledger, so Flo cannot rewind it to the 1st. A
 * stock report drawn under the period picker without saying that would be read
 * as a stock report *for* the period, which is the one thing it is not, and it
 * is the sort of quiet wrongness an owner only finds after acting on it.
 *
 * The two valuations are the point. At cost is money the shop has already spent
 * and cannot spend again; at retail is what the same shelves would bring in.
 * The gap between them is profit that has not happened yet, which is why it is
 * named that way rather than being called a figure the shop owns.
 */
export function StockTab({
  stock,
  money,
  today,
}: {
  stock: StockReport;
  money: (amount: number) => string;
  today: string;
}) {
  const columns: ReportColumn<StockRow>[] = [
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
      hideBelow: "lg",
      cell: (row) => <span className="text-graphite-500">{row.department}</span>,
    },
    {
      key: "stock",
      header: "On hand",
      explain: EXPLAIN.stockToday,
      align: "end",
      cell: (row) => (
        <>
          {row.stock.toLocaleString("en-PK", { maximumFractionDigits: 3 })}
          <span className="ml-1 text-graphite-500">{row.unit}</span>
        </>
      ),
    },
    {
      key: "state",
      header: "State",
      explain: EXPLAIN.stockLow,
      cell: (row) =>
        row.state === "out" ? (
          <span className="pos-badge pos-badge-bad">Out of stock</span>
        ) : row.state === "low" ? (
          <span className="pos-badge pos-badge-warn">Running low</span>
        ) : (
          <span className="pos-badge pos-badge-good">In stock</span>
        ),
    },
    {
      key: "cost",
      header: "Cost price",
      align: "end",
      hideBelow: "lg",
      cell: (row) => money(row.cost),
    },
    {
      key: "price",
      header: "Selling price",
      align: "end",
      hideBelow: "lg",
      cell: (row) => money(row.price),
    },
    {
      key: "atCost",
      header: "Value at cost",
      explain: EXPLAIN.stockCost,
      align: "end",
      cell: (row) => (
        <span className="font-semibold text-graphite-900">{money(row.atCost)}</span>
      ),
      total: money(stock.atCost),
    },
    {
      key: "atRetail",
      header: "Value at retail",
      explain: EXPLAIN.stockRetail,
      align: "end",
      hideBelow: "sm",
      cell: (row) => money(row.atRetail),
      total: money(stock.atRetail),
    },
  ];

  return (
    <div className="space-y-4">
      <section
        aria-label="What the shelves are worth"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <KpiCard
          label="Stock at cost"
          amount={stock.atCost}
          note="What you have already paid for it"
          delta={null}
          icon={IconInventory}
          explain={EXPLAIN.stockCost}
        />
        <KpiCard
          label="Stock at retail"
          amount={stock.atRetail}
          note="If every unit sold at today's price"
          delta={null}
          icon={IconTag}
          delay={90}
          explain={EXPLAIN.stockRetail}
        />
        <KpiCard
          label="Profit on the shelf"
          amount={stock.gap}
          note="Not money you have yet"
          delta={null}
          icon={IconBox}
          delay={180}
          explain={EXPLAIN.stockGap}
        />
        <KpiCard
          label="Needs reordering"
          amount={stock.low + stock.out}
          prefix=""
          decimals={0}
          note={`${stock.out.toLocaleString("en-PK")} out of stock, ${stock.low.toLocaleString("en-PK")} running low`}
          delta={null}
          icon={IconAlert}
          delay={270}
          explain={EXPLAIN.stockLow}
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard
          title="The shelves, in short"
          caption={`Counted today, ${today}`}
        >
          <Figure
            label="Items counted"
            value={stock.items.toLocaleString("en-PK")}
            hint="Only items the register can sell"
          />
          <Figure
            label="Stock at cost"
            explain={EXPLAIN.stockCost}
            value={money(stock.atCost)}
          />
          <Figure
            label="Stock at retail"
            explain={EXPLAIN.stockRetail}
            value={money(stock.atRetail)}
            op="−"
          />
          <Figure
            label="Profit on the shelf"
            explain={EXPLAIN.stockGap}
            value={money(stock.gap)}
            op="="
            strong
          />
          <Figure
            label="Margin if it all sold"
            explain={EXPLAIN.margin}
            value={<Pct value={stock.margin} />}
            hint="At today's prices"
          />

          <Note tone="warn">
            <strong className="font-semibold">This is today&rsquo;s shelf.</strong>{" "}
            {EXPLAIN.stockToday.plain}
          </Note>
        </ChartCard>

        <ChartCard
          title="By department"
          caption="Where the money is tied up"
          bleed
          className="xl:col-span-2"
        >
          <ReportTable
            columns={[
              {
                key: "name",
                header: "Department",
                cell: (row: StockReport["departments"][number]) => (
                  <span className="font-medium text-graphite-900">{row.name}</span>
                ),
              },
              {
                key: "items",
                header: "Items",
                align: "end",
                cell: (row: StockReport["departments"][number]) =>
                  row.items.toLocaleString("en-PK"),
                total: stock.items.toLocaleString("en-PK"),
              },
              {
                key: "atCost",
                header: "Value at cost",
                explain: EXPLAIN.stockCost,
                align: "end",
                cell: (row: StockReport["departments"][number]) => (
                  <span className="font-semibold text-graphite-900">
                    {money(row.atCost)}
                  </span>
                ),
                total: money(stock.atCost),
              },
              {
                key: "atRetail",
                header: "Value at retail",
                explain: EXPLAIN.stockRetail,
                align: "end",
                hideBelow: "sm",
                cell: (row: StockReport["departments"][number]) =>
                  money(row.atRetail),
                total: money(stock.atRetail),
              },
            ]}
            rows={stock.departments}
            rowKey={(row) => row.name}
            totalLabel="Every department"
            empty="Nothing on the shelves yet."
          />
        </ChartCard>
      </div>

      <ChartCard
        title="Every item on the shelf"
        caption="Most money tied up first"
        bleed
        actions={
          <ExportButton kind="stock" params={{}} what="items" />
        }
      >
        <ReportTable
          columns={columns}
          rows={stock.rows}
          rowKey={(row) => row.id}
          totalLabel={`All ${stock.items.toLocaleString("en-PK")} items`}
          empty="Nothing on the shelves yet."
        />

        <div className="px-4 pt-1 pb-4">
          <Note>
            Items you have switched off are left out — an item the register
            cannot sell is not stock it can turn into money. Add what is missing
            on{" "}
            <Link
              href="/app/inventory"
              className="font-semibold text-orchid-700 underline underline-offset-2"
            >
              Products
            </Link>
            , where each item&rsquo;s low-stock level is set too.
          </Note>
        </div>
      </ChartCard>
    </div>
  );
}
