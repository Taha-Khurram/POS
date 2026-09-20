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
import type { Product } from "@/lib/pos/catalog";
import { writeBusinessDay } from "@/lib/pos/counter";
import {
  matchesReceipt,
  type GoodsReceipt,
  type GoodsReceiptDetail,
  type PurchaseOrderDetail,
} from "@/lib/pos/purchase";
import { loadReceipt } from "./load-actions";
import { ReceiptDrawer } from "./receipt-drawer";
import { ReceiveSheet } from "./receive-sheet";

/**
 * The delivery list.
 *
 * The same shape as the orders panel, and deliberately a separate tab from it:
 * they are two different questions. An order is "what am I still owed"; a
 * delivery is "what came in, and what did it really cost me". A shopkeeper
 * opens the second one when a margin looks wrong.
 */
const columnsFor = (
  money: (value: number) => string,
  onOpen: (receipt: GoodsReceipt) => void,
): Column<GoodsReceipt>[] => [
  {
    key: "grn",
    header: "Delivery",
    cell: (receipt) => (
      <button
        type="button"
        onClick={() => onOpen(receipt)}
        className="block w-full text-left"
      >
        <span className="block truncate font-mono text-[0.8125rem] font-medium text-graphite-900 underline-offset-2 hover:underline">
          {receipt.grnNumber}
        </span>
        <span className="block truncate text-[0.6875rem] text-graphite-500">
          {receipt.supplierName}
          {receipt.orderNumber ? ` · against ${receipt.orderNumber}` : ""}
        </span>
      </button>
    ),
  },
  {
    key: "day",
    header: "Arrived",
    cell: (receipt) => (
      <span className="text-graphite-700">{writeBusinessDay(receipt.receivedOn)}</span>
    ),
  },
  {
    key: "invoice",
    header: "Their invoice",
    hideBelow: "lg",
    cell: (receipt) => (
      <span className="font-mono text-[0.75rem] text-graphite-700">
        {receipt.supplierInvoiceNo || <span className="text-graphite-500">—</span>}
      </span>
    ),
  },
  {
    key: "lines",
    header: "Lines",
    align: "end",
    hideBelow: "md",
    cell: (receipt) => (
      <span className="tabular-nums text-graphite-700">{receipt.lines}</span>
    ),
  },
  {
    key: "carriage",
    header: "Carriage",
    align: "end",
    hideBelow: "md",
    cell: (receipt) => {
      const extra = receipt.freight + receipt.otherCost;
      return extra > 0 ? (
        <span className="tabular-nums text-graphite-700">{money(extra)}</span>
      ) : (
        <span className="text-graphite-500">—</span>
      );
    },
  },
  {
    key: "total",
    header: "Total",
    align: "end",
    cell: (receipt) => money(receipt.total),
  },
  {
    key: "open",
    header: "",
    align: "end",
    cell: (receipt) => (
      <button
        type="button"
        onClick={() => onOpen(receipt)}
        className="pos-icon-btn"
        aria-label={`Open ${receipt.grnNumber}`}
      >
        <IconChevron className="h-4 w-4 -rotate-90" />
      </button>
    ),
  },
];

export function ReceiptsPanel({
  receipts,
  suppliers,
  products,
  openOrders,
  money,
}: {
  receipts: GoodsReceipt[];
  suppliers: { id: string; name: string }[];
  products: Product[];
  openOrders: PurchaseOrderDetail[];
  money: (value: number) => string;
}) {
  const [query, setQuery] = useState("");
  const [receiving, setReceiving] = useState(false);
  const [open, setOpen] = useState<GoodsReceiptDetail | null>(null);
  const [, start] = useTransition();

  const rows = useMemo(
    () => receipts.filter((receipt) => matchesReceipt(receipt, query)),
    [receipts, query],
  );

  const columns = useMemo(
    () =>
      columnsFor(money, (receipt) => {
        start(async () => {
          setOpen(await loadReceipt(receipt.id));
        });
      }),
    [money],
  );

  return (
    <>
      <ChartCard
        title="Deliveries"
        caption={
          rows.length === receipts.length
            ? `${receipts.length} taken in`
            : `${rows.length} of ${receipts.length}`
        }
        bleed
        actions={
          <button
            type="button"
            onClick={() => setReceiving(true)}
            disabled={suppliers.length === 0}
            className="pos-btn pos-btn-primary disabled:pointer-events-none disabled:opacity-45"
            title={
              suppliers.length === 0
                ? "Add a supplier first — a delivery has to come from somebody"
                : undefined
            }
          >
            <IconPlus className="h-4 w-4" />
            Take a delivery in
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
              placeholder="Delivery number, supplier, or their invoice number"
              aria-label="Search the deliveries"
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
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(receipt) => receipt.id}
          empty={
            receipts.length === 0
              ? "Nothing taken in yet. The next time a van comes, put it through here — the stock goes on the shelf and what you paid, carriage and all, becomes the cost each item is costed at."
              : `Nothing matches “${query.trim()}”.`
          }
        />
      </ChartCard>

      {receiving ? (
        <ReceiveSheet
          suppliers={suppliers}
          products={products}
          openOrders={openOrders}
          onClose={() => setReceiving(false)}
        />
      ) : null}

      {open ? (
        <ReceiptDrawer receipt={open} money={money} onClose={() => setOpen(null)} />
      ) : null}
    </>
  );
}
