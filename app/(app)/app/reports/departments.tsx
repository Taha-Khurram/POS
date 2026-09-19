import { ChartCard } from "@/components/pos/chart-card";
import { ReportTable, type ReportColumn } from "@/components/pos/report-table";
import {
  EXPLAIN,
  type CategoryRow,
  type GroupRow,
  type ReportData,
} from "@/lib/pos/report";

import { ExportButton } from "./export-button";
import { CostCaveat, Meter, Note, Pct } from "./parts";

/**
 * Where the money came from, down the shop's own tree.
 *
 * Both levels, two tables, because they answer two questions. Departments is
 * "which half of the shop is carrying the other half" — the question behind
 * how much shelf and how much cash to give each one. Categories is the same
 * question one level in, and it is where a shop finds out that its whole
 * Beverages department is one brand of cola.
 *
 * The tree is the shop's own (`0016`), and `items.department` is the name as it
 * stood when the item was filed. An item since deleted has no department left
 * to read, so its money is grouped under "Not filed" rather than dropped — the
 * money was still the shop's, and a report that silently loses a column of
 * rupees is worse than one that admits where they went.
 */
export function DepartmentsTab({
  data,
  money,
  params,
}: {
  data: ReportData;
  money: (amount: number) => string;
  params: { range?: string; from?: string; to?: string };
}) {
  const sum = (rows: { sales: number; cost: number; lines: number }[]) => ({
    sales: rows.reduce((total, row) => total + row.sales, 0),
    cost: rows.reduce((total, row) => total + row.cost, 0),
    lines: rows.reduce((total, row) => total + row.lines, 0),
  });

  const departmentTotals = sum(data.departments);
  const categoryTotals = sum(data.categories);

  const shared = <Row extends GroupRow>(): ReportColumn<Row>[] => [
    {
      key: "lines",
      header: "Lines",
      explain: EXPLAIN.lines,
      align: "end",
      hideBelow: "lg",
      cell: (row) => row.lines.toLocaleString("en-PK"),
    },
    {
      key: "sales",
      header: "Sales",
      explain: EXPLAIN.sales,
      align: "end",
      cell: (row) => money(row.sales),
    },
    {
      key: "cost",
      header: "Cost of goods",
      explain: EXPLAIN.cost,
      align: "end",
      hideBelow: "lg",
      cell: (row) => money(row.cost),
    },
    {
      key: "profit",
      header: "Profit",
      explain: EXPLAIN.profit,
      align: "end",
      cell: (row) => (
        <span className="font-semibold text-graphite-900">{money(row.profit)}</span>
      ),
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
      cell: (row) => <Meter share={row.share} />,
    },
  ];

  const withTotals = <Row extends GroupRow>(
    columns: ReportColumn<Row>[],
    totals: { sales: number; cost: number; lines: number },
  ): ReportColumn<Row>[] =>
    columns.map((column) =>
      column.key === "sales"
        ? { ...column, total: money(totals.sales) }
        : column.key === "cost"
          ? { ...column, total: money(totals.cost) }
          : column.key === "profit"
            ? { ...column, total: money(totals.sales - totals.cost) }
            : column.key === "lines"
              ? { ...column, total: totals.lines.toLocaleString("en-PK") }
              : column,
    );

  const departmentColumns: ReportColumn<GroupRow>[] = withTotals(
    [
      {
        key: "name",
        header: "Department",
        explain: EXPLAIN.department,
        cell: (row) => (
          <span className="font-medium text-graphite-900">{row.name}</span>
        ),
      },
      ...shared<GroupRow>(),
    ],
    departmentTotals,
  );

  const categoryColumns: ReportColumn<CategoryRow>[] = withTotals(
    [
      {
        key: "department",
        header: "Department",
        explain: EXPLAIN.department,
        hideBelow: "sm",
        cell: (row) => <span className="text-graphite-500">{row.department}</span>,
      },
      {
        key: "name",
        header: "Category",
        cell: (row) => (
          <span className="font-medium text-graphite-900">{row.name}</span>
        ),
      },
      ...shared<CategoryRow>(),
    ],
    categoryTotals,
  );

  return (
    <div className="space-y-4">
      <ChartCard
        title="Where the money came from"
        caption="Every department, richest first"
        bleed
        actions={
          <ExportButton kind="departments" params={params} what="departments" />
        }
      >
        <ReportTable
          columns={departmentColumns}
          rows={data.departments}
          rowKey={(row) => row.name}
          totalLabel="Every department"
          empty="Nothing was sold in this period."
        />

        <div className="px-4 pt-1 pb-4">
          <Note>{EXPLAIN.department.plain}</Note>
          <CostCaveat />
        </div>
      </ChartCard>

      <ChartCard
        title="One level in"
        caption="The same money, split by category"
        bleed
        actions={
          <ExportButton kind="categories" params={params} what="categories" />
        }
      >
        <ReportTable
          columns={categoryColumns}
          rows={data.categories}
          rowKey={(row) => `${row.department}/${row.name}`}
          totalLabel="Every category"
          empty="Nothing was sold in this period."
        />

        <div className="px-4 pt-1 pb-4">
          <Note>
            Category is optional on an item — department is the filing, category
            is the refinement — so anything you never put in one is grouped as
            “No category”. Both tables add up to the same money.
          </Note>
        </div>
      </ChartCard>
    </div>
  );
}
