"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  IconAlert,
  IconCard,
  IconCash,
  IconChevron,
  IconClose,
  IconCopy,
  IconPrinter,
  IconUser,
} from "@/components/pos/icons";
import { useToast } from "@/components/pos/toaster";
import { isFractional, unitShort, type UnitId } from "@/lib/pos/catalog";
import {
  moneyFormatter,
  receiptStamp,
  round2,
  type Bill,
  type CartLine,
  type Counter,
} from "@/lib/pos/counter";
import {
  writeDayLong,
  writeTender,
  type BillDetail,
  type BillRow,
} from "@/lib/pos/history";
import type { ShopSettings } from "@/lib/pos/settings-options";
import type { ShopProfile } from "@/lib/pos/shop";
import { Receipt, type Sale } from "../register/receipt";
import { loadBill } from "./actions";

/**
 * One bill, opened off the history.
 *
 * A sheet over the list rather than a page of its own, because the list is
 * something somebody has usually searched and filtered their way to, and a
 * navigation per bill throws that away between every look. The arrows in the
 * footer — and the arrow keys — walk the filtered list without closing it,
 * which is how a shopkeeper actually checks "was it this one or the one
 * before".
 *
 * The row is already in hand, so the header, the totals and the payment are
 * drawn the instant it opens. Only the *lines* are fetched, because a window of
 * two thousand bills is twenty thousand lines and nobody opens more than a
 * handful.
 *
 * The right-hand column is the real receipt component, not a rendering of it:
 * printing here goes through the same `@media print` block as the register's,
 * so the duplicate that comes off the roll is the bill as the counter printed
 * it. What it cannot reprint is the sales-tax line — `sale_lines` stores the
 * price and not the rate it was taxed at, so the roll shows the lines, the
 * subtotal and the total exactly, and breaks out no tax it would have to guess.
 */
