import { ChartCard } from "@/components/pos/chart-card";
import {
  IconInventory,
  IconRegister,
  IconReports,
  IconSales,
} from "@/components/pos/icons";
import { KpiCard } from "@/components/pos/kpi-card";
import { ReportTable, type ReportColumn } from "@/components/pos/report-table";
import {
  delta,
  EXPLAIN,
  grainOf,
  type DayRow,
  type ReportData,
} from "@/lib/pos/report";

import { ExportButton } from "./export-button";
import { CostCaveat, Figure, Note, Pct } from "./parts";

/**
 * The period in one screen.
 *
 * Ordered the way the question is actually asked: what came in, what it cost,
 * what is left — then the same three figures day by day. The middle card is the
 * one that earns the tab. It is the sum written out as a sum, one line per
 * step with the operator in front of it, so an owner can read down it and check
 * the arithmetic rather than being handed a profit figure and asked to believe
 * it. Every line carries the tip that says where its number came from.
 */
export function SummaryTab({
  data,
  money,
  versus,
  params,
}: {
  data: ReportData;
  money: (amount: number) => string;
  versus: string;
  params: { range?: string; from?: string; to?: string };
}) {
  const { totals, previous, window } = data;
  const grain = grainOf(window.days);

  const best = data.days.reduce<DayRow | null>(
    (top, row) => (top === null || row.sales > top.sales ? row : top),
    null,
  );

  const columns: ReportColumn<DayRow>[] = [
    {
      key: "day",
      header: grain === "month" ? "Month" : "Trading day",
      explain: EXPLAIN.window,
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
      total: totals.bills.toLocaleString("en-PK"),
    },
    {
      key: "lines",
      header: "Lines",
      explain: EXPLAIN.lines,
      align: "end",
      hideBelow: "md",
      cell: (row) => row.lines.toLocaleString("en-PK"),
      total: totals.lines.toLocaleString("en-PK"),
    },
    {
      key: "sales",
      header: "Sales",
      explain: EXPLAIN.sales,
      align: "end",
      cell: (row) => money(row.sales),
      total: money(totals.sales),
    },
    {
      key: "cost",
      header: "Cost of goods",
      explain: EXPLAIN.cost,
      align: "end",
      hideBelow: "lg",
      cell: (row) => money(row.cost),
      total: money(totals.cost),
    },
    {
      key: "profit",
      header: "Profit",
      explain: EXPLAIN.profit,
      align: "end",
      cell: (row) => (
        <span className="font-semibold text-graphite-900">{money(row.profit)}</span>
      ),
      total: money(totals.profit),
    },
    {
      key: "margin",
      header: "Margin",
      explain: EXPLAIN.margin,
      align: "end",
      hideBelow: "sm",
      // A day with nothing on it has no margin, and 0.0% would read as a day
      // the shop sold at cost.
      cell: (row) => (row.sales > 0 ? <Pct value={row.margin} /> : "—"),
      total: <Pct value={totals.margin} />,
    },
    {
      key: "average",
      header: "Average bill",
      explain: EXPLAIN.average,
      align: "end",
      hideBelow: "lg",
      cell: (row) => (row.bills > 0 ? money(row.average) : "—"),
      total: money(totals.average),
    },
  ];

  return (
    <div className="space-y-4">
      <section
        aria-label="Headline figures"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <KpiCard
          label="Sales"
          amount={totals.sales}
          note={versus}
          delta={delta(totals.sales, previous.sales)}
          tone="more-is-better"
          icon={IconSales}
          explain={EXPLAIN.sales}
        />
        <KpiCard
          label="Cost of goods"
          amount={totals.cost}
          note={versus}
          delta={delta(totals.cost, previous.cost)}
          // Deliberately neutral. Cost rising during a stock-up week is the
          // shop working, not the shop bleeding, and the card cannot tell which.
          tone="neutral"
          icon={IconInventory}
          delay={90}
          explain={EXPLAIN.cost}
        />
        <KpiCard
          label="Profit"
          amount={totals.profit}
          note={versus}
          delta={delta(totals.profit, previous.profit)}
          tone="more-is-better"
          icon={IconReports}
          delay={180}
          explain={EXPLAIN.profit}
        />
        <KpiCard
          label="Margin"
          amount={totals.margin}
          prefix=""
          suffix="%"
          decimals={1}
          note={versus}
          delta={delta(totals.margin, previous.margin)}
          tone="more-is-better"
          icon={IconRegister}
          delay={270}
          explain={EXPLAIN.margin}
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="How the period added up"
          caption="Read it downwards — every line says where its figure came from"
        >
          <Figure
            label="Sales"
            explain={EXPLAIN.sales}
            value={money(totals.sales)}
            hint={`${totals.bills.toLocaleString("en-PK")} completed bills`}
          />
          <Figure
            label="Cost of goods"
            explain={EXPLAIN.cost}
            value={money(totals.cost)}
            op="−"
            hint="What those goods had cost you"
          />
          <Figure
            label="Profit"
            explain={EXPLAIN.profit}
            value={money(totals.profit)}
            op="="
            strong
            hint="Before rent, wages and bills"
          />
          <Figure
            label="Margin"
            explain={EXPLAIN.margin}
            value={<Pct value={totals.margin} />}
            hint="Of every hundred rupees that came in"
          />

          {totals.discount > 0 ? (
            <Figure
              label="Discounts given"
              explain={EXPLAIN.discount}
              value={money(totals.discount)}
              hint="Taken off bills before they were paid"
            />
          ) : null}

          <CostCaveat />
        </ChartCard>

        <ChartCard
          title="Bills and baskets"
          caption="What a typical visit to your counter looked like"
        >
          <Figure
            label="Bills"
            explain={EXPLAIN.bills}
            value={totals.bills.toLocaleString("en-PK")}
            hint="One customer, one visit"
          />
          <Figure
            label="Average bill"
            explain={EXPLAIN.average}
            value={money(totals.average)}
            hint="Sales ÷ bills"
          />
          <Figure
            label="Lines rung up"
            explain={EXPLAIN.lines}
            value={totals.lines.toLocaleString("en-PK")}
            hint="Two kilos of sugar is one line"
          />
          <Figure
            label="Lines per bill"
            explain={EXPLAIN.lines}
            value={
              totals.bills > 0
                ? (totals.lines / totals.bills).toFixed(1)
                : "—"
            }
            hint="How much a customer picks up in one trip"
          />

          {best && best.sales > 0 ? (
            <Figure
              label={grain === "month" ? "Best month" : "Best day"}
              value={money(best.sales)}
              hint={best.label}
              strong
            />
          ) : null}

          <Note>{EXPLAIN.completed.plain}</Note>
        </ChartCard>
      </div>

      <ChartCard
        title={grain === "month" ? "Sales month by month" : "Sales day by day"}
        caption={
          grain === "month"
            ? "Every month in the period, whether or not it sold anything"
            : "Every trading day in the period, whether or not it sold anything"
        }
        bleed
        actions={<ExportButton kind="days" params={params} what="rows" />}
      >
        <ReportTable
          columns={columns}
          rows={data.days}
          rowKey={(row) => row.day}
          totalLabel={`All ${data.days.length} ${grain === "month" ? "months" : "days"}`}
          empty="No trading days in this period."
        />
      </ChartCard>
    </div>
  );
}
