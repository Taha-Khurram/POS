"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import { DataTable, type Column } from "@/components/pos/data-table";
import { IconClose, IconPlus, IconSearch } from "@/components/pos/icons";
import { writeBusinessDay } from "@/lib/pos/counter";
import {
  matchesPayment,
  paymentMethod,
  type SupplierBalance,
  type SupplierPayment,
} from "@/lib/pos/ledger";
import { PaymentSheet } from "./payment-sheet";

/**
 * What the shop has paid out.
 *
 * Its own tab rather than a section of the supplier record, because "what went
 * out this month" is a question asked of the whole shop — usually with a bank
 * statement in the other hand. Per-supplier is the record screen's job.
 *
 * The reference is a column of its own and not a detail line, because it is the
 * thing being matched against: somebody reconciling cheque numbers reads down
 * that column and nothing else.
 */
const columnsFor = (money: (value: number) => string): Column<SupplierPayment>[] => [
  {
    key: "supplier",
    header: "Paid to",
    cell: (payment) => (
      <Link
        href={`/app/purchasing?tab=suppliers&supplier=${payment.supplierId}`}
        className="block min-w-0"
      >
        <span className="block truncate font-medium text-graphite-900 underline-offset-2 hover:underline">
          {payment.supplierName}
        </span>
        <span className="block truncate text-[0.6875rem] text-graphite-500">
          {paymentMethod(payment.method).label}
        </span>
      </Link>
    ),
  },
  {
    key: "day",
    header: "Paid on",
    cell: (payment) => (
      <span className="text-graphite-700">{writeBusinessDay(payment.paidOn)}</span>
    ),
  },
  {
    key: "reference",
    header: "Reference",
    hideBelow: "md",
    cell: (payment) => (
      <span className="font-mono text-[0.75rem] text-graphite-700">
        {payment.reference || <span className="text-graphite-500">—</span>}
      </span>
    ),
  },
  {
    key: "note",
    header: "Note",
    hideBelow: "lg",
    cell: (payment) => (
      <span className="block max-w-[18rem] truncate text-graphite-700">
        {payment.note || <span className="text-graphite-500">—</span>}
      </span>
    ),
  },
  {
    key: "amount",
    header: "Amount",
    align: "end",
    cell: (payment) => (
      <span className="font-semibold tabular-nums text-graphite-900">
        {money(payment.amount)}
      </span>
    ),
  },
];

export function PaymentsPanel({
  payments,
  suppliers,
  balances,
  today,
  money,
}: {
  payments: SupplierPayment[];
  suppliers: { id: string; name: string }[];
  balances: Map<string, SupplierBalance>;
  today: string;
  money: (value: number) => string;
}) {
  const [query, setQuery] = useState("");
  const [paying, setPaying] = useState(false);

  const rows = useMemo(
    () => payments.filter((payment) => matchesPayment(payment, query)),
    [payments, query],
  );

  const columns = useMemo(() => columnsFor(money), [money]);

  // Totalled over the rows on screen, and the caption says which rows those
  // are — the same bargain `/app/sales` strikes, because a total quietly added
  // up from something other than what is in the table is the one thing nobody
  // can catch.
  const total = rows.reduce((sum, payment) => sum + payment.amount, 0);

  return (
    <>
      <ChartCard
        title="Payments"
        caption={
          rows.length === payments.length
            ? `${payments.length} recorded · ${money(total)}`
            : `${rows.length} of ${payments.length} · ${money(total)}`
        }
        bleed
        actions={
          <button
            type="button"
            onClick={() => setPaying(true)}
            disabled={suppliers.length === 0}
            className="pos-btn pos-btn-primary disabled:pointer-events-none disabled:opacity-45"
            title={
              suppliers.length === 0
                ? "Add a supplier first — a payment has to go to somebody"
                : undefined
            }
          >
            <IconPlus className="h-4 w-4" />
            Record a payment
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
              placeholder="Supplier, cheque number, amount, or anything in the note"
              aria-label="Search the payments"
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
          rowKey={(payment) => payment.id}
          empty={
            payments.length === 0
              ? "Nothing paid out yet. Record what you hand a distributor's man and the balance on his record follows it down."
              : `Nothing matches “${query.trim()}”.`
          }
        />
      </ChartCard>

      {paying ? (
        <PaymentSheet
          suppliers={suppliers}
          balances={balances}
          today={today}
          money={money}
          onClose={() => setPaying(false)}
        />
      ) : null}
    </>
  );
}

/**
 * The same sheet, opened from a supplier's own record with them preselected.
 *
 * A component of its own rather than lifting the sheet's state into the page,
 * because the record screen is a server component and the sheet is a modal:
 * this is the smallest client leaf that can hold "is it open".
 */
export function PaySupplierButton({
  supplier,
  balances,
  today,
  money,
}: {
  supplier: { id: string; name: string };
  balances: Map<string, SupplierBalance>;
  today: string;
  money: (value: number) => string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pos-btn pos-btn-primary pos-btn-sm"
      >
        <IconPlus className="h-4 w-4" />
        Record a payment
      </button>

      {open ? (
        <PaymentSheet
          suppliers={[supplier]}
          supplierId={supplier.id}
          balances={balances}
          today={today}
          money={money}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
