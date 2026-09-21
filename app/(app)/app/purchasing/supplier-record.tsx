import Link from "next/link";

import { ChartCard } from "@/components/pos/chart-card";
import { DataTable, type Column } from "@/components/pos/data-table";
import { IconAlert, IconChevron } from "@/components/pos/icons";
import { InfoTip } from "@/components/pos/info-tip";
import { moneyFormatter, writeBusinessDay } from "@/lib/pos/counter";
import { initialsOf, writePhone } from "@/lib/pos/customer";
import {
  ageOf,
  balanceState,
  isOverdue,
  LEDGER_EXPLAIN,
  STATEMENT_MAX,
  type LedgerEntry,
  type SupplierBalance,
} from "@/lib/pos/ledger";
import type { SupplierStatement } from "@/lib/pos/ledgers";
import type { ShopSettings } from "@/lib/pos/settings-options";
import { writeTerms, type Supplier } from "@/lib/pos/supplier";
import { PaySupplierButton } from "./payments-panel";
import { EditSupplierButton } from "./suppliers-panel";

/**
 * One supplier's account.
 *
 * A server component, because the statement is a query per supplier that has no
 * business running in the browser — the same call the customer record makes.
 * The two client leaves on it are the Edit and Record-a-payment buttons, which
 * hold nothing but "is the sheet open".
 *
 * **The statement runs oldest first**, which is the opposite of every other
 * list in the console and the only order a carried-down balance can be read in.
 * A statement newest-first would put its own answer at the top and the workings
 * underneath.
 *
 * **The ageing is a walk, not a table** — see `ageOf`. There is no allocation
 * between payments and deliveries, because nobody here settles that way, so the
 * oldest bill is assumed paid first. That assumption is stated on the screen
 * rather than left for somebody to discover: a figure an owner cannot account
 * for is a figure they stop believing.
 */
