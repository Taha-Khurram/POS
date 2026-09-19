import { ChartCard } from "@/components/pos/chart-card";
import { IconCard, IconCash } from "@/components/pos/icons";
import { ReportTable, type ReportColumn } from "@/components/pos/report-table";
import {
  EXPLAIN,
  type HourRow,
  type PersonRow,
  type ReportData,
} from "@/lib/pos/report";

import { ExportButton } from "./export-button";
import { Figure, Meter, Note, Pct } from "./parts";

/**
 * How the money arrived, and through whose hands.
 *
 * Three questions on one tab because they are all asked at the same moment —
 * the end of a week, working out what to do next week. How much of the takings
 * was cash decides how often somebody walks to the bank. Which counter took
 * what decides whether the second till earns its space. When the shop is busy
 * decides who is rostered on Saturday afternoon.
 *
 * The busiest-hour list is over the **whole period**, not over one day. A
 * single day's hours are noise; a month's are a rota.
 */
export function CountersTab({
  data,
  money,
  params,
}: {
  data: ReportData;
  money: (amount: number) => string;
  params: { range?: string; from?: string; to?: string };
}) {
  const takings = data.tenders.reduce((total, row) => total + row.amount, 0);
  const cash = data.tenders.find((row) => row.method === "cash");

  const people = (heading: string): ReportColumn<PersonRow>[] => [
    {
      key: "name",
      header: heading,
      explain: heading === "Counter" ? EXPLAIN.counter : EXPLAIN.cashier,
      cell: (row) => (
        <span className="font-medium text-graphite-900">{row.name}</span>
      ),
    },
    {
      key: "bills",
      header: "Bills",
      explain: EXPLAIN.bills,
      align: "end",
      cell: (row) => row.bills.toLocaleString("en-PK"),
      total: data.totals.bills.toLocaleString("en-PK"),
    },
    {
      key: "sales",
      header: "Sales",
      explain: EXPLAIN.sales,
      align: "end",
      cell: (row) => money(row.sales),
      total: money(data.totals.sales),
    },
    {
      key: "average",
      header: "Average bill",
      explain: EXPLAIN.average,
      align: "end",
      hideBelow: "md",
      cell: (row) => (row.bills > 0 ? money(row.average) : "—"),
      total: money(data.totals.average),
    },
    {
      key: "profit",
      header: "Profit",
      explain: EXPLAIN.profit,
      align: "end",
      hideBelow: "lg",
      cell: (row) => money(row.profit),
      total: money(data.totals.profit),
    },
    {
      key: "margin",
      header: "Margin",
      explain: EXPLAIN.margin,
      align: "end",
      hideBelow: "lg",
      cell: (row) => <Pct value={row.margin} />,
    },
    {
      key: "share",
      header: "Share of sales",
      explain: EXPLAIN.share,
      align: "end",
      hideBelow: "sm",
      cell: (row) => <Meter share={row.share} />,
    },
  ];

  const hourColumns: ReportColumn<HourRow>[] = [
    {
      key: "hour",
      header: "Hour",
      explain: EXPLAIN.hour,
      cell: (row) => (
        <span className="font-medium text-graphite-900">{row.label}</span>
      ),
    },
    {
      key: "bills",
      header: "Bills",
      explain: EXPLAIN.bills,
      align: "end",
      cell: (row) => row.bills.toLocaleString("en-PK"),
      total: data.totals.bills.toLocaleString("en-PK"),
    },
    {
      key: "sales",
      header: "Sales",
      explain: EXPLAIN.sales,
      align: "end",
      cell: (row) => money(row.sales),
      total: money(data.totals.sales),
    },
    {
      key: "busy",
      header: "Against the busiest hour",
      explain: {
        formula: "this hour's sales ÷ the best hour's sales × 100",
        plain:
          "Every hour measured against your busiest one, so the bars show the shape of a day rather than how big the month was.",
      },
      align: "end",
      cell: (row) => <Meter share={row.share} />,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard
          title="How you were paid"
          caption="What was actually handed over, by method"
          actions={<ExportButton kind="payments" params={params} what="rows" />}
        >
          {data.tenders.length === 0 ? (
            <p className="py-10 text-center text-[0.875rem] text-graphite-500">
              Nothing was taken in this period.
            </p>
          ) : (
            <>
              {data.tenders.map((row) => (
                <Figure
                  key={row.method}
                  label={row.label}
                  explain={EXPLAIN.tender}
                  value={money(row.amount)}
                  hint={`${row.bills.toLocaleString("en-PK")} ${row.bills === 1 ? "bill" : "bills"} · ${(row.share * 100).toFixed(1)}% of takings`}
                />
              ))}
              <Figure
                label="Taken in all"
                value={money(takings)}
                op="="
                strong
              />
            </>
          )}

          {cash ? (
            <Note>
              <span className="inline-flex items-center gap-1.5 font-semibold">
                <IconCash className="h-3.5 w-3.5" />
                {(cash.share * 100).toFixed(0)}% of this period came in as cash
              </span>
              <span className="mt-1 block">
                That is {money(cash.amount)} that passed through the drawer and
                has to get to the bank. The rest arrived through the machine.
              </span>
            </Note>
          ) : (
            <Note>
              <span className="inline-flex items-center gap-1.5">
                <IconCard className="h-3.5 w-3.5" />
                {EXPLAIN.tender.plain}
              </span>
            </Note>
          )}
        </ChartCard>

        <ChartCard
          title="Which counter took it"
          caption="Each till's own takings"
          bleed
          className="xl:col-span-2"
          actions={<ExportButton kind="counters" params={params} what="counters" />}
        >
          <ReportTable
            columns={people("Counter")}
            rows={data.counters}
            rowKey={(row) => row.id ?? "none"}
            totalLabel="Every counter"
            empty="No counter rang anything up in this period."
          />
          <div className="px-4 pt-1 pb-4">
            <Note>{EXPLAIN.counter.plain}</Note>
          </div>
        </ChartCard>
      </div>

      <ChartCard
        title="Who was on the till"
        caption="Bills by the person signed in when they were rung up"
        bleed
        actions={<ExportButton kind="cashiers" params={params} what="people" />}
      >
        <ReportTable
          columns={people("Cashier")}
          rows={data.cashiers}
          rowKey={(row) => row.id ?? "none"}
          totalLabel="Everyone"
          empty="Nobody rang anything up in this period."
        />
        <div className="px-4 pt-1 pb-4">
          <Note>
            {EXPLAIN.cashier.plain} This is a record of what was rung up, not a
            measure of how well somebody works — the person on the Saturday
            evening shift will always out-sell the person on Tuesday morning.
          </Note>
        </div>
      </ChartCard>

      <ChartCard
        title="When the shop is busy"
        caption="Every bill in the period, by the hour of day it was rung up"
        bleed
        actions={<ExportButton kind="hours" params={params} what="hours" />}
      >
        <ReportTable
          columns={hourColumns}
          rows={data.hours}
          rowKey={(row) => String(row.hour)}
          totalLabel="Right through the day"
          empty="Nothing was sold in this period."
        />
        <div className="px-4 pt-1 pb-4">
          <Note>{EXPLAIN.hour.plain}</Note>
        </div>
      </ChartCard>
    </div>
  );
}
