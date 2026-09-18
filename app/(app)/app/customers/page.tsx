import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DataTable, type Column } from "@/components/pos/data-table";
import { ChartCard } from "@/components/pos/chart-card";
import { IconChevron, IconUser } from "@/components/pos/icons";
import { requireModule } from "@/lib/pos/access";
import {
  initialsOf,
  writePhone,
  type Customer,
  type CustomerHistory,
} from "@/lib/pos/customer";
import {
  getCustomer,
  getCustomerHistory,
  listCustomers,
} from "@/lib/pos/customers";
import { moneyFormatter, writeBusinessDay } from "@/lib/pos/counter";
import { getShopSettings } from "@/lib/pos/shop";
import { CustomersPanel, EditCustomerButton } from "./customers-panel";

export const metadata: Metadata = {
  title: "Customers",
  description: "Your regulars, their numbers, and what each one has bought.",
};

/**
 * The shop's regulars.
 *
 * Two screens behind one route, chosen by `?customer=<id>` the way Settings
 * picks a counter: without it, the list; with it, that customer's record. The
 * page stays a server component either way — the list is HTML on first paint,
 * and the record needs a query per customer that has no business running in the
 * browser.
 *
 * There is no balance on this screen and there is not going to be one. The
 * udhaar khata — a ledger, a per-customer limit at the register, ageing buckets
 * — was specified and is not being built, so what a customer is here is a name,
 * a number to reach them on, and the bills attached to them.
 */
export default async function CustomersPage({
  searchParams,
}: PageProps<"/app/customers">) {
  const session = await requireModule("customers");

  if (!session.tenantId) return <NotAttached />;

  const asked = (await searchParams).customer;
  const customerId = typeof asked === "string" ? asked : null;

  if (customerId) return <Record tenantId={session.tenantId} id={customerId} />;

  const customers = await listCustomers(session.tenantId);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-[1.5rem] leading-tight font-bold">
          Customers
        </h1>
        <p className="mt-1 text-[0.8125rem] text-graphite-500">
          The people the shop knows by name, and the number to reach them on.
        </p>
      </header>

      <CustomerStats customers={customers} />
      <CustomersPanel customers={customers} />
    </div>
  );
}

/**
 * Three figures, and deliberately not four.
 *
 * What is missing is anything about money — "spent this month", "top customer"
 * — and it is missing because totalling it means reading every sale the shop
 * has ever made on a screen whose job is a list of names. That figure belongs
 * on Reports, off a query written for it.
 */