export function SupplierRecord({
  supplier,
  balance,
  statement,
  today,
  settings,
  taken,
}: {
  supplier: Supplier;
  balance: SupplierBalance;
  statement: SupplierStatement;
  today: string;
  settings: ShopSettings;
  taken: string[];
}) {
  // This screen is a server component and could take a ready-made formatter,
  // but `PaySupplierButton` below is a client one and cannot — so the settings
  // come down and both sides build their own from the same row.
  const money = moneyFormatter(settings);

  const { buckets, oldestUnpaidOn } = ageOf(
    statement.debits,
    statement.paid,
    { on: supplier.openingOn, amount: supplier.opening },
    today,
  );

  const state = balanceState(balance.balance);
  const overdue = isOverdue(oldestUnpaidOn, supplier.paymentTermsDays, today);
  const aged = buckets.filter((bucket) => bucket.amount > 0.005);

  const columns: Column<LedgerEntry>[] = [
    {
      key: "on",
      header: "Date",
      cell: (entry) => (
        <span className="text-graphite-700">
          {entry.on ? writeBusinessDay(entry.on) : "—"}
        </span>
      ),
    },
    {
      key: "detail",
      header: "What",
      cell: (entry) => (
        <span className="min-w-0">
          <span className="block truncate text-graphite-900">{entry.detail}</span>
          {entry.ref ? (
            <span className="block truncate font-mono text-[0.6875rem] text-graphite-500">
              {entry.ref}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Delivered",
      align: "end",
      cell: (entry) =>
        entry.amount > 0 ? (
          <span className="tabular-nums text-graphite-900">{money(entry.amount)}</span>
        ) : (
          <span className="text-graphite-500">—</span>
        ),
    },
    {
      key: "paid",
      header: "Paid",
      align: "end",
      cell: (entry) =>
        entry.amount < 0 ? (
          <span className="tabular-nums text-signal-good">
            {money(Math.abs(entry.amount))}
          </span>
        ) : (
          <span className="text-graphite-500">—</span>
        ),
    },
    {
      key: "after",
      header: "Balance",
      align: "end",
      cell: (entry) => (
        <span className="font-semibold tabular-nums text-graphite-900">
          {money(entry.after)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Link
        href="/app/purchasing?tab=suppliers"
        className="inline-flex items-center gap-1 text-[0.8125rem] text-graphite-500 hover:text-graphite-900"
      >
        <IconChevron className="h-3.5 w-3.5 rotate-90" />
        All suppliers
      </Link>

      <header className="pos-card flex flex-wrap items-start gap-4 p-4 sm:p-5">
        <span
          className="grid h-12 w-12 flex-none place-items-center rounded-full bg-orchid-100 font-display text-[0.9375rem] font-bold text-orchid-800"
          aria-hidden
        >
          {initialsOf(supplier.name)}
        </span>

        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[1.375rem] leading-tight font-bold">
            {supplier.name}
            {supplier.isActive ? null : (
              <span className="pos-badge pos-badge-warn ml-2 align-middle">
                Switched off
              </span>
            )}
          </h1>

          <dl className="mt-2 grid gap-x-6 gap-y-1 text-[0.8125rem] sm:grid-cols-2">
            <Detail label="Who you ring" value={supplier.contactName} />
            <Detail label="Phone" value={writePhone(supplier.phone)} mono />
            <Detail label="Where" value={supplier.address} />
            <Detail label="Terms" value={writeTerms(supplier.paymentTermsDays)} />
          </dl>

          {supplier.notes ? (
            <p className="mt-3 rounded-xl border border-orchid-100 bg-orchid-50/60 px-3 py-2 text-[0.8125rem] leading-relaxed text-graphite-700">
              {supplier.notes}
            </p>
          ) : null}
        </div>

        <div className="flex flex-none flex-wrap gap-2">
          <EditSupplierButton supplier={supplier} taken={taken} />
          <PaySupplierButton
            supplier={{ id: supplier.id, name: supplier.name }}
            balances={new Map([[supplier.id, balance]])}
            today={today}
            settings={settings}
          />
        </div>
      </header>

      {/* ---------------- What it comes to ---------------- */}
      <section aria-label="The account" className="grid gap-4 sm:grid-cols-4">
        <article
          className={`pos-card p-4 ${state === "owed" && overdue ? "border-signal-warn" : ""}`}
        >
          <h2 className="flex items-center gap-1.5 font-display text-[0.8125rem] leading-tight font-semibold text-graphite-500">
            {state === "advance" ? "In advance" : "Balance owed"}
            {overdue ? <IconAlert className="h-3.5 w-3.5 text-signal-warn" /> : null}
            <InfoTip
              label={state === "advance" ? "In advance" : "Balance owed"}
              explain={LEDGER_EXPLAIN.balance}
            />
          </h2>

          <p
            className={`mt-2.5 font-display text-[1.75rem] leading-none font-bold tracking-tight tabular-nums ${
              state === "advance" ? "text-signal-good" : "text-graphite-900"
            }`}
          >
            {money(Math.abs(balance.balance))}
          </p>

          <p className="mt-2.5 text-[0.75rem] text-graphite-500">
            {state === "clear"
              ? "The account is square"
              : overdue
                ? `Past the ${writeTerms(supplier.paymentTermsDays).toLowerCase()} you agreed`
                : state === "advance"
                  ? "You have paid ahead"
                  : "Owed to them"}
          </p>
        </article>

        <Figure
          label="Opening balance"
          value={money(supplier.opening)}
          note={
            supplier.openingOn
              ? `As at ${writeBusinessDay(supplier.openingOn)}`
              : "Started level"
          }
        />
        <Figure
          label="Delivered"
          value={money(balance.invoiced)}
          note={`${balance.deliveries} ${balance.deliveries === 1 ? "delivery" : "deliveries"}, carriage included`}
        />
        <Figure
          label="Paid"
          value={money(balance.paid)}
          note={
            balance.lastPaidOn
              ? `Last on ${writeBusinessDay(balance.lastPaidOn)}`
              : "Nothing paid yet"
          }
        />
      </section>

      {/* ---------------- How old it is ---------------- */}
      {aged.length > 0 ? (
        <ChartCard
          title="How old the unpaid money is"
          caption="Oldest delivery first, because that is the one a payment settles"
        >
          <div className="grid gap-3 px-4 pb-4 sm:grid-cols-4">
            {buckets.map((bucket) => (
              <div
                key={bucket.label}
                className={`rounded-2xl border p-3 ${
                  bucket.amount > 0.005 && bucket.to === null
                    ? "border-signal-warn"
                    : "border-orchid-100"
                }`}
              >
                <p className="text-[0.75rem] text-graphite-500">{bucket.label}</p>
                <p className="mt-1.5 font-display text-[1.125rem] font-bold tabular-nums text-graphite-900">
                  {bucket.amount > 0.005 ? money(bucket.amount) : "—"}
                </p>
              </div>
            ))}
          </div>

          {/* Said out loud, because the number depends on it — and read from
              `LEDGER_EXPLAIN` rather than written here, so the caption and the
              hover tip beside the balance cannot come to explain the same
              account two different ways. */}
          <p className="px-4 pb-4 text-[0.75rem] leading-relaxed text-graphite-500">
            {LEDGER_EXPLAIN.ageing.plain}
          </p>
        </ChartCard>
      ) : null}

      {/* ---------------- The statement ---------------- */}
      <ChartCard
        title="Statement"
        caption={
          statement.capped
            ? `The last ${STATEMENT_MAX} deliveries and payments. Older ones are not on this list, though the balance above counts them all.`
            : "Oldest first, with the balance carried down"
        }
        bleed
      >
        <DataTable
          columns={columns}
          rows={statement.entries}
          rowKey={(entry) => `${entry.kind}-${entry.id}`}
          empty="Nothing on the account yet. Take a delivery in, or record what you have already paid them."
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
      <p className="mt-2.5 font-display text-[1.5rem] leading-none font-bold tracking-tight tabular-nums text-graphite-900">
        {value}
      </p>
      <p className="mt-2.5 text-[0.75rem] text-graphite-500">{note}</p>
    </article>
  );
}
