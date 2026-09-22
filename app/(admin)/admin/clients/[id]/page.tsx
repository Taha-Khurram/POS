import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ChartCard } from "@/components/pos/chart-card";
import { DataTable, type Column } from "@/components/pos/data-table";
import { IconChevron } from "@/components/pos/icons";
import { InfoTip } from "@/components/pos/info-tip";
import { rupees } from "@/lib/format";
import type { Explainer } from "@/lib/pos/report";
import {
  EXPLAIN,
  standingOf,
  writeDay,
  writeExpiry,
  writeWhen,
} from "@/lib/platform/admin";
import { requirePlatform } from "@/lib/platform/access";
import {
  getClient,
  getInvites,
  getShopDetails,
  listAudit,
  listClientPayments,
  listNotes,
  listPlans,
  listShopUsers,
  type AuditRow,
} from "@/lib/platform/console";

import {
  DetailsCard,
  InvitePanel,
  LifecycleCard,
  NotesCard,
  OverridesCard,
  PaymentsCard,
  PlanCard,
} from "./panels";

export const metadata: Metadata = {
  title: "Client",
  description: "One shop: what they pay, what they get, and whether they use it.",
};

/**
 * One client's record.
 *
 * Ordered by what a support call actually needs, not by the schema: who they
 * are and whether they can trade, then the plan, then the money, then the
 * evidence. The health figures are up top because they decide the tone of the
 * call — a shop that has rung up four hundred bills this month is a renewal
 * conversation, and one that has never sold anything is a rescue.
 *
 * A support account gets every screen and none of the controls, and the cards
 * say so where the buttons would have been. That is presentation; each action
 * checks `requireBilling()` for itself.
 */
