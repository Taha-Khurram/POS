import type { Metadata } from "next";
import Link from "next/link";

import { ChartCard } from "@/components/pos/chart-card";
import { DataTable, type Column } from "@/components/pos/data-table";
import {
  IconAlert,
  IconCart,
  IconCash,
  IconCustomers,
  IconSales,
  IconStore,
} from "@/components/pos/icons";
import { KpiCard } from "@/components/pos/kpi-card";
import { rupees } from "@/lib/format";
import {
  renewalMessage,
  statusOf,
  waLink,
  writeExpiry,
  writeWhen,
} from "@/lib/platform/admin";
import { requirePlatform } from "@/lib/platform/access";
import { getOverview, listClients, type Client } from "@/lib/platform/console";

export const metadata: Metadata = {
  title: "Overview",
  description: "What the platform is worth this month, and who needs a call.",
};

/**
 * The screen you open with a cup of tea.
 *
 * Four figures and three call lists, in that order, because that is the order
 * of the morning: what is Flo worth, then who do I ring before lunch. Nothing
 * here is a chart — a business with twelve clients has nothing to plot, and a
 * sparkline of two data points is decoration pretending to be information. The
 * charts arrive when there are enough shops for a trend to mean anything.
 */
export default async function AdminHomePage() {
  await requirePlatform();

  const [overview, clients] = await Promise.all([getOverview(), listClients()]);

  // Worst first: already over, then about to be. A list sorted by how soon the
  // money stops is a list you can work top-down and stop when you run out of
  // morning.
  const needCall = clients
    .filter(
      (client) =>
        client.status !== null &&
        statusOf(client.status).operable &&
        client.daysUntilExpiry <= 7,
    )
    .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

  // Paying, and not selling. The single best predictor that a shop is about to
  // stop paying — and the one thing a renewal call cannot tell you afterwards.
  const quiet = clients
    .filter(
      (client) =>
        client.status !== null &&
        statusOf(client.status).operable &&
        client.bills30d === 0,
    )
    .sort((a, b) => (a.lastSaleAt ?? "").localeCompare(b.lastSaleAt ?? ""));

  const newest = [...clients]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-[1.5rem] leading-tight font-bold">
          Platform overview
        </h1>
        <p className="mt-1 text-[0.8125rem] text-graphite-500">
          {overview.clients === 0
            ? "No shops yet. Activate the first one and the figures start here."
            : `${overview.clients} ${overview.clients === 1 ? "shop" : "shops"} on Flo.`}
        </p>
      </header>

      <section aria-label="What the platform is worth" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Monthly revenue"
          amount={overview.mrr}
          note={
            overview.trialMrr > 0
              ? `${rupees(overview.trialMrr)} more on trial`
              : "Active and past-due shops only"
          }
          delta={null}
          icon={IconCash}
        />
        <KpiCard
          label="Shops trading"
          amount={overview.active + overview.trialing + overview.pastDue}
          prefix=""
          note={`${overview.trialing} on trial · ${overview.suspended + overview.cancelled} stopped`}
          delta={null}
          icon={IconStore}
          delay={60}
        />
        <KpiCard
          label="Needs a call"
          amount={overview.expiring7 + overview.expired}
          prefix=""
          note={
            overview.expired > 0
              ? `${overview.expired} already over the date`
              : "Ending inside a week"
          }
          delta={null}
          icon={IconAlert}
          delay={120}
        />
        <KpiCard
          label="Sold through Flo"
          amount={overview.salesMonth}
          note={`${overview.billsMonth.toLocaleString("en-PK")} bills this month`}
          delta={null}
          icon={IconSales}
          delay={180}
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
              detail="Match each against the bank statement, then verify. Verifying activates the shop."
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

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Running out"
          caption="Still trading, period ends inside a week. Soonest first."
          bleed
        >
          <ExpiryTable clients={needCall} />
        </ChartCard>

        <ChartCard
          title="Gone quiet"
          caption="Paying, but no bill rung up in thirty days."
          bleed
        >
          <QuietTable clients={quiet} />
        </ChartCard>
      </div>

      <ChartCard title="Newest shops" caption="Most recently activated." bleed>
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
      align: "end",
      hideBelow: "sm",
      cell: (client) => rupees(client.monthlyValue),
    },
    {
      key: "nudge",
      header: "",
      align: "end",
      cell: (client) => (
        // The message is written for them and the link opens the chat with it
        // already typed. A renewal nudge that has to be composed at 9 am is a
        // renewal nudge that goes out at 4 pm.
        <a
          href={waLink(
            client.phone,
            renewalMessage(client.shopName, client.daysUntilExpiry),
          )}
          target="_blank"
          rel="noreferrer"
          className="pos-btn pos-btn-soft pos-btn-sm"
        >
          Nudge
        </a>
      ),
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
      cell: (client) => {
        const status = statusOf(client.status ?? "active");
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
