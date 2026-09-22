import type { Metadata } from "next";
import Link from "next/link";

import { PlatformTrend } from "@/components/admin/platform-trend";
import { ChartCard } from "@/components/pos/chart-card";
import { DataTable, type Column } from "@/components/pos/data-table";
import {
  IconAlert,
  IconCart,
  IconCash,
  IconCustomers,
  IconDrawer,
  IconSales,
  IconStore,
} from "@/components/pos/icons";
import { KpiCard } from "@/components/pos/kpi-card";
import { rupees } from "@/lib/format";
import { delta } from "@/lib/pos/dashboard";
import { EXPLAIN, standingOf, writeExpiry, writeWhen } from "@/lib/platform/admin";
import { requirePlatform } from "@/lib/platform/access";
import { getOverview, listClients, type Client } from "@/lib/platform/console";

export const metadata: Metadata = {
  title: "Overview",
  description: "What the platform is worth this month, and who needs a call.",
};

/**
 * The screen you open with a cup of tea.
 *
 * Five figures, a shape, and three call lists, in that order, because that is
 * the order of the morning: what is Flo worth, is it going up, then who do I
 * ring before lunch.
 *
 * **Every figure here is measured against something.** `0038` widened
 * `platform_overview()` to return the same window over the previous month, so
 * the cards carry real movement rather than the row of "No comparison" they
 * showed when the figures were correct and the page still read like a mock.
 * The comparison is the same number of *elapsed* days — twenty-two days of
 * September against twenty-two days of August, never against the whole of it —
 * and the strip captions which days those are, because a percentage whose two
 * windows are different lengths is the commonest way a console misleads the
 * person running the business off it.
 *
 * **Three cards still carry no delta, deliberately.** MRR is contracted revenue
 * read off `subscriptions`, which stores only current state — there is no
 * history to compare it against, and a made-up prior month is worse than an
 * honest blank. "Shops trading" is the same. "Needs a call" is a queue length,
 * and a percentage change on a to-do list means nothing. `KpiCard` prints "No
 * comparison" for each, which is the true answer.
 *
 * **The one chart is of volume, not of shops.** This page used to argue that a
 * business with twelve clients has nothing to plot, and that is still true of
 * the client count — there is no chart of it. It was never true of what goes
 * through the product: a dozen shops ring up thousands of bills a month, and
 * whether that line climbs is what separates a product being used from one
 * merely sold.
 */
