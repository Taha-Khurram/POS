import type { Metadata } from "next";
import Link from "next/link";

import { IconCard, IconCash, IconChevron, IconRegister } from "@/components/pos/icons";
import { requireSession } from "@/lib/auth";
import {
  currentBusinessDay,
  moneyFormatter,
  receiptStamp,
  writeBusinessDay,
  type Counter,
} from "@/lib/pos/counter";
import type { ShopSettings } from "@/lib/pos/settings-options";
import { getShopSettings, listCounters } from "@/lib/pos/shop";
import { getDayTakings, type CounterTakings, type DayTakings } from "@/lib/pos/takings";

export const metadata: Metadata = {
  title: "Sales & takings",
  description: "What each counter took today, and what the shop took.",
};

/**
 * The day's takings, per counter and altogether.
 *
 * The question this screen exists to answer is asked at closing time with a
 * drawer of notes in one hand: what should be in counter 1, what should be in
 * counter 2, and what did the shop take. So the counters come first and the
 * shop total sits above them as the figure they add up to — not the other way
 * round, because the number a cashier is counting against is their own.
 *
 * Cash and card are separate columns throughout. The cash column is the one
 * that gets counted; the card column is the one the machine's own settlement
 * has to match, and adding them together would hide both.
 *
 * The day lives in the URL (`?day=2026-09-16`), like every other window in the
 * console, so the page stays a server component and last Tuesday can be sent to
 * an accountant as a link. It is a trading day off `sales.business_day`, not a
 * calendar day — a dhaba that shuts at 1 am gets its last hour on the day it
 * opened.
 */
export default async function SalesPage({
  searchParams,
}: PageProps<"/app/sales">) {
  const session = await requireSession();

  if (!session.tenantId) return <NotAttached />;

  const [settings, counters] = await Promise.all([
    getShopSettings(session.tenantId),
    listCounters(session.tenantId),
  ]);

  const asked = (await searchParams).day;
  const day =
    typeof asked === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asked)
      ? asked
      : currentBusinessDay(settings);

  const takings = await getDayTakings(
    session.tenantId,
    day,
    counters.map((counter) => ({ id: counter.id, name: counter.name })),
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="font-display text-[1.5rem] leading-tight font-bold">
            Sales &amp; takings
          </h1>
          <p className="mt-1 text-[0.8125rem] text-graphite-500">
            {writeBusinessDay(day)}
            {day === currentBusinessDay(settings) ? " · today so far" : ""}
          </p>
        </div>

        <DayStep day={day} settings={settings} />
      </header>

      <ShopTotal takings={takings} settings={settings} />

      <CounterTable takings={takings} counters={counters} settings={settings} />

      <Receipts takings={takings} counters={counters} settings={settings} />
    </div>
  );
}

/**
 * Yesterday and tomorrow, and nothing else.
 *
 * A calendar here would be a third date control in the console for a screen
 * that is opened at closing time about the day that is closing. The dashboard's
 * range picker is where "last month" belongs.
 */
function DayStep({ day, settings }: { day: string; settings: ShopSettings }) {
  const shift = (days: number) =>
    new Date(new Date(`${day}T00:00:00Z`).getTime() + days * 86_400_000)
      .toISOString()
      .slice(0, 10);

  const today = currentBusinessDay(settings);
  const next = shift(1);

  return (
    <nav className="flex items-center gap-1.5" aria-label="Trading day">
      <Link
        href={`/app/sales?day=${shift(-1)}`}
        className="pos-btn pos-btn-soft pos-btn-sm"
        scroll={false}
      >
        <IconChevron className="h-4 w-4 rotate-90" />
        <span className="hidden sm:inline">Day before</span>
      </Link>

      {day !== today ? (
        <Link href="/app/sales" className="pos-btn pos-btn-soft pos-btn-sm" scroll={false}>
          Today
        </Link>
      ) : null}

      {/* A day the shop has not traded yet has nothing to show, so there is no
          button to get there. */}
      {next <= today ? (
        <Link
          href={`/app/sales?day=${next}`}
          className="pos-btn pos-btn-soft pos-btn-sm"
          scroll={false}
        >
          <span className="hidden sm:inline">Day after</span>
          <IconChevron className="h-4 w-4 -rotate-90" />
        </Link>
      ) : null}
    </nav>
  );
}

