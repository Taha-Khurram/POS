"use client";

import { useMemo, useState } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import { DataTable, type Column } from "@/components/pos/data-table";
import {
  IconChevron,
  IconClose,
  IconDownload,
  IconSearch,
} from "@/components/pos/icons";
import { Select, type SelectOption } from "@/components/pos/select-field";
import { useToast } from "@/components/pos/toaster";
import { moneyFormatter, receiptStamp, type Counter } from "@/lib/pos/counter";
import {
  PAGE_SIZE,
  TENDER_FILTERS,
  billsToCsv,
  csvFilename,
  matchesBill,
  matchesTender,
  summarise,
  windowDays,
  writeClock,
  writeDay,
  writeTender,
  type BillPage,
  type BillRow,
  type RangeId,
  type TenderFilterId,
} from "@/lib/pos/history";
import type { ShopSettings } from "@/lib/pos/settings-options";
import type { ShopProfile } from "@/lib/pos/shop";
import { BillDrawer } from "./bill-drawer";
import { RangePicker } from "./range-picker";

/**
 * Every bill the shop has rung up, in the days you asked for.
 *
 * One read, then everything is instant. The window is the only thing that
 * navigates — the search box, the three narrowing selects and the pager all
 * work on rows the browser already holds, for the reason the item list and the
 * customer list do: a round trip per keystroke over shop 3G is a search box
 * that feels broken, and the answer to "find me that bill" has to arrive while
 * the customer is still standing there.
 *
 * The figures above the table are the figures *of the rows under it*. Narrow
 * the list and they narrow with it — which is the whole point, because "what
 * did counter 2 take in cash last week" is three taps and not a report. The
 * caption says which rows they are every time it is not all of them, because a
 * total that silently counts something other than what is on screen is the one
 * thing a shopkeeper cannot catch.
 */

const ALL = "all";