export default async function AdminHomePage() {
  await requirePlatform();

  const [overview, clients] = await Promise.all([getOverview(), listClients()]);

  // The month being compared against. The 1st is set before the month is
  // stepped back, or the 31st of a month walks into the one after last.
  const previous = new Date();
  previous.setDate(1);
  previous.setMonth(previous.getMonth() - 1);
  const previousMonth = previous.toLocaleDateString("en-PK", { month: "long" });

  const against =
    overview.elapsedDays > 0
      ? `vs the same ${overview.elapsedDays} days of ${previousMonth}`
      : `vs ${previousMonth}`;

  // Worst first: already over, then about to be. A list sorted by how soon the
  // money stops is a list you can work top-down and stop when you run out of
  // morning.
  const needCall = clients
    .filter(
      (client) => standingOf(client.status).operable && client.daysUntilExpiry <= 7,
    )
    .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

  // Paying, and not selling. The single best predictor that a shop is about to
  // stop paying — and the one thing a renewal call cannot tell you afterwards.
  const quiet = clients
    .filter(
      (client) => standingOf(client.status).operable && client.bills30d === 0,
    )
    .sort((a, b) => (a.lastSaleAt ?? "").localeCompare(b.lastSaleAt ?? ""));

  const newest = [...clients]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6);

  const trendTotal = overview.trend.reduce((sum, day) => sum + day.sales, 0);

  // `dormant` and `neverSold` count different populations and the caption has
  // to say which: `dormant` is trading shops three days without a sale — a
  // tighter net than this table's own thirty — while `neverSold` is every
  // tenant on Flo, cancelled ones included. Naming the population is the whole
  // point; a figure an operator cannot account for is one they stop believing.
  const quietCaption = ["Paying, but no bill rung up in thirty days."];

  if (overview.dormant > 0) {
    quietCaption.push(
      `${overview.dormant} trading ${overview.dormant === 1 ? "shop has" : "shops have"} gone three days without a sale.`,
    );
  }

  if (overview.neverSold > 0) {
    quietCaption.push(
      `${overview.neverSold} on Flo ${overview.neverSold === 1 ? "has" : "have"} never sold anything at all.`,
    );
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-[1.5rem] leading-tight font-bold">
          Platform overview
        </h1>
        <p className="mt-1 text-[0.8125rem] text-graphite-500">
          {overview.clients === 0
            ? "No shops yet. Activate the first one and the figures start here."
            : `${overview.clients} ${overview.clients === 1 ? "shop" : "shops"} on Flo. Figures are this month so far, measured ${against}.`}
        </p>
      </header>

      <section
        aria-label="What the platform is worth"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
      >
        <KpiCard
          label="Monthly revenue"
          amount={overview.mrr}
          note={
            overview.trialMrr > 0
              ? `Contracted. ${rupees(overview.trialMrr)} more on trial`
              : "Contracted, active and past-due shops only"
          }
          // `subscriptions` holds today's price and nothing about last month's,
          // so there is no previous MRR to compare against. The card beside it
          // is the one that moves.
          delta={null}
          icon={IconCash}
          explain={EXPLAIN.mrr}
        />
        <KpiCard
          label="Collected"
          amount={overview.collectedMonth}
          note={against}
          delta={delta(overview.collectedMonth, overview.collectedPrev)}
          tone="more-is-better"
          icon={IconDrawer}
          delay={60}
          explain={EXPLAIN.collected}
        />
        <KpiCard
          label="Shops trading"
          amount={overview.active + overview.trialing + overview.pastDue}
          prefix=""
          note={`${overview.addedMonth} joined this month · ${overview.trialing} on trial · ${overview.suspended + overview.cancelled} stopped`}
          delta={null}
          icon={IconStore}
          delay={120}
          explain={EXPLAIN.shopsTrading}
        />
        <KpiCard
          label="Needs a call"
          amount={overview.expiring7 + overview.expired}
          prefix=""
          note={
            overview.expired > 0
              ? `${overview.expired} already over the date`
              : overview.trialsEnding7 > 0
                ? `${overview.trialsEnding7} of them are trials ending`
                : "Ending inside a week"
          }
          delta={null}
          icon={IconAlert}
          delay={180}
          explain={EXPLAIN.needsCall}
        />
        <KpiCard
          label="Sold through Flo"
          amount={overview.salesMonth}
          note={`${overview.billsMonth.toLocaleString("en-PK")} bills · ${against}`}
          delta={delta(overview.salesMonth, overview.salesPrev)}
          tone="more-is-better"
          icon={IconSales}
          delay={240}
          explain={EXPLAIN.soldThroughFlo}
        />
      </section>

      {/* The two queues, only when there is something in them. A permanently
          empty "0 waiting" card is a card that stops being read. */}
      {overview.ordersToVerify > 0 || overview.leadsNew > 0 ? (
        <section className="grid gap-4 sm:grid-cols-2">
          {overview.ordersToVerify > 0 ? (
            <Queue
              href="/admin/orders"
              icon={<IconCart className="h-5 w-5" />}
              title={`${overview.ordersToVerify} payment ${overview.ordersToVerify === 1 ? "proof" : "proofs"} to check`}
              detail={
                overview.ordersWaiting > 0
                  ? `Match each against the bank statement, then verify. ${overview.ordersWaiting} more ${overview.ordersWaiting === 1 ? "order has" : "orders have"} paid nothing yet.`
                  : "Match each against the bank statement, then verify. Verifying activates the shop."
              }
            />
          ) : null}

          {overview.leadsNew > 0 ? (
            <Queue
              href="/admin/leads"
              icon={<IconCustomers className="h-5 w-5" />}
              title={`${overview.leadsNew} new ${overview.leadsNew === 1 ? "lead" : "leads"}`}
              detail="From the demo form. Each one has a WhatsApp link beside it."
            />
          ) : null}
        </section>
      ) : null}

      <ChartCard
        title="Sold through Flo"
        caption="Every shop, thirty days to today. Bills are in the tooltip — a count does not belong on a rupee axis."
        actions={
          <span className="pos-legend">
            <span className="font-semibold text-graphite-900 tabular-nums">
              {rupees(trendTotal)}
            </span>
            <span className="text-graphite-500">in thirty days</span>
          </span>
        }
      >
        <PlatformTrend points={overview.trend} />
      </ChartCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Running out"
          caption={
            overview.trialsEnding7 > 0
              ? `Still trading, period ends inside a week. Soonest first — ${overview.trialsEnding7} of them ${overview.trialsEnding7 === 1 ? "is a trial" : "are trials"}.`
              : "Still trading, period ends inside a week. Soonest first."
          }
          bleed
        >
          <ExpiryTable clients={needCall} />
        </ChartCard>

        <ChartCard
          title="Gone quiet"
          caption={quietCaption.join(" ")}
          bleed
        >
          <QuietTable clients={quiet} />
        </ChartCard>
      </div>

      <ChartCard
        title="Newest shops"
        caption={
          overview.addedMonth > 0
            ? `Most recently activated. ${overview.addedMonth} this month, ${overview.addedPrev} over the same days of ${previousMonth}.`
            : "Most recently activated."
        }
        bleed
      >
        <NewestTable clients={newest} />
      </ChartCard>
    </div>
  );
}