/** The whole shop, in the four figures a close needs. */
function ShopTotal({
  takings,
  settings,
}: {
  takings: DayTakings;
  settings: ShopSettings;
}) {
  const money = moneyFormatter(settings);

  const tiles = [
    { label: "All counters took", value: money(takings.total), lead: true },
    { label: "Cash in the drawers", value: money(takings.cash), icon: IconCash },
    { label: "On card", value: money(takings.card), icon: IconCard },
    {
      label: "Bills rung up",
      value: takings.bills.toLocaleString("en-PK"),
    },
  ];

  return (
    <section
      aria-label="The shop's day"
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      {tiles.map((tile) => (
        <article key={tile.label} className="pos-card p-4">
          <h2 className="flex items-center gap-1.5 font-display text-[0.8125rem] leading-tight font-semibold text-graphite-500">
            {tile.icon ? <tile.icon className="h-3.5 w-3.5" /> : null}
            {tile.label}
          </h2>

          <p
            className={`mt-2.5 font-display leading-none font-bold tracking-tight tabular-nums ${
              tile.lead
                ? "text-[1.875rem] text-orchid-800"
                : "text-[1.75rem] text-graphite-900"
            }`}
          >
            {tile.value}
          </p>
        </article>
      ))}
    </section>
  );
}

/**
 * One row per counter, and the shop's own total under them.
 *
 * Every counter the shop has gets a row, including one that took nothing all
 * day — that is the answer to "did counter 2 sell anything?", and an absent row
 * is not. A row for a counter that has since been deleted appears only if it
 * has sales against it, which `on delete restrict` is supposed to make
 * impossible; it is drawn anyway rather than dropping money on the floor.
 */
