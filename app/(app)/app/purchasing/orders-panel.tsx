"use client";

import { useMemo, useState, useTransition } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import { DataTable, type Column } from "@/components/pos/data-table";
import {
  IconChevron,
  IconClose,
  IconPlus,
  IconSearch,
} from "@/components/pos/icons";
import { Select, type SelectOption } from "@/components/pos/select-field";
import type { Product } from "@/lib/pos/catalog";
import { moneyFormatter, writeBusinessDay } from "@/lib/pos/counter";
import type { ShopSettings } from "@/lib/pos/settings-options";
import {
  matchesOrder,
  orderStatus,
  type PurchaseOrder,
  type PurchaseOrderDetail,
} from "@/lib/pos/purchase";
import { loadOrder } from "./load-actions";
import { OrderSheet } from "./order-sheet";

/**
 * The order list.
 *
 * Client, like every other list in the console, and for the same reason: a shop
 * has hundreds of orders at most and filtering them in a frame beats a round
 * trip per keystroke on shop 3G.
 *
 * Opening one is a sheet rather than a navigation — a list somebody searched
 * their way to must survive looking at an order — and only the lines are
 * fetched, through `loadOrder`, which is a read behind the same
 * `can_manage_purchasing` gate as every write here. That is the call
 * `/app/sales` makes for a bill, for the same reason: four hundred orders'
 * worth of lines is not something to ship to draw a table of totals.
 */

