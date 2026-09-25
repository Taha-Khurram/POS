import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ProofPreview } from "@/components/admin/proof-preview";
import { ChartCard } from "@/components/pos/chart-card";
import { DataTable, type Column } from "@/components/pos/data-table";
import {
  IconCash,
  IconChevron,
  IconClock,
  IconDashboard,
  IconHistory,
  IconKey,
  IconPencil,
  IconStore,
} from "@/components/pos/icons";
import { InfoTip } from "@/components/pos/info-tip";
import { rupees } from "@/lib/format";
import type { Explainer } from "@/lib/pos/report";
import {
  EXPLAIN,
  isOwner,
  lapseOf,
  standingOf,
  writeDay,
  writeExpiry,
  writeWhen,
} from "@/lib/platform/admin";
import { requireScreen } from "@/lib/platform/access";
import { describeEntry } from "@/lib/platform/audit";
import {
  getClient,
  getClientOrder,
  getShopDetails,
  listAudit,
  listClientPayments,
  listNotes,
  listPlans,
  listShopUsers,
  type AuditRow,
} from "@/lib/platform/console";

import {
  ActivateCard,
  DetailsCard,
  LifecycleCard,
  LoginCard,
  NotesCard,
  PaymentsCard,
  PlanCard,
} from "./panels";

export const metadata: Metadata = {
  title: "Client",
  description: "One shop: what they pay, what they get, and whether they use it.",
};

const TABS = [
  { id: "overview", label: "Overview", icon: IconDashboard },
  { id: "standing", label: "Standing", icon: IconClock },
  { id: "payments", label: "Payments", icon: IconCash },
  { id: "details", label: "Details", icon: IconStore },
  { id: "login", label: "Owner login", icon: IconKey },
  { id: "notes", label: "Notes", icon: IconPencil },
  { id: "activity", label: "Activity", icon: IconHistory },
] as const;

type TabId = (typeof TABS)[number]["id"];

const isTab = (value: unknown): value is TabId =>
  TABS.some((tab) => tab.id === value);

/**
 * One client's record.
 *
 * One tab per job, in the order a support call needs them, and in the URL the
 * way `/app/purchasing`'s are — so the tab survives a reload and can be sent
 * as a link. The header stays above every tab, because who this is and whether
 * they can trade is the context for every other question. The health figures
 * open the Overview because they decide the tone of the call — a shop that has
 * rung up four hundred bills this month is a renewal conversation, and one
 * that has never sold anything is a rescue.
 *
 * Standing is not drawn until there is a subscription: every one of its
 * actions updates a row that does not exist yet, so asking for it falls back
 * to the Overview, where the activation card is the one thing to do.
 *
 * A team member given Clients gets the whole record except Activity, which is
 * the audit trail and the owner's alone. Each action checks `requireWrite()`
 * for itself.
 */
