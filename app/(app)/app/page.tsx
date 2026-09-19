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
import { writeDayLong } from "@/lib/pos/history";
import { DEFAULT_SETTINGS } from "@/lib/pos/settings-options";
import { getShopSettings } from "@/lib/pos/shop";
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
  // The "not attached to a shop" gate that used to stand here is gone, so every
  // session reaches the dashboard — an account with a null `tenant_id` gets a
  // shop that has sold nothing, which is exactly what it has. The settings are
  // what turn the filter's window into trading days, so the defaults stand in
  // for the same reason the rail's shop name falls back rather than failing.
  const settings = session.tenantId
    ? await getShopSettings(session.tenantId)
    : DEFAULT_SETTINGS;

  const data = await getDashboardData(session.tenantId, range, settings);

  const { totals, previous, window } = data;
  // Counted off the trading days actually read, not off the filter's label: at
  // 1 am in a shop that shuts at 3 they are not the same number.
  const versus =
    window.days === 1 ? "vs the day before" : `vs previous ${window.days} days`;
  const covering =
    window.days === 1
      ? writeDayLong(window.to)
      : `${range.label} · ${window.days} trading days`;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[1.5rem] leading-tight font-bold">
            Good to see you
          </h1>
          <p className="mt-1 text-[0.8125rem] text-graphite-500">
            {covering} · {totals.transactions.toLocaleString("en-PK")} sales
            rung up
          </p>
        </div>

        <TimeframeFilter
          value={range.id}
          label={range.label}
          custom={range.custom}
        />
      </header>

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
          caption={`${range.label} · ${window.days === 1 ? "by hour" : window.days > 31 ? "by week" : "by day"}`}
          actions={<TrendLegend totals={totals} />}
          className="xl:col-span-2"
        >
          <TrendChart points={data.trend} />
        </ChartCard>

        <ChartCard
          title="Where the money came from"
          caption="Share of sales by department"
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