const FILTERS = [
  { id: "all", label: "Everything", note: "No filter", match: () => true },
  {
    id: "open",
    label: "Still open",
    note: "Placed, and not all in yet",
    match: (order: PurchaseOrder) =>
      order.status === "placed" && order.receivedLines < order.lines,
  },
  {
    id: "draft",
    label: "Drafts",
    note: "Nobody has been rung",
    match: (order: PurchaseOrder) => order.status === "draft",
  },
  {
    id: "done",
    label: "Delivered",
    note: "Everything on it arrived",
    match: (order: PurchaseOrder) =>
      order.lines > 0 && order.receivedLines >= order.lines,
  },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

const filterBy = (id: FilterId) =>
  FILTERS.find((entry) => entry.id === id) ?? FILTERS[0];

/**
 * Delivery, in a word.
 *
 * Off the reader's tally of fully-received lines, never a stored column — the
 * whole reason `0028` has no `received_quantity`. The list counts *lines* and
 * not units deliberately: "9 of 12 lines in" is what a shopkeeper chases an
 * order with, and a part-delivered line is still a line to chase.
 */
function progress(order: PurchaseOrder): { label: string; tone: string } {
  if (order.lines === 0) return { label: "Empty", tone: "text-graphite-500" };
  if (order.receivedLines === 0) {
    return { label: "Nothing in", tone: "text-graphite-500" };
  }
  if (order.receivedLines >= order.lines) {
    return { label: "All in", tone: "text-signal-good" };
  }

  return {
    label: `${order.receivedLines} of ${order.lines} in`,
    tone: "text-signal-warn",
  };
}

const columnsFor = (
  money: (value: number) => string,
  onOpen: (order: PurchaseOrder) => void,
): Column<PurchaseOrder>[] => [
  {
    key: "order",
    header: "Order",
    cell: (order) => (
      <button
        type="button"
        onClick={() => onOpen(order)}
        className="block w-full text-left"
      >
        <span className="block truncate font-mono text-[0.8125rem] font-medium text-graphite-900 underline-offset-2 hover:underline">
          {order.orderNumber}
        </span>
        <span className="block truncate text-[0.6875rem] text-graphite-500">
          {order.supplierName}
        </span>
      </button>
    ),
  },
  {
    key: "status",
    header: "Status",
    cell: (order) => (
      <span
        className={`pos-badge ${
          order.status === "cancelled"
            ? "pos-badge-warn"
            : order.status === "placed"
              ? "pos-badge-good"
              : ""
        }`}
      >
        {orderStatus(order.status).label}
      </span>
    ),
  },
  {
    key: "delivery",
    header: "Delivered",
    hideBelow: "md",
    cell: (order) => {
      const state = progress(order);
      return <span className={`text-[0.8125rem] ${state.tone}`}>{state.label}</span>;
    },
  },
  {
    key: "expected",
    header: "Expected",
    hideBelow: "lg",
    cell: (order) => (
      <span className="text-graphite-700">
        {order.expectedOn ? (
          writeBusinessDay(order.expectedOn)
        ) : (
          <span className="text-graphite-500">when he comes</span>
        )}
      </span>
    ),
  },
  {
    key: "total",
    header: "Value",
    align: "end",
    cell: (order) => money(order.total),
  },
  {
    key: "open",
    header: "",
    align: "end",
    cell: (order) => (
      <button
        type="button"
        onClick={() => onOpen(order)}
        className="pos-icon-btn"
        aria-label={`Open ${order.orderNumber}`}
      >
        <IconChevron className="h-4 w-4 -rotate-90" />
      </button>
    ),
  },
];

export function OrdersPanel({
  orders,
  suppliers,
  products,
  settings,
}: {
  orders: PurchaseOrder[];
  suppliers: { id: string; name: string }[];
  products: Product[];
  settings: ShopSettings;
}) {
  // Built here rather than handed down: a formatter is a function, and a
  // function cannot cross the server/client boundary. `counter.ts` carries
  // no `server-only` for exactly this.
  const money = moneyFormatter(settings);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterId>("all");
  const [, start] = useTransition();

  // Null is closed, an order detail is the editor, `"new"` is the empty sheet,
  // and `"loading"` is the moment between pressing a row and its lines landing.
  const [open, setOpen] = useState<PurchaseOrderDetail | "new" | "loading" | null>(
    null,
  );

  const rows = useMemo(
    () =>
      orders.filter(
        (order) => filterBy(filter).match(order) && matchesOrder(order, query),
      ),
    [orders, query, filter],
  );

  const columns = useMemo(
    () =>
      columnsFor(money, (order) => {
        setOpen("loading");
        start(async () => {
          const detail = await loadOrder(order.id);
          // Null is an order somebody else deleted, or a gate that has since
          // closed. Shutting the sheet is the honest answer — there is nothing
          // to show and a spinner that never resolves is worse.
          setOpen(detail ?? null);
        });
      }),
    [money],
  );

  const filterOptions: SelectOption[] = useMemo(
    () =>
      FILTERS.map((entry) => ({
        id: entry.id,
        label: entry.label,
        description: entry.note,
        meta: orders.filter(entry.match).length.toLocaleString("en-PK"),
      })),
    [orders],
  );

  return (
    <>
      <ChartCard
        title="Orders"
        caption={
          rows.length === orders.length
            ? `${orders.length} raised`
            : `${rows.length} of ${orders.length}`
        }
        bleed
        actions={
          <button
            type="button"
            onClick={() => setOpen("new")}
            disabled={suppliers.length === 0}
            className="pos-btn pos-btn-primary disabled:pointer-events-none disabled:opacity-45"
            title={
              suppliers.length === 0
                ? "Add a supplier first — an order has to be with somebody"
                : undefined
            }
          >
            <IconPlus className="h-4 w-4" />
            Raise an order
          </button>
        }
      >
        <div className="flex items-center gap-2 px-4 pb-3">
          <div className="relative min-w-0 flex-1">
            <IconSearch className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-graphite-500" />
            <input
              className="pos-field pr-9 pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Order number, supplier, or anything in the note"
              aria-label="Search the orders"
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

          <div className="w-[12rem] flex-none">
            <Select
              value={filter}
              onChange={(next) => setFilter(next as FilterId)}
              options={filterOptions}
              label="Narrow the orders"
            />
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(order) => order.id}
          empty={
            orders.length === 0
              ? "No orders yet. Raise one when you next ring a distributor — or just take the delivery in when his van comes, which needs no order at all."
              : query
                ? `Nothing matches “${query.trim()}”.`
                : "No orders under this filter."
          }
        />
      </ChartCard>

      {open === "new" || (open && open !== "loading") ? (
        <OrderSheet
          order={open === "new" ? null : open}
          suppliers={suppliers}
          products={products}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}