export default async function ClientPage({
  params,
  searchParams,
}: PageProps<"/admin/clients/[id]">) {
  const session = await requireScreen("clients");
  const owner = isOwner(session.platformRole);
  const { id } = await params;
  const query = await searchParams;

  const client = await getClient(id);
  if (!client) notFound();

  const [plans, payments, order, notes, users, details, audit] = await Promise.all([
    listPlans(),
    listClientPayments(client.tenantId),
    getClientOrder(client.tenantId),
    listNotes(client.tenantId),
    listShopUsers(client.tenantId),
    getShopDetails(client.tenantId),
    // The Activity tab is the audit trail cut to one shop, so it is the
    // owner's alone — and `audit_log_read_owner` would hand a member nothing.
    owner ? listAudit(client.tenantId) : Promise.resolve<AuditRow[]>([]),
  ]);

  const readOnly = !session.screens.includes("clients");
  const activated = client.status !== null;
  // The badge says what the till is doing now, through the same `lapseOf` the
  // register reads — not whatever the sweep last wrote.
  const status = standingOf(
    client.status && client.currentPeriodEnd
      ? lapseOf(client.status, client.currentPeriodEnd, client.graceDays).status
      : client.status,
  );
  const held = payments.reduce((sum, payment) => sum + payment.amount, 0);

  const tabs = TABS.filter(
    (item) => (item.id !== "standing" || activated) && (item.id !== "activity" || owner),
  );
  const asked: TabId = isTab(query.tab) ? query.tab : "overview";
  const tab: TabId = tabs.some((item) => item.id === asked) ? asked : "overview";
  const hrefOf = (to: TabId) =>
    to === "overview" ? `/admin/clients/${id}` : `/admin/clients/${id}?tab=${to}`;
  const countOf = (to: TabId) =>
    to === "payments" ? payments.length : to === "notes" ? notes.length : undefined;

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

          {activated ? (
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
          ) : (
            <p className="mt-1 text-[0.8125rem] text-graphite-700">
              {order ? `Accepted from order ${order.reference}. ` : ""}
              Not on a plan yet —{" "}
              <Link
                href={hrefOf("overview")}
                scroll={false}
                className="font-semibold underline underline-offset-2"
              >
                activate it on the Overview
              </Link>
              .
            </p>
          )}
        </div>

      </header>

      <nav className="pos-tabs" aria-label="Client sections">
        {tabs.map((item) => {
          const count = countOf(item.id);

          return (
            <Link
              key={item.id}
              href={hrefOf(item.id)}
              className="pos-tab"
              aria-current={item.id === tab ? "page" : undefined}
              scroll={false}
            >
              <item.icon className="pos-tab-icon h-4 w-4" />
              {item.label}
              {count === undefined ? null : (
                <span className="pos-tab-count">{count.toLocaleString("en-PK")}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {tab === "overview" ? (
        <>
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

          {activated ? (
            <PlanCard client={client} plans={plans} readOnly={readOnly} />
          ) : (
            <ActivateCard
              client={client}
              order={order}
              plans={plans}
              paidSoFar={held}
              readOnly={readOnly}
            />
          )}
        </>
      ) : tab === "standing" ? (
        <LifecycleCard client={client} readOnly={readOnly} />
      ) : tab === "payments" ? (
        <>
          <PaymentsCard client={client} payments={payments} readOnly={readOnly} />
          {/* The screenshot the order was accepted on, kept with the client it
              became — the question "what did they actually send us" comes up at
              renewal, long after the order queue has moved on. */}
          {order?.proofKind ? (
            <ChartCard
              title="Payment proof"
              caption={`Sent with order ${order.reference}${order.proofUploadedAt ? `, ${writeDay(order.proofUploadedAt)}` : ""}.`}
            >
              <ProofPreview
                src={`/admin/orders/${order.id}/proof`}
                kind={order.proofKind}
                label={order.reference}
              />
            </ChartCard>
          ) : null}
        </>
      ) : tab === "details" ? (
        <DetailsCard client={client} details={details} readOnly={readOnly} />
      ) : tab === "login" ? (
        <LoginCard client={client} users={users} readOnly={readOnly} />
      ) : tab === "notes" ? (
        <NotesCard tenantId={client.tenantId} notes={notes} />
      ) : (
        <ChartCard
          title="What we have done to this account"
          caption="Append-only. Every change any operator made, newest first."
          bleed
        >
          <AuditTable rows={audit} />
        </ChartCard>
      )}
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
  // The same sentence the audit trail draws, so an entry reads the one way
  // wherever an operator meets it.
  const columns: Column<AuditRow>[] = [
    {
      key: "what",
      header: "What happened",
      cell: (row) => {
        const line = describeEntry(row);
        return (
          <span className="block whitespace-normal">
            <span className="text-graphite-900">
              <span className="font-semibold">{line.actor}</span> {line.did}
            </span>
            {line.detail ? (
              <span className="mt-0.5 block text-[0.75rem] text-graphite-500">
                {line.detail}
              </span>
            ) : null}
          </span>
        );
      },
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
