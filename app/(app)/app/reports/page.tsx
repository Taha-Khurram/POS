import type { Metadata } from "next";
import Link from "next/link";

import {
  IconBox,
  IconCash,
  IconInventory,
  IconLayers,
  IconReports,
} from "@/components/pos/icons";
import { requireModule } from "@/lib/pos/access";
import { currentBusinessDay, moneyFormatter } from "@/lib/pos/counter";
import { writeDayLong } from "@/lib/pos/history";
import {
  DEFAULT_RANGE,
  isReportRange,
  resolveReportWindow,
  writeDay,
  type ReportRangeId,
} from "@/lib/pos/report";
import { getReportData, getStockReport } from "@/lib/pos/reports";
import { getShopSettings, listCounters } from "@/lib/pos/shop";
import { listStaff } from "@/lib/pos/staff";

import { CountersTab } from "./counters";
import { DepartmentsTab } from "./departments";
import { PeriodPicker } from "./period-picker";
import { PeriodNote } from "./parts";
import { isProductSort, ProductsTab, type ProductSort } from "./products";
import { StockTab } from "./stock";
import { SummaryTab } from "./summary";

export const metadata: Metadata = {
  title: "Reports",
  description: "What the shop took, what it cost, and what is left.",
};

const TABS = [
  { id: "summary", label: "Summary", icon: IconReports },
  { id: "products", label: "Items", icon: IconBox },
  { id: "departments", label: "Departments", icon: IconLayers },
  { id: "counters", label: "Payments & counters", icon: IconCash },
  { id: "stock", label: "Stock value", icon: IconInventory },
] as const;

type TabId = (typeof TABS)[number]["id"];

const isTab = (value: unknown): value is TabId =>
  TABS.some((tab) => tab.id === value);

const asString = (value: unknown) =>
  typeof value === "string" ? value : undefined;

/**
 * Reports.
 *
 * The numbers an owner takes to their accountant, and the ones they check
 * before ordering stock. Five tabs over one period, because they are five
 * genuinely different questions — what the period came to, which items made
 * it, which half of the shop made it, how it was paid for and by whose till,
 * and what is still sitting on the shelves.
 *
 * Three things hold the whole screen together:
 *
 * **One read per period.** Four of the five tabs are drawn from a single call
 * to `public.reports_summary`, grouped in Postgres. A financial year of a busy
 * kiryana is hundreds of thousands of sale lines and none of it has any
 * business crossing shop 3G. The stock tab reads nothing from it at all — it is
 * not windowed — so it skips that query entirely.
 *
 * **Everything is in the URL.** The tab, the period, the custom dates and the
 * item sort. So the page stays a server component, the tables are HTML on first
 * paint, and "how did September go" is a link somebody can send to their
 * accountant and know they are looking at the same figures.
 *
 * **Every figure can say how it was worked out.** `EXPLAIN` in
 * `lib/pos/report.ts` holds one sentence per figure, and the hover tips, the
 * card captions and the CSV headings all read from it. A report is only worth
 * anything if the owner believes the number; the fastest way to lose that is
 * for two parts of the screen to explain the same figure differently.
 *
 * The only JavaScript this route ships is the period picker and the export
 * buttons. The tips are pure CSS — see `.pos-info` in `globals.css`.
 */
