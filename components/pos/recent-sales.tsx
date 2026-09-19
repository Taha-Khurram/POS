import { rupees } from "@/lib/format";
import type { RecentSale, SaleStatus, TenderMethod } from "@/lib/pos/dashboard";

import { DataTable, type Column } from "./data-table";

/**
 * How each tender method is written at the counter. These are the exact values
 * the `sale_tenders.method` check constraint allows, so the labels are a
 * lookup rather than a `toUpperCase()` — "Easypaisa" and "JazzCash" are brand
 * names and get their own capitalisation.
 */
const METHOD_LABEL: Record<TenderMethod, string> = {
  cash: "Cash",
  card: "Card",
  raast: "Raast",
  easypaisa: "Easypaisa",
  jazzcash: "JazzCash",
};

/**
 * Status carries a word as well as a colour. Nobody should have to remember
 * which shade of which hue meant "the customer brought it back".
 */
const STATUS: Record<SaleStatus, { label: string; className: string }> = {
  completed: { label: "Paid", className: "pos-badge-good" },
  held: { label: "Held", className: "pos-badge-warn" },
  returned: { label: "Returned", className: "pos-badge-bad" },
};

const COLUMNS: Column<RecentSale>[] = [
  {
    key: "receipt",
    header: "Receipt",
    cell: (sale) => (
      <span className="font-medium text-graphite-900 tabular-nums">
        {sale.receipt}
      </span>
    ),
  },
  { key: "at", header: "Time", cell: (sale) => sale.at },
  {
    key: "items",
    header: "Items",
    align: "end",
    hideBelow: "sm",
    cell: (sale) => sale.items,
  },
  {
    key: "method",
    header: "Payment",
    hideBelow: "md",
    // A bill settled two ways has no single method, so it is named as what it
    // is rather than shown as the larger half — the same call `writeTender`
    // makes on the history. A bill with no tender row at all is a held one,
    // and it has not been paid by anything yet.
    cell: (sale) =>
      sale.method === null ? (
        <span className="text-graphite-500">—</span>
      ) : (
        <span className="pos-badge pos-badge-info">
          {sale.split ? "Split" : METHOD_LABEL[sale.method]}
        </span>
      ),
  },
  {
    key: "total",
    header: "Total",
    align: "end",
    cell: (sale) => (
      <span className="font-semibold text-graphite-900">{rupees(sale.total)}</span>
    ),
  },
  {
    key: "status",
    header: "Status",
    align: "end",
    cell: (sale) => (
      <span className={`pos-badge ${STATUS[sale.status].className}`}>
        {STATUS[sale.status].label}
      </span>
    ),
  },
];

export function RecentSalesTable({ sales }: { sales: RecentSale[] }) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={sales}
      rowKey={(sale) => sale.id}
      empty="No sales rung up in this period."
    />
  );
}