function CounterTable({
  takings,
  counters,
  settings,
}: {
  takings: DayTakings;
  counters: Counter[];
  settings: ShopSettings;
}) {
  const money = moneyFormatter(settings);
  const known = new Set(counters.map((counter) => counter.id));

  // The shop's own order first, anything orphaned at the bottom — it is an
  // exception, not a till.
  const rows = [...takings.counters].sort((a, b) => {
    const rank = (row: CounterTakings) =>
      row.counterId && known.has(row.counterId)
        ? counters.findIndex((counter) => counter.id === row.counterId)
        : counters.length;
    return rank(a) - rank(b);
  });

  return (
    <section className="pos-card">
      <header className="px-4 pt-4 pb-3">
        <h2 className="font-display text-[0.9375rem] leading-tight font-semibold">
          Each counter
        </h2>
        <p className="mt-0.5 text-[0.75rem] text-graphite-500">
          Count one drawer against one row. Cash is what should be in it.
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="pos-table">
          <thead>
            <tr>
              <th>Counter</th>
              <th className="text-end">Bills</th>
              <th className="text-end">Cash</th>
              <th className="text-end">Card</th>
              <th className="text-end">Took</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => (
              <tr key={row.counterId ?? "orphan"}>
                <td>
                  <span className="flex items-center gap-2.5">
                    <span className="grid h-7 w-7 flex-none place-items-center rounded-lg bg-orchid-50 text-orchid-700">
                      <IconRegister className="h-3.5 w-3.5" />
                    </span>

                    <span className="min-w-0">
                      <span className="block truncate font-medium text-graphite-900">
                        {row.name}
                      </span>
                      {row.lastReceiptNo ? (
                        <span className="block truncate font-mono text-[0.6875rem] text-graphite-500">
                          last {row.lastReceiptNo}
                        </span>
                      ) : (
                        <span className="block text-[0.6875rem] text-graphite-500">
                          nothing rung up
                        </span>
                      )}
                    </span>
                  </span>
                </td>

                <td className="pos-num">{row.bills}</td>
                <td className="pos-num">{money(row.cash)}</td>
                <td className="pos-num">{money(row.card)}</td>
                <td className="pos-num font-semibold">{money(row.total)}</td>
              </tr>
            ))}
          </tbody>

          {/* The collective figure, in the table rather than only in the tiles
              above — at a close it is read as the sum of the rows over it, and
              a total in a different card is a total somebody re-adds by hand. */}
          <tfoot>
            <tr className="border-t-2 border-orchid-200">
              <td className="font-display font-semibold">All counters</td>
              <td className="pos-num font-semibold">{takings.bills}</td>
              <td className="pos-num font-semibold">{money(takings.cash)}</td>
              <td className="pos-num font-semibold">{money(takings.card)}</td>
              <td className="pos-num font-display text-[1rem] font-bold text-orchid-800">
                {money(takings.total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/** Every bill of the day, newest first — what a customer with a receipt in
 *  their hand is looked up against. */
function Receipts({
  takings,
  counters,
  settings,
}: {
  takings: DayTakings;
  counters: Counter[];
  settings: ShopSettings;
}) {
  const money = moneyFormatter(settings);
  const nameOf = (id: string | null) =>
    counters.find((counter) => counter.id === id)?.name ?? "—";

  return (
    <section className="pos-card">
      <header className="px-4 pt-4 pb-3">
        <h2 className="font-display text-[0.9375rem] leading-tight font-semibold">
          Receipts
        </h2>
        <p className="mt-0.5 text-[0.75rem] text-graphite-500">
          {takings.bills === 0
            ? "Nothing rung up on this day."
            : `${takings.bills} on this day, newest first.`}
        </p>
      </header>

      {takings.receipts.length === 0 ? (
        <p className="px-4 pb-5 text-[0.875rem] leading-relaxed text-graphite-700">
          When a counter rings up a sale it lands here, with its number, its
          till and how it was paid. Search, reprint and returns arrive with the
          rest of Part 4.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="pos-table">
            <thead>
              <tr>
                <th>Bill</th>
                <th>Counter</th>
                <th>Time</th>
                <th>Paid</th>
                <th className="text-end">Total</th>
              </tr>
            </thead>

            <tbody>
              {takings.receipts.map((receipt) => (
                <tr key={receipt.id}>
                  <td className="font-mono text-[0.75rem]">{receipt.receiptNo}</td>
                  <td className="text-graphite-700">{nameOf(receipt.counterId)}</td>
                  <td className="text-graphite-700">
                    {receiptStamp(new Date(receipt.at), settings.timezone)}
                  </td>
                  <td>
                    <span
                      className={`pos-badge ${
                        receipt.tender === "cash"
                          ? "pos-badge-good"
                          : receipt.tender === "card"
                            ? "pos-badge-info"
                            : "pos-badge-warn"
                      }`}
                    >
                      {receipt.tender === "cash"
                        ? "Cash"
                        : receipt.tender === "card"
                          ? "Card"
                          : "Split"}
                    </span>
                  </td>
                  <td className="pos-num">{money(receipt.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {takings.bills > takings.receipts.length ? (
        <p className="border-t border-orchid-100 px-4 py-2.5 text-[0.75rem] text-graphite-500">
          Showing the most recent {takings.receipts.length}. The totals above
          count all {takings.bills}.
        </p>
      ) : null}
    </section>
  );
}

/** Same words as the register's gate, because it is the same problem. */
function NotAttached() {
  return (
    <div className="pos-card mx-auto max-w-lg p-6">
      <h1 className="font-display text-[1.375rem] font-bold">
        Account not attached yet
      </h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-graphite-700">
        You are signed in, but this login is not linked to a shop. Message us on
        the same WhatsApp number you arranged Flo on and we will attach it.
      </p>
    </div>
  );
}