export function BillDrawer({
  bill,
  counters,
  shop,
  settings,
  canSeeCustomers,
  position,
  onStep,
  onClose,
}: {
  bill: BillRow;
  counters: Counter[];
  shop: ShopProfile | null;
  settings: ShopSettings;
  /** Whether this session may reach the customer's record. The name shows
   *  either way — it was on the bill — but a cashier without the module gets
   *  no link into a screen that would 404 on them. */
  canSeeCustomers: boolean;
  /** Where this bill sits in the filtered list, and how long that list is. */
  position: { index: number; of: number };
  onStep: (delta: 1 | -1) => void;
  onClose: () => void;
}) {
  /**
   * What came back, and which bill and which attempt it came back for.
   *
   * Stamped rather than cleared, so the effect never has to `setState` on its
   * way in: stepping to the next bill leaves the previous answer in state and
   * the stamp stops it being drawn, which is the same thing a reset would
   * achieve without a second render to achieve it.
   */
  const [answer, setAnswer] = useState<{
    id: string;
    attempt: number;
    detail?: BillDetail;
    error?: string;
  } | null>(null);

  const [attempt, setAttempt] = useState(0);
  const toast = useToast();

  const money = moneyFormatter(settings);

  // Re-runs on every bill, so stepping through the list with the arrows loads
  // each one. The cleanup drops a reply that arrives after the next bill was
  // asked for, which on a slow connection is what would otherwise draw the
  // wrong lines under the right header.
  useEffect(() => {
    let live = true;

    loadBill(bill.id)
      .then((result) => {
        if (!live) return;
        setAnswer(
          result.ok
            ? { id: bill.id, attempt, detail: result.bill }
            : { id: bill.id, attempt, error: result.error },
        );
      })
      .catch(() => {
        if (!live) return;
        setAnswer({
          id: bill.id,
          attempt,
          error:
            "We could not reach Flo to open this bill. Check the connection and try again.",
        });
      });

    return () => {
      live = false;
    };
  }, [bill.id, attempt]);

  const current =
    answer && answer.id === bill.id && answer.attempt === attempt ? answer : null;

  const detail = current?.detail ?? null;
  const error = current?.error ?? null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") onStep(-1);
      if (event.key === "ArrowRight") onStep(1);
    };

    document.addEventListener("keydown", onKeyDown);
    // The list behind must not scroll while the sheet is over it.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [onClose, onStep]);

  const counter =
    counters.find((entry) => entry.id === bill.counterId) ?? {
      name: bill.counterName,
      // A counter since deleted takes its footer line with it. The bill is
      // still the shop's and still prints.
      receiptFooter: null,
    };

  const copyNumber = async () => {
    try {
      await navigator.clipboard.writeText(bill.receiptNo);
      toast({ title: `Copied ${bill.receiptNo}`, tone: "good" });
    } catch {
      // A page served over plain http has no clipboard, which is exactly how a
      // shop's own Wi-Fi is usually set up. Saying so beats a button that
      // silently does nothing.
      toast({
        title: "Could not copy",
        detail: "Select the bill number and copy it by hand.",
        tone: "warn",
      });
    }
  };

  return (
    <div
      className="pos-modal"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Bill ${bill.receiptNo}`}
        className="pos-sheet pos-sheet-wide outline-none"
      >
        <header className="print-hide flex items-start gap-3 border-b border-orchid-100 px-4 py-3.5 sm:px-5">
          <span className="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-xl bg-orchid-100 text-orchid-800">
            <IconPrinter className="h-[18px] w-[18px]" />
          </span>

          <div className="min-w-0 flex-1">
            <h2 className="flex flex-wrap items-center gap-x-2 font-display text-[1rem] leading-tight font-bold">
              <span className="font-mono">{bill.receiptNo}</span>

              {/* The list only ever offers completed bills, so this is drawn
                  for a bill reached by its id — and a held or returned one
                  must never be read as a sale that counted. */}
              {bill.status !== "completed" ? (
                <span className="pos-badge pos-badge-warn align-middle">
                  {bill.status}
                </span>
              ) : null}

              <button
                type="button"
                onClick={copyNumber}
                className="pos-icon-btn h-6 w-6"
                aria-label={`Copy ${bill.receiptNo}`}
                title="Copy the bill number"
              >
                <IconCopy className="h-3.5 w-3.5" />
              </button>
            </h2>
            <p className="mt-0.5 text-[0.75rem] text-graphite-500">
              {writeDayLong(bill.businessDay)} ·{" "}
              {receiptStamp(new Date(bill.at), settings.timezone)}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="pos-icon-btn -mr-1.5 flex-none"
            aria-label="Close"
          >
            <IconClose className="h-4 w-4" />
          </button>
        </header>

        <div className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[1fr_19rem]">
          <div className="min-w-0 space-y-4">
            <dl className="grid gap-x-5 gap-y-1.5 text-[0.8125rem] sm:grid-cols-2">
              <Fact label="Counter" value={bill.counterName} />
              <Fact label="Rang it up" value={bill.cashierName} />
              <Fact
                label="Customer"
                value={
                  bill.customerName ? (
                    canSeeCustomers && bill.customerId ? (
                      <Link
                        href={`/app/customers?customer=${bill.customerId}`}
                        className="inline-flex items-center gap-1 text-orchid-700 underline-offset-2 hover:underline"
                      >
                        <IconUser className="h-3.5 w-3.5" />
                        {bill.customerName}
                      </Link>
                    ) : (
                      bill.customerName
                    )
                  ) : (
                    // Most bills in most shops. Said rather than left blank,
                    // because a blank reads as a field that failed to load.
                    <span className="text-graphite-500">Walk-in</span>
                  )
                }
              />
              <Fact label="Paid by" value={writeTender(bill.tenders)} />
            </dl>

            <BillLines
              detail={detail}
              error={error}
              onRetry={() => setAttempt((count) => count + 1)}
              money={money}
            />

            <Totals bill={bill} money={money} />
          </div>

          {/* The roll's own width on screen too, so nothing lines up here that
              will wrap on paper. It is only mounted once the lines are in —
              printing half a receipt is how a shop hands out a bill with items
              missing from it. */}
          <div className="min-w-0">
            {detail ? (
              <div className="mx-auto max-w-[19rem] rounded-xl border border-orchid-100 bg-paper-50 p-4 font-mono text-[0.75rem] leading-relaxed text-graphite-900">
                <Receipt
                  sale={asSale(detail)}
                  shop={
                    shop ?? {
                      id: "",
                      shopName: "Your shop",
                      ownerName: "",
                      phone: "",
                      email: null,
                      city: "",
                      shopType: "",
                      ntn: null,
                      strn: null,
                    }
                  }
                  counter={counter}
                  settings={settings}
                />
              </div>
            ) : null}
          </div>
        </div>

        <footer className="print-hide flex flex-wrap items-center gap-2 border-t border-orchid-100 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onStep(-1)}
              disabled={position.index <= 0}
              className="pos-icon-btn disabled:pointer-events-none disabled:opacity-35"
              aria-label="The bill before this one"
            >
              <IconChevron className="h-4 w-4 rotate-90" />
            </button>

            <span className="text-[0.75rem] tabular-nums text-graphite-500">
              {position.index + 1} of {position.of.toLocaleString("en-PK")}
            </span>

            <button
              type="button"
              onClick={() => onStep(1)}
              disabled={position.index >= position.of - 1}
              className="pos-icon-btn disabled:pointer-events-none disabled:opacity-35"
              aria-label="The bill after this one"
            >
              <IconChevron className="h-4 w-4 -rotate-90" />
            </button>
          </div>

          <div className="ms-auto flex items-center gap-2">
            <button type="button" onClick={onClose} className="pos-btn pos-btn-quiet">
              Close
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              disabled={!detail}
              className="pos-btn pos-btn-primary disabled:pointer-events-none disabled:opacity-45"
            >
              <IconPrinter className="h-4 w-4" />
              Print a duplicate
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The stored sale, back into the shape the receipt prints.
 *
 * `tendered` and `change` are null and zero: what the customer handed over and
 * what they got back were never written down, and inventing them on a duplicate
 * would be printing a figure the drawer was never counted against. `reprint`
 * is what puts DUPLICATE on the roll.
 */
function asSale(detail: BillDetail): Sale {
  const lines: CartLine[] = detail.lines.map((line) => {
    // 'kilo' is 0008's spelling and still valid in the column. One name here,
    // the same fold `recordSale` does on the way in.
    const unit = (line.unit === "kilo" ? "kg" : line.unit) as UnitId;

    return {
      id: line.id,
      name: line.name,
      // Not stored on the line. The roll printed it when the sale was rung up
      // and cannot print it again from a snapshot that never held it.
      urdu: "",
      unit,
      quantity: line.quantity,
      price: line.unitPrice,
      taxRate: 0,
      fractional: isFractional(unit),
    };
  });

  const bill: Bill = {
    lines: lines.length,
    units: round2(lines.reduce((sum, line) => sum + line.quantity, 0)),
    subtotal: detail.subtotal,
    // Not reprinted: `sale_lines` keeps the price and not the rate behind it.
    // A zero here is what keeps the tax line off the duplicate rather than
    // printing a figure worked out from today's rates.
    taxIncluded: 0,
    total: detail.total,
  };

  return {
    receiptNo: detail.receiptNo,
    recorded: true,
    at: new Date(detail.at),
    lines,
    customer: detail.customerName || null,
    bill,
    tenders: detail.tenders,
    tendered: null,
    change: 0,
    reprint: true,
  };
}

function BillLines({
  detail,
  error,
  onRetry,
  money,
}: {
  detail: BillDetail | null;
  error: string | null;
  onRetry: () => void;
  money: (amount: number) => string;
}) {
  if (error) {
    return (
      <div className="pos-note pos-note-bad">
        <IconAlert className="h-4 w-4 flex-none" />
        <span className="flex-1">
          {error}{" "}
          <button
            type="button"
            onClick={onRetry}
            className="font-semibold underline underline-offset-2"
          >
            Try again
          </button>
        </span>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-1.5" aria-busy="true" aria-label="Loading the lines">
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            className="h-8 animate-pulse rounded-lg bg-orchid-50"
            style={{ animationDelay: `${row * 90}ms` }}
          />
        ))}
      </div>
    );
  }

  if (detail.lines.length === 0) {
    return (
      <p className="text-[0.8125rem] text-graphite-500">
        No lines were stored against this bill.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-orchid-100">
      <table className="pos-table">
        <thead>
          <tr>
            <th>Item</th>
            <th className="text-right">Qty</th>
            <th className="text-right">Price</th>
            <th className="text-right">Line</th>
          </tr>
        </thead>

        <tbody>
          {detail.lines.map((line) => (
            <tr key={line.id}>
              <td className="max-w-[15rem] truncate font-medium text-graphite-900">
                {line.name}
              </td>
              <td className="pos-num">
                {line.quantity.toLocaleString("en-PK", { maximumFractionDigits: 3 })}{" "}
                <span className="text-graphite-500">
                  {unitShort((line.unit === "kilo" ? "kg" : line.unit) as UnitId)}
                </span>
              </td>
              <td className="pos-num">{money(line.unitPrice)}</td>
              <td className="pos-num font-medium">{money(line.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The arithmetic as it was stored, not as it is re-derived. `sales.subtotal`
 *  and `sales.total` are what the counter recorded, so they are what shows. */
function Totals({
  bill,
  money,
}: {
  bill: BillRow;
  money: (amount: number) => string;
}) {
  return (
    <div className="rounded-xl border border-orchid-100 bg-orchid-50/50 px-3.5 py-3">
      <dl className="space-y-1 text-[0.8125rem]">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-graphite-500">Subtotal</dt>
          <dd className="tabular-nums text-graphite-900">{money(bill.subtotal)}</dd>
        </div>

        {bill.discount > 0 ? (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-graphite-500">Discount</dt>
            <dd className="tabular-nums text-graphite-900">
              −{money(bill.discount)}
            </dd>
          </div>
        ) : null}

        {bill.tenders.map((tender, index) => (
          <div
            key={`${tender.method}-${index}`}
            className="flex items-baseline justify-between gap-3"
          >
            <dt className="flex items-center gap-1.5 text-graphite-500">
              {tender.method === "cash" ? (
                <IconCash className="h-3.5 w-3.5" />
              ) : tender.method === "card" ? (
                <IconCard className="h-3.5 w-3.5" />
              ) : null}
              {tender.method === "cash"
                ? "Cash"
                : tender.method === "card"
                  ? "Card"
                  : tender.method}
            </dt>
            <dd className="tabular-nums text-graphite-900">{money(tender.amount)}</dd>
          </div>
        ))}

        <div className="flex items-baseline justify-between gap-3 border-t border-orchid-200 pt-1.5">
          <dt className="font-display font-semibold text-graphite-900">Total</dt>
          <dd className="font-display text-[1.125rem] font-bold tabular-nums text-orchid-800">
            {money(bill.total)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-[5.5rem] flex-none text-graphite-500">{label}</dt>
      <dd className="min-w-0 truncate text-graphite-900">{value}</dd>
    </div>
  );
}