export default async function ReportsPage({
  searchParams,
}: PageProps<"/app/reports">) {
  const session = await requireModule("reports");

  if (!session.tenantId) return <NotAttached />;

  const params = await searchParams;
  const tab: TabId = isTab(params.tab) ? params.tab : "summary";
  const sort: ProductSort = isProductSort(params.sort) ? params.sort : "sales";

  const settings = await getShopSettings(session.tenantId);
  const money = moneyFormatter(settings);
  const today = currentBusinessDay(settings);

  const range: ReportRangeId = isReportRange(params.range)
    ? params.range
    : DEFAULT_RANGE;

  const window = resolveReportWindow(range, today, settings, {
    from: asString(params.from),
    to: asString(params.to),
  });

  // Only the keys that are actually set, so a link built from these does not
  // carry `range=undefined` into the URL bar.
  const link: { range?: string; from?: string; to?: string } = { range };
  if (range === "custom") {
    link.from = window.from;
    link.to = window.to;
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[1.5rem] leading-tight font-bold">
            Reports
          </h1>
          <p className="mt-1 text-[0.8125rem] text-graphite-500">
            What the shop took, what it cost, and what is left. Hover any{" "}
            <span className="font-semibold text-graphite-700">ⓘ</span> to see how
            a figure is worked out.
          </p>
        </div>

        {/* The stock tab is a count of what is on the shelf right now, so a
            period picker above it would be a control that changes nothing —
            worse, one that makes the figures look windowed when they are not. */}
        {tab === "stock" ? (
          <p className="pos-badge pos-badge-info">
            Counted today · {writeDayLong(today)}
          </p>
        ) : (
          <PeriodPicker
            range={range}
            window={window}
            settings={settings}
            today={today}
            tab={tab}
          />
        )}
      </header>

      <nav className="pos-tabs" aria-label="Report sections">
        {TABS.map((item) => (
          <Link
            key={item.id}
            href={{
              pathname: "/app/reports",
              query: { ...link, tab: item.id },
            }}
            className="pos-tab"
            aria-current={item.id === tab ? "page" : undefined}
            scroll={false}
          >
            <item.icon className="pos-tab-icon h-4 w-4" />
            {item.label}
          </Link>
        ))}
      </nav>

      {tab === "stock" ? (
        <StockReportTab
          tenantId={session.tenantId}
          money={money}
          today={writeDayLong(today)}
        />
      ) : (
        <WindowedTab
          tenantId={session.tenantId}
          settings={settings}
          money={money}
          window={window}
          tab={tab}
          sort={sort}
          link={link}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The four tabs that share one read.
 *
 * All of `reports_summary` is fetched whichever of them is open, and that is
 * deliberate rather than lazy: the aggregates are computed in one pass over the
 * same scoped set of sales, so asking for a quarter of them would cost the same
 * scan and four more round trips as the owner moves between tabs.
 */
async function WindowedTab({
  tenantId,
  settings,
  money,
  window,
  tab,
  sort,
  link,
}: {
  tenantId: string;
  settings: Awaited<ReturnType<typeof getShopSettings>>;
  money: (amount: number) => string;
  window: ReturnType<typeof resolveReportWindow>;
  tab: Exclude<TabId, "stock">;
  sort: ProductSort;
  link: { range?: string; from?: string; to?: string };
}) {
  const [counters, staff] = await Promise.all([
    listCounters(tenantId),
    listStaff(tenantId),
  ]);

  const data = await getReportData(tenantId, window, settings, {
    counters: counters.map((counter) => ({ id: counter.id, name: counter.name })),
    staff: staff.map((member) => ({ id: member.id, name: member.name })),
  });

  // Written from the trading days actually read, never from the period's name:
  // at 1 am in a shop that shuts at 3 they are not the same span, and a caption
  // that said "This month" over a window clamped to yesterday would be the one
  // sentence on the screen an owner could not check.
  const covering =
    window.from === window.to
      ? writeDayLong(window.to)
      : `${writeDay(window.from)} – ${writeDayLong(window.to)}`;

  const versus =
    window.previous.from === window.previous.to
      ? writeDayLong(window.previous.to)
      : `${writeDay(window.previous.from)} – ${writeDayLong(window.previous.to)}`;

  const note =
    window.days === 1 ? "vs the day before" : `vs the previous ${window.days} days`;

  return (
    <div className="space-y-4">
      <PeriodNote covering={covering} days={window.days} versus={versus} />

      {tab === "products" ? (
        <ProductsTab data={data} money={money} sort={sort} params={link} />
      ) : tab === "departments" ? (
        <DepartmentsTab data={data} money={money} params={link} />
      ) : tab === "counters" ? (
        <CountersTab data={data} money={money} params={link} />
      ) : (
        <SummaryTab data={data} money={money} versus={note} params={link} />
      )}
    </div>
  );
}

async function StockReportTab({
  tenantId,
  money,
  today,
}: {
  tenantId: string;
  money: (amount: number) => string;
  today: string;
}) {
  const stock = await getStockReport(tenantId);

  return <StockTab stock={stock} money={money} today={today} />;
}

/** Same words as the register's gate and the sales screen's, because it is the
 *  same problem. */
function NotAttached() {
  return (
    <div className="pos-card mx-auto max-w-lg p-6">
      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-orchid-50 text-orchid-700">
        <IconReports className="h-5 w-5" />
      </span>

      <h1 className="mt-4 font-display text-[1.375rem] font-bold">
        Account not attached yet
      </h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-graphite-700">
        You are signed in, but this login is not linked to a shop, so there is
        nothing to report on. Message us on the same WhatsApp number you
        arranged Flo on and we will attach it.
      </p>
    </div>
  );
}