function CustomerStats({ customers }: { customers: Customer[] }) {
  const withPhone = customers.filter((customer) => customer.phone).length;
  const off = customers.filter((customer) => !customer.isActive).length;

  const tiles = [
    {
      label: "On the list",
      value: customers.length.toLocaleString("en-PK"),
      note:
        customers.length === 0
          ? "Nobody yet"
          : `${off} switched off`,
    },
    {
      label: "With a phone number",
      value: withPhone.toLocaleString("en-PK"),
      note:
        customers.length === 0
          ? "A number is how you reach them"
          : `${customers.length - withPhone} without one`,
    },
    {
      label: "The till can bill",
      value: (customers.length - off).toLocaleString("en-PK"),
      note: "Come up in the register's search",
    },
  ];

  return (
    <section
      aria-label="The customer list at a glance"
      className="grid gap-4 sm:grid-cols-3"
    >
      {tiles.map((tile) => (
        <article key={tile.label} className="pos-card p-4">
          <h2 className="font-display text-[0.8125rem] leading-tight font-semibold text-graphite-500">
            {tile.label}
          </h2>

          <p className="mt-2.5 font-display text-[1.75rem] leading-none font-bold tracking-tight text-graphite-900 tabular-nums">
            {tile.value}
          </p>

          <p className="mt-2.5 text-[0.75rem] text-graphite-500">{tile.note}</p>
        </article>
      ))}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * One customer, and what they have bought.
 *
 * `notFound()` for an id that is not this shop's, rather than a message: the
 * same call `requireModule` makes, and for the same reason — a screen that says
 * "that customer is not yours" has confirmed the customer exists.
 */
async function Record({ tenantId, id }: { tenantId: string; id: string }) {
  const [customer, settings] = await Promise.all([
    getCustomer(tenantId, id),
    getShopSettings(tenantId),
  ]);

  if (!customer) notFound();

  const history = await getCustomerHistory(tenantId, customer.id);
  const money = moneyFormatter(settings);

  const columns: Column<CustomerHistory["receipts"][number]>[] = [
    {
      key: "receipt",
      header: "Bill",
      cell: (receipt) => (
        <span className="font-mono text-[0.8125rem] text-graphite-900">
          {receipt.receiptNo}
        </span>
      ),
    },
    {
      key: "day",
      header: "Trading day",
      cell: (receipt) => (
        <span className="text-graphite-700">
          {writeBusinessDay(receipt.businessDay)}
        </span>
      ),
    },
    {
      key: "total",
      header: "Total",
      align: "end",
      cell: (receipt) => money(receipt.total),
    },
  ];

  return (
    <div className="space-y-4">
      <Link
        href="/app/customers"
        className="inline-flex items-center gap-1 text-[0.8125rem] text-graphite-500 hover:text-graphite-900"
      >
        <IconChevron className="h-3.5 w-3.5 rotate-90" />
        All customers
      </Link>

      <header className="pos-card flex flex-wrap items-start gap-4 p-4 sm:p-5">
        <span
          className="grid h-12 w-12 flex-none place-items-center rounded-full bg-orchid-100 font-display text-[0.9375rem] font-bold text-orchid-800"
          aria-hidden
        >
          {initialsOf(customer.name)}
        </span>

        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[1.375rem] leading-tight font-bold">
            {customer.name}
            {customer.isActive ? null : (
              <span className="pos-badge pos-badge-warn ml-2 align-middle">
                Switched off
              </span>
            )}
          </h1>

          <dl className="mt-2 grid gap-x-6 gap-y-1 text-[0.8125rem] sm:grid-cols-2">
            <Detail label="Phone" value={writePhone(customer.phone)} mono />
            <Detail label="Email" value={customer.email} />
            <Detail label="Where" value={customer.address} />
          </dl>

          {customer.notes ? (
            <p className="mt-3 rounded-xl border border-orchid-100 bg-orchid-50/60 px-3 py-2 text-[0.8125rem] leading-relaxed text-graphite-700">
              {customer.notes}
            </p>
          ) : null}
        </div>

        <EditCustomerButton customer={customer} />
      </header>

      <section aria-label="What they have bought" className="grid gap-4 sm:grid-cols-3">
        <Figure
          label="Bills"
          value={history.bills.toLocaleString("en-PK")}
          note="Rung up under their name"
        />
        <Figure
          label="Spent"
          value={money(history.spent)}
          note="Across those bills"
        />
        <Figure
          label="Last in"
          value={
            history.lastBillOn ? writeBusinessDay(history.lastBillOn) : "Never"
          }
          note={
            history.lastBillOn
              ? "Their most recent bill"
              : "No bill has named them yet"
          }
        />
      </section>

      <ChartCard
        title="Their bills"
        // Said out loud rather than papered over. The reader caps at a hundred,
        // and a total that quietly stops counting is worse than one that says
        // where it stops.
        caption={
          history.bills >= 100
            ? "The last 100 bills. The figures above are for these."
            : "Newest first."
        }
        bleed
      >
        <DataTable
          columns={columns}
          rows={history.receipts}
          rowKey={(receipt) => receipt.id}
          empty="No bill has been rung up under their name yet. Pick them on the register before you charge, and it will show here."
        />
      </ChartCard>
    </div>
  );
}

function Detail({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <dt className="flex-none text-graphite-500">{label}</dt>
      <dd
        className={`min-w-0 truncate text-graphite-900 ${mono ? "font-mono" : ""}`}
      >
        {value || <span className="text-graphite-500">—</span>}
      </dd>
    </div>
  );
}

function Figure({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <article className="pos-card p-4">
      <h2 className="font-display text-[0.8125rem] leading-tight font-semibold text-graphite-500">
        {label}
      </h2>
      <p className="mt-2.5 font-display text-[1.5rem] leading-none font-bold tracking-tight text-graphite-900 tabular-nums">
        {value}
      </p>
      <p className="mt-2.5 text-[0.75rem] text-graphite-500">{note}</p>
    </article>
  );
}

/** Same words as the register's, Settings' and Products & stock's gate — it is
 *  one problem. */
function NotAttached() {
  return (
    <div className="pos-card mx-auto max-w-lg p-6">
      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-orchid-50 text-orchid-700">
        <IconUser className="h-5 w-5" />
      </span>

      <h1 className="mt-4 font-display text-[1.375rem] font-bold">
        Account not attached yet
      </h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-graphite-700">
        You are signed in, but this login is not linked to a shop, so there is no
        customer list to show. Message us on the same WhatsApp number you
        arranged Flo on and we will attach it.
      </p>
    </div>
  );
}