function Queue({
  href,
  icon,
  title,
  detail,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <Link href={href} className="pos-card flex items-start gap-3 p-4 hover:border-orchid-300">
      <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-orchid-50 text-orchid-700">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block font-display text-[0.9375rem] font-semibold text-graphite-900">
          {title}
        </span>
        <span className="mt-0.5 block text-[0.75rem] leading-snug text-graphite-500">
          {detail}
        </span>
      </span>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */

const shopCell = (client: Client) => (
  <Link
    href={`/admin/clients/${client.tenantId}`}
    className="block min-w-0 text-left"
  >
    <span className="block truncate font-medium text-graphite-900 underline-offset-2 hover:underline">
      {client.shopName}
    </span>
    <span className="block truncate text-[0.6875rem] text-graphite-500">
      {client.city} · {client.ownerName}
    </span>
  </Link>
);

function ExpiryTable({ clients }: { clients: Client[] }) {
  const columns: Column<Client>[] = [
    { key: "shop", header: "Shop", cell: shopCell },
    {
      key: "ends",
      header: "Period",
      explain: EXPLAIN.period,
      cell: (client) => (
        <span
          className={`pos-badge ${client.daysUntilExpiry < 0 ? "pos-badge-bad" : "pos-badge-warn"}`}
        >
          {writeExpiry(client.daysUntilExpiry)}
        </span>
      ),
    },
    {
      key: "worth",
      header: "A month",
      explain: EXPLAIN.monthly,
      align: "end",
      hideBelow: "sm",
      cell: (client) => rupees(client.monthlyValue),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={clients}
      rowKey={(client) => client.tenantId}
      empty="Nobody runs out this week. Shukriya."
    />
  );
}

function QuietTable({ clients }: { clients: Client[] }) {
  const columns: Column<Client>[] = [
    { key: "shop", header: "Shop", cell: shopCell },
    {
      key: "last",
      header: "Last bill",
      explain: EXPLAIN.lastBill,
      cell: (client) => (
        <span className={client.lastSaleAt ? "text-graphite-700" : "text-signal-bad"}>
          {client.lastSaleAt ? writeWhen(client.lastSaleAt) : "Never sold"}
        </span>
      ),
    },
    {
      key: "items",
      header: "Items",
      align: "end",
      hideBelow: "sm",
      cell: (client) => client.itemCount.toLocaleString("en-PK"),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={clients}
      rowKey={(client) => client.tenantId}
      empty="Every paying shop has billed something this month."
    />
  );
}

function NewestTable({ clients }: { clients: Client[] }) {
  const columns: Column<Client>[] = [
    { key: "shop", header: "Shop", cell: shopCell },
    {
      key: "plan",
      header: "Plan",
      hideBelow: "sm",
      cell: (client) => <span className="text-graphite-700">{client.planName}</span>,
    },
    {
      key: "status",
      header: "Standing",
      explain: EXPLAIN.standing,
      cell: (client) => {
        const status = standingOf(client.status);
        return (
          <span className={`pos-badge pos-badge-${status.tone}`}>{status.label}</span>
        );
      },
    },
    {
      key: "signed",
      header: "Signed in",
      hideBelow: "md",
      cell: (client) =>
        client.userCount > 0 ? (
          <span className="text-graphite-700">
            {client.userCount} {client.userCount === 1 ? "account" : "accounts"}
          </span>
        ) : (
          // The state worth chasing: sold, invited, never arrived.
          <span className="pos-badge pos-badge-warn">
            {client.inviteOpen ? "Invite unused" : "No account"}
          </span>
        ),
    },
    {
      key: "when",
      header: "Activated",
      align: "end",
      cell: (client) => writeWhen(client.createdAt),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={clients}
      rowKey={(client) => client.tenantId}
      empty="No shops yet. Press “Activate a shop” to bring the first one on."
    />
  );
}