export function HistoryPanel({
  page,
  range,
  today,
  openingQuery,
  counters,
  staff,
  settings,
  shop,
  canSeeCustomers,
}: {
  page: BillPage;
  range: RangeId;
  /** The shop's own current trading day, resolved on the server — the browser
   *  never decides what day it is. */
  today: string;
  /**
   * What the search box opens with, off `?q=`.
   *
   * Only the opening value: the box is local state from the first keystroke on,
   * because a navigation per character is the thing this screen is built to
   * avoid. What it buys is a link that lands on one bill — which is how the
   * Customers screen points at a row of somebody's history.
   */
  openingQuery: string;
  counters: Counter[];
  staff: { id: string; name: string }[];
  settings: ShopSettings;
  shop: ShopProfile | null;
  canSeeCustomers: boolean;
}) {
  const [query, setQuery] = useState(openingQuery);
  const [counterId, setCounterId] = useState<string>(ALL);
  const [cashierId, setCashierId] = useState<string>(ALL);
  const [tender, setTender] = useState<TenderFilterId>("all");
  const [pageAt, setPageAt] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  const toast = useToast();
  // Memoised, because the column list is memoised against it — rebuilt every
  // render it would rebuild the columns every render with it.
  const money = useMemo(() => moneyFormatter(settings), [settings]);

  const rows = useMemo(
    () =>
      page.rows.filter(
        (bill) =>
          (counterId === ALL || bill.counterId === counterId) &&
          (cashierId === ALL || bill.cashierId === cashierId) &&
          matchesTender(bill, tender) &&
          matchesBill(bill, query),
      ),
    [page.rows, counterId, cashierId, tender, query],
  );

  const summary = useMemo(() => summarise(rows), [rows]);

  // Clamped in render rather than reset by an effect: a filter that shortens
  // the list while the reader is on page six should show them the last page
  // that exists, not flash an empty one on the way to it.
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(pageAt, pages - 1);
  const shown = rows.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  const narrowed =
    query.trim() !== "" || counterId !== ALL || cashierId !== ALL || tender !== "all";

  // A window of one day needs no day column — every row would say the same
  // thing, and the space is worth more to the customer's name.
  const multiDay = windowDays(page.window) > 1;

  const openIndex = openId ? rows.findIndex((bill) => bill.id === openId) : -1;
  const open = openIndex >= 0 ? rows[openIndex] : null;

  const columns = useMemo<Column<BillRow>[]>(
    () => [
      {
        key: "bill",
        header: "Bill",
        cell: (bill) => (
          <span className="block">
            <span className="block font-mono text-[0.8125rem] font-medium text-graphite-900">
              {bill.receiptNo}
            </span>
            <span className="block text-[0.6875rem] text-graphite-500">
              {writeClock(bill.at, settings.timezone)}
            </span>
          </span>
        ),
      },
      ...(multiDay
        ? [
            {
              key: "day",
              header: "Day",
              hideBelow: "sm" as const,
              cell: (bill: BillRow) => (
                <span className="text-graphite-700">{writeDay(bill.businessDay)}</span>
              ),
            },
          ]
        : []),
      {
        key: "counter",
        header: "Counter",
        hideBelow: "md",
        cell: (bill) => <span className="text-graphite-700">{bill.counterName}</span>,
      },
      {
        key: "cashier",
        header: "Rang it up",
        hideBelow: "lg",
        cell: (bill) => <span className="text-graphite-700">{bill.cashierName}</span>,
      },
      {
        key: "customer",
        header: "Customer",
        hideBelow: "sm",
        cell: (bill) =>
          bill.customerName ? (
            <span className="block max-w-[12rem] truncate text-graphite-700">
              {bill.customerName}
            </span>
          ) : (
            <span className="text-graphite-500">Walk-in</span>
          ),
      },
      {
        key: "paid",
        header: "Paid",
        cell: (bill) => (
          <span
            className={`pos-badge ${
              bill.tenders.length !== 1
                ? "pos-badge-warn"
                : bill.tenders[0].method === "cash"
                  ? "pos-badge-good"
                  : "pos-badge-info"
            }`}
          >
            {writeTender(bill.tenders)}
          </span>
        ),
      },
      {
        key: "total",
        header: "Total",
        align: "end",
        cell: (bill) => (
          <span className="font-medium text-graphite-900">{money(bill.total)}</span>
        ),
      },
      {
        key: "open",
        header: "",
        align: "end",
        cell: () => (
          <IconChevron
            className="h-4 w-4 -rotate-90 text-graphite-500"
            aria-hidden
          />
        ),
      },
    ],
    // `money` and the stamp are rebuilt from `settings`, which never changes
    // within a mount.
    [multiDay, settings, money],
  );

  const counterOptions: SelectOption[] = useMemo(
    () => [
      { id: ALL, label: "Every counter", description: "All the shop's tills" },
      ...counters.map((counter) => ({
        id: counter.id,
        label: counter.name,
        description: counter.isActive ? "Open" : "Shut",
        meta: page.rows
          .filter((bill) => bill.counterId === counter.id)
          .length.toLocaleString("en-PK"),
      })),
    ],
    [counters, page.rows],
  );

  const cashierOptions: SelectOption[] = useMemo(
    () => [
      { id: ALL, label: "Everyone", description: "Whoever was on the till" },
      ...staff
        // Only the people with a bill in this window. A roster of twelve with
        // ten zeroes in it is a menu somebody has to read to find the two names
        // that matter.
        .filter((member) => page.rows.some((bill) => bill.cashierId === member.id))
        .map((member) => ({
          id: member.id,
          label: member.name,
          meta: page.rows
            .filter((bill) => bill.cashierId === member.id)
            .length.toLocaleString("en-PK"),
        })),
    ],
    [staff, page.rows],
  );

  const tenderOptions: SelectOption[] = useMemo(
    () =>
      TENDER_FILTERS.map((option) => ({
        id: option.id,
        label: option.label,
        description: option.note,
        meta: page.rows
          .filter((bill) => matchesTender(bill, option.id))
          .length.toLocaleString("en-PK"),
      })),
    [page.rows],
  );

  const clear = () => {
    setQuery("");
    setCounterId(ALL);
    setCashierId(ALL);
    setTender("all");
    setPageAt(0);
  };

  /**
   * The filtered list, as a file.
   *
   * What is on screen is what comes out — the same bargain printing strikes. An
   * export of the whole window from a screen showing one counter's cash is how
   * somebody sends an accountant a number they did not mean.
   */
  const exportCsv = () => {
    if (rows.length === 0) return;

    const csv = billsToCsv(rows, {
      currency: settings.currency,
      stamp: (iso) => receiptStamp(new Date(iso), settings.timezone),
    });

    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = csvFilename(page.window);
    anchor.click();
    URL.revokeObjectURL(url);

    toast({
      title: `${rows.length.toLocaleString("en-PK")} bills exported`,
      detail: narrowed ? "The rows you have narrowed to, not the whole window." : undefined,
      tone: "good",
    });
  };

  return (
    <div className="space-y-4">
      <Figures summary={summary} money={money} narrowed={narrowed} page={page} />

      <ChartCard
        title="Bills"
        caption={caption(rows.length, page, narrowed)}
        bleed
        actions={
          <>
            <RangePicker range={range} window={page.window} today={today} />

            <button
              type="button"
              onClick={exportCsv}
              disabled={rows.length === 0}
              className="pos-btn pos-btn-soft disabled:pointer-events-none disabled:opacity-45"
              title="Download what is on screen as a spreadsheet"
            >
              <IconDownload className="h-4 w-4" />
              <span className="hidden sm:inline">Export</span>
            </button>
          </>
        }
        footer={
          pages > 1 ? (
            <Pager
              current={current}
              pages={pages}
              from={current * PAGE_SIZE + 1}
              to={Math.min(rows.length, (current + 1) * PAGE_SIZE)}
              of={rows.length}
              onGo={setPageAt}
            />
          ) : undefined
        }
      >
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
          {/* A div and not a label, because of the × inside it: a click on a
              button nested in a label is forwarded to the labelled control as
              well, and the box would take focus back off the button that had
              just been pressed. */}
          <div className="relative min-w-[12rem] flex-1">
            <IconSearch className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-graphite-500" />
            <input
              className="pos-field pr-9 pl-9"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPageAt(0);
              }}
              placeholder="Bill number, customer, phone, or the amount"
              aria-label="Search the bills"
              autoComplete="off"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="pos-filter-tag-x absolute top-1/2 right-2.5 -translate-y-1/2"
                aria-label="Clear the search"
              >
                <IconClose className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>

          {/* The counter picker only earns its place in a shop that has more
              than one. */}
          {counters.length > 1 ? (
            <div className="w-[11rem] flex-none">
              <Select
                value={counterId}
                onChange={(next) => {
                  setCounterId(next);
                  setPageAt(0);
                }}
                options={counterOptions}
                label="Narrow to one counter"
              />
            </div>
          ) : null}

          {/* And the cashier picker only in a shop with more than one person on
              the till in these days. */}
          {cashierOptions.length > 2 ? (
            <div className="w-[11rem] flex-none">
              <Select
                value={cashierId}
                onChange={(next) => {
                  setCashierId(next);
                  setPageAt(0);
                }}
                options={cashierOptions}
                label="Narrow to one cashier"
              />
            </div>
          ) : null}

          <div className="w-[10.5rem] flex-none">
            <Select
              value={tender}
              onChange={(next) => {
                setTender(next as TenderFilterId);
                setPageAt(0);
              }}
              options={tenderOptions}
              label="Narrow by how it was paid"
            />
          </div>

          {narrowed ? (
            <button type="button" onClick={clear} className="pos-btn pos-btn-quiet pos-btn-sm">
              Clear
            </button>
          ) : null}
        </div>

        <DataTable
          columns={columns}
          rows={shown}
          rowKey={(bill) => bill.id}
          onRowClick={(bill) => setOpenId(bill.id)}
          rowLabel={(bill) => `Open bill ${bill.receiptNo}, ${money(bill.total)}`}
          isCurrent={(bill) => bill.id === openId}
          empty={
            page.rows.length === 0
              ? "Nothing was rung up on these days. Pick a wider range, or ring a sale up on the register."
              : query.trim()
                ? `No bill matches “${query.trim()}”. Check the number, or widen the days.`
                : "No bill under these filters. Clear them to see the whole window."
          }
        />
      </ChartCard>

      {open ? (
        <BillDrawer
          bill={open}
          counters={counters}
          shop={shop}
          settings={settings}
          canSeeCustomers={canSeeCustomers}
          position={{ index: openIndex, of: rows.length }}
          onStep={(delta) => {
            const next = rows[openIndex + delta];
            if (!next) return;
            setOpenId(next.id);
            // Walking past the end of a page follows the reader there, so
            // closing the sheet leaves them where they actually are in the list.
            setPageAt(Math.floor((openIndex + delta) / PAGE_SIZE));
          }}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** Which rows the figures and the table are of. Said every time it is not all
 *  of them, and said with the number rather than the word "filtered". */
function caption(shown: number, page: BillPage, narrowed: boolean): string {
  const count = (value: number) => value.toLocaleString("en-PK");

  // The cap leads whatever else is true. Somebody who narrows the moment the
  // screen opens would otherwise never be told the window was clipped, and the
  // figures above the table are the figures of what was loaded.
  if (page.bills > page.rows.length) {
    return narrowed
      ? `${count(shown)} of the newest ${count(page.rows.length)} — ${count(page.bills)} in these days`
      : `The newest ${count(page.rows.length)} of ${count(page.bills)} — narrow the days for the rest`;
  }

  if (narrowed) {
    return `${count(shown)} of ${count(page.rows.length)}`;
  }

  return `${count(page.bills)} in these days`;
}

/**
 * Four figures, and what they are of.
 *
 * Cash and card stay separate columns the whole way down this screen for the
 * reason the day-close does: the cash figure is the one counted against a
 * drawer, the card figure is the one the machine's own settlement has to match,
 * and adding them together hides both.
 */
function Figures({
  summary,
  money,
  narrowed,
  page,
}: {
  summary: ReturnType<typeof summarise>;
  money: (amount: number) => string;
  narrowed: boolean;
  page: BillPage;
}) {
  const days = windowDays(page.window);

  // Three different sentences, because they are three different facts and the
  // one that matters is which rows these four figures were added up from.
  const of = narrowed
    ? "Of the bills shown"
    : page.bills > page.rows.length
      ? `The newest of ${page.bills.toLocaleString("en-PK")} in these days`
      : `Over ${days} trading ${days === 1 ? "day" : "days"}`;

  const tiles = [
    {
      label: "Took",
      value: money(summary.gross),
      note: summary.bills ? `${money(summary.average)} a bill` : "Nothing yet",
      lead: true,
    },
    {
      label: "Bills",
      value: summary.bills.toLocaleString("en-PK"),
      note: of,
    },
    {
      label: "Cash",
      value: money(summary.cash),
      note: "Counted out of the drawers",
    },
    {
      label: "Card",
      value: money(summary.card),
      note: "Settled by the machine",
    },
  ];

  return (
    <section
      aria-label="What these bills came to"
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      {tiles.map((tile) => (
        <article key={tile.label} className="pos-card p-4">
          <h2 className="font-display text-[0.8125rem] leading-tight font-semibold text-graphite-500">
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

          <p className="mt-2.5 text-[0.75rem] text-graphite-500">{tile.note}</p>
        </article>
      ))}
    </section>
  );
}

/** Where you are in the list, and the two steps either side of it. No numbered
 *  pages: fifty rows at a time over a fortnight is forty buttons nobody aims
 *  at, and the search box is how anybody actually reaches row 900. */
function Pager({
  current,
  pages,
  from,
  to,
  of,
  onGo,
}: {
  current: number;
  pages: number;
  from: number;
  to: number;
  of: number;
  onGo: (page: number) => void;
}) {
  return (
    <>
      <p className="me-auto text-[0.75rem] tabular-nums text-graphite-500">
        {from.toLocaleString("en-PK")}–{to.toLocaleString("en-PK")} of{" "}
        {of.toLocaleString("en-PK")}
      </p>

      <button
        type="button"
        onClick={() => onGo(current - 1)}
        disabled={current === 0}
        className="pos-btn pos-btn-soft pos-btn-sm disabled:pointer-events-none disabled:opacity-40"
      >
        <IconChevron className="h-4 w-4 rotate-90" />
        Newer
      </button>

      <span className="text-[0.75rem] tabular-nums text-graphite-500">
        {current + 1} / {pages}
      </span>

      <button
        type="button"
        onClick={() => onGo(current + 1)}
        disabled={current >= pages - 1}
        className="pos-btn pos-btn-soft pos-btn-sm disabled:pointer-events-none disabled:opacity-40"
      >
        Older
        <IconChevron className="h-4 w-4 -rotate-90" />
      </button>
    </>
  );
}