export default async function ClientPage({ params }: PageProps<"/admin/clients/[id]">) {
  const session = await requirePlatform();
  const { id } = await params;

  const client = await getClient(id);
  if (!client) notFound();

  const [plans, payments, invites, notes, users, details, audit] = await Promise.all([
    listPlans(),
    listClientPayments(client.tenantId),
    getInvites(client.tenantId),
    listNotes(client.tenantId),
    listShopUsers(client.tenantId),
    getShopDetails(client.tenantId),
    listAudit(client.tenantId),
  ]);

  const readOnly = session.platformRole !== "super_admin";
  const status = standingOf(client.status);
  const planFeatures =
    plans.find((plan) => plan.id === client.planId)?.features ?? {};

  return (
    <div className="space-y-4">
      <Link
        href="/admin/clients"
        className="inline-flex items-center gap-1 text-[0.8125rem] text-graphite-500 hover:text-graphite-900"
      >
        <IconChevron className="h-3.5 w-3.5 rotate-90" />
        All clients
      </Link>

      <header className="pos-card flex flex-wrap items-start gap-4 p-4 sm:p-5">
        <span
          className="grid h-12 w-12 flex-none place-items-center rounded-2xl bg-orchid-100 font-display text-[1.125rem] font-bold text-orchid-800"
          aria-hidden
        >
          {(client.shopName.trim()[0] ?? "F").toUpperCase()}
        </span>

        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[1.375rem] leading-tight font-bold">
            {client.shopName}
            <span className={`pos-badge pos-badge-${status.tone} ml-2 align-middle`}>
              {status.label}
            </span>
          </h1>

          <p className="mt-1 text-[0.8125rem] text-graphite-500">
            {client.ownerName} · {client.city} · {client.phone}
            {client.email ? ` · ${client.email}` : ""}
          </p>

          <p className="mt-1 text-[0.8125rem] text-graphite-700">
            {client.planName} · {rupees(client.agreedPrice)} a{" "}
            {client.billingCycle === "monthly"
              ? "month"
              : client.billingCycle === "quarterly"
                ? "quarter"
                : "year"}{" "}
            · {writeExpiry(client.daysUntilExpiry)} (to{" "}
            {writeDay(client.currentPeriodEnd)})
          </p>
        </div>

      </header>

      {/* Is this shop actually using Flo? The question a renewal call turns on,
          and the one a plan card cannot answer. */}
      <section aria-label="How the shop is doing" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Figure
          label="Last bill"
          value={client.lastSaleAt ? writeWhen(client.lastSaleAt) : "Never"}
          note={
            client.lastSaleAt
              ? "Their most recent sale"
              : "This shop has never rung anything up"
          }
          bad={!client.lastSaleAt}
          explain={EXPLAIN.lastBill}
        />
        <Figure
          label="Sold in 30 days"
          value={rupees(client.sales30d)}
          note={`${client.bills30d.toLocaleString("en-PK")} bills`}
          explain={EXPLAIN.sold30}
        />
        <Figure
          label="Products"
          value={client.itemCount.toLocaleString("en-PK")}
          note={
            client.itemCount === 0
              ? "No catalog yet — they cannot sell"
              : `${client.counterCount} ${client.counterCount === 1 ? "counter" : "counters"} open`
          }
          bad={client.itemCount === 0}
          explain={EXPLAIN.onShelf}
        />
        <Figure
          label="Paid to date"
          value={rupees(client.paidTotal)}
          note={
            client.lastPaidAt
              ? `Last ${writeWhen(client.lastPaidAt).toLowerCase()}`
              : "Nothing recorded yet"
          }
          explain={EXPLAIN.paidToDate}
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <PlanCard client={client} plans={plans} readOnly={readOnly} />
          <PaymentsCard client={client} payments={payments} readOnly={readOnly} />
          <DetailsCard client={client} details={details} readOnly={readOnly} />
        </div>

        <div className="space-y-4">
          <LifecycleCard client={client} readOnly={readOnly} />
          <InvitePanel
            client={client}
            invites={invites}
            users={users}
            readOnly={readOnly}
          />
          <OverridesCard
            client={client}
            planFeatures={planFeatures}
            readOnly={readOnly}
          />
          <NotesCard tenantId={client.tenantId} notes={notes} />
        </div>
      </div>

      <ChartCard
        title="What we have done to this account"
        caption="Append-only. Every change any operator made, newest first."
        bleed
      >
        <AuditTable rows={audit} />
      </ChartCard>
    </div>
  );
}

function Figure({
  label,
  value,
  note,
  bad = false,
  explain,
}: {
  label: string;
  value: string;
  note: string;
  bad?: boolean;
  /** How the figure is reached, from `EXPLAIN`. Nobody can check these against
   *  a till roll, so every one of them carries the sentence. */
  explain?: Explainer;
}) {
  return (
    <article className="pos-card p-4">
      <h2 className="flex items-center gap-1 font-display text-[0.8125rem] leading-tight font-semibold text-graphite-500">
        {label}
        {explain ? <InfoTip label={label} explain={explain} /> : null}
      </h2>
      <p
        className={`mt-2.5 font-display text-[1.5rem] leading-none font-bold tracking-tight tabular-nums ${bad ? "text-signal-bad" : "text-graphite-900"}`}
      >
        {value}
      </p>
      <p className="mt-2.5 text-[0.75rem] text-graphite-500">{note}</p>
    </article>
  );
}

function AuditTable({ rows }: { rows: AuditRow[] }) {
  const columns: Column<AuditRow>[] = [
    {
      key: "what",
      header: "What",
      cell: (row) => (
        <span className="font-mono text-[0.75rem] text-graphite-900">{row.action}</span>
      ),
    },
    {
      key: "who",
      header: "Who",
      cell: (row) => <span className="text-graphite-700">{row.actorEmail}</span>,
    },
    {
      key: "when",
      header: "When",
      align: "end",
      cell: (row) => (
        <span className="text-graphite-500">{writeWhen(row.createdAt)}</span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      empty="Nothing has been done to this account since it was made."
    />
  );
}
