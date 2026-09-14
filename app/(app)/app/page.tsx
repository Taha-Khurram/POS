import type { Metadata } from "next";
import Link from "next/link";

import { CategoryBars } from "@/components/pos/category-bars";
import { ChartCard } from "@/components/pos/chart-card";
import {
  IconInventory,
  IconRegister,
  IconReports,
  IconSales,
} from "@/components/pos/icons";
import { KpiCard } from "@/components/pos/kpi-card";
import { RecentSalesTable } from "@/components/pos/recent-sales";
import { TimeframeFilter } from "@/components/pos/timeframe-filter";
import { TopProducts } from "@/components/pos/top-products";
import { TrendChart, TrendLegend } from "@/components/pos/trend-chart";
import { requireSession } from "@/lib/auth";
import { delta, getDashboardData } from "@/lib/pos/dashboard";
import { resolveTimeframe } from "@/lib/pos/timeframes";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Sales, profit, and stock movement for your counter.",
};

/**
 * The console's home screen.
 *
 * A server component end to end. The only JavaScript this route ships is the
 * time filter, the trend chart's hover layer, and the chrome around it — the
 * KPIs, both tables and the category bars are HTML by the time they reach the
 * tablet. On a Rs 25,000 Android device over 3G that is the difference between
 * a dashboard and a spinner.
 *
 * The window comes from `searchParams`, so every widget below is rendered from
 * one already-resolved range. Changing the period is a navigation, not a
 * cascade of client fetches, and the resulting URL can be sent to an
 * accountant.
 */
export default async function DashboardPage({ searchParams }: PageProps<"/app">) {
  const session = await requireSession();

  const range = resolveTimeframe(await searchParams);
  // Seeded off the signed-in account rather than a shop: the "not attached to a
  // shop" gate that used to stand here is gone, so every session reaches the
  // dashboard. The sample data only needs a stable key, and when the real
  // queries land this argument becomes the tenant the rows are scoped to.
  const data = await getDashboardData(session.userId, range);

  const { totals, previous } = data;
  const versus = range.id === "today" ? "vs yesterday" : `vs previous ${range.days} days`;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[1.5rem] leading-tight font-bold">
            Good to see you
          </h1>
          <p className="mt-1 text-[0.8125rem] text-graphite-500">
            {range.label} · {totals.transactions.toLocaleString("en-PK")} sales
            rung up
          </p>
        </div>

        <TimeframeFilter value={range.id} custom={range.custom} />
      </header>

      {/* The sample-data banner is not decoration. Every figure on this screen
          is plausible and none of it is real, and a dashboard that does not say
          so is how a shopkeeper ends up ordering stock against invented
          numbers. It disappears when `isSample` does. */}
      {data.isSample ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-sun-400/40 bg-sun-400/10 px-3.5 py-2.5 text-[0.8125rem] text-graphite-700">
          <span className="font-semibold text-graphite-900">Sample figures.</span>
          The register is not writing sales yet, so this screen is showing a
          worked example of what your counter will look like.
        </p>
      ) : null}

      <section aria-label="Headline figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Sales"
          amount={totals.sales}
          note={versus}
          delta={delta(totals.sales, previous.sales)}
          tone="more-is-better"
          icon={IconSales}
        />
        <KpiCard
          label="Profit"
          amount={totals.profit}
          note={versus}
          delta={delta(totals.profit, previous.profit)}
          tone="more-is-better"
          icon={IconReports}
          delay={90}
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
          delay={180}
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
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard
          title="Sales and profit"
          caption={`${range.label} · ${range.bucket === "hour" ? "by hour" : data.trend.length > 31 ? "by week" : "by day"}`}
          actions={<TrendLegend totals={totals} />}
          className="xl:col-span-2"
        >
          <TrendChart points={data.trend} />
        </ChartCard>

        <ChartCard
          title="Where the money came from"
          caption="Share of sales by category"
        >
          <CategoryBars slices={data.categories} />
        </ChartCard>
      </div>

      {/* Five columns rather than three: the best sellers read first, but the
          receipt table needs more room than a third of the row to seat six
          columns without wrapping. */}
      <div className="grid gap-4 xl:grid-cols-5">
        <ChartCard
          title="Top sellers"
          caption={range.label}
          className="xl:col-span-2"
        >
          <TopProducts products={data.topProducts} />
        </ChartCard>

        <ChartCard
          title="Recent sales"
          caption="Newest first"
          bleed
          className="xl:col-span-3"
          actions={
            <Link href="/app/sales" className="pos-btn pos-btn-quiet pos-btn-sm">
              See all
            </Link>
          }
        >
          <RecentSalesTable sales={data.recent} />
        </ChartCard>
      </div>
    </div>
  );
}
