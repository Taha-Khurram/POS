"use client";

import { useEffect } from "react";

import { IconClose, IconTruck } from "@/components/pos/icons";
import { writeBusinessDay } from "@/lib/pos/counter";
import type { GoodsReceiptDetail } from "@/lib/pos/purchase";

/**
 * One delivery, read back.
 *
 * Read-only, and it will stay that way. A goods-received note is a record of
 * something that physically happened: the stock went on the shelf and the cost
 * price moved on the strength of it. Editing one afterwards would have to
 * unwind a stock movement and guess what the cost should go back to, which is
 * how a shelf count stops matching a ledger. A delivery entered wrongly is
 * corrected the way a shop corrects one on paper — by counting the shelf on the
 * Products screen, which writes its own movement and says why.
 *
 * **The landed cost is shown beside the invoice cost on every line**, because
 * that is the one thing this screen exists to explain. An owner looking at a
 * margin they do not believe opens the delivery that set the cost, and the
 * answer is in the gap between those two columns.
 */
export function ReceiptDrawer({
  receipt,
  money,
  onClose,
}: {
  receipt: GoodsReceiptDetail;
  money: (value: number) => string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const extra = receipt.freight + receipt.otherCost;

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
        aria-label={`Delivery ${receipt.grnNumber}`}
        tabIndex={-1}
        className="pos-sheet outline-none"
      >
        <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-orchid-100 bg-paper-50 px-4 py-3.5 sm:px-5">
          <span className="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-xl bg-orchid-200 text-orchid-800">
            <IconTruck className="h-[18px] w-[18px]" />
          </span>

          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[1rem] leading-tight font-bold">
              {receipt.grnNumber}
            </h2>
            <p className="mt-0.5 truncate text-[0.75rem] text-graphite-500">
              {receipt.supplierName} · arrived{" "}
              {writeBusinessDay(receipt.receivedOn)}
              {receipt.orderNumber ? ` · against ${receipt.orderNumber}` : ""}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="pos-icon-btn"
            aria-label="Close"
          >
            <IconClose />
          </button>
        </header>

        <div className="space-y-4 px-4 py-5 sm:px-5">
          {receipt.supplierInvoiceNo ? (
            <p className="text-[0.8125rem] text-graphite-700">
              <span className="text-graphite-500">Their invoice </span>
              <span className="font-mono text-graphite-900">
                {receipt.supplierInvoiceNo}
              </span>
            </p>
          ) : null}

          <div className="overflow-hidden rounded-2xl border border-orchid-100">
            <table className="w-full text-[0.8125rem]">
              <thead>
                <tr className="border-b border-orchid-100 bg-orchid-50/60 text-left text-[0.6875rem] font-semibold tracking-wide text-graphite-500 uppercase">
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Invoice</th>
                  <th className="px-3 py-2 text-right">Landed</th>
                  <th className="px-3 py-2 text-right">Line</th>
                </tr>
              </thead>
              <tbody>
                {receipt.items.map((line) => (
                  <tr key={line.key} className="border-b border-orchid-100 last:border-0">
                    <td className="px-3 py-2">
                      <span className="block truncate text-graphite-900">
                        {line.name}
                      </span>
                      {line.itemId ? null : (
                        <span className="text-[0.6875rem] text-graphite-500">
                          not in the item list — no shelf moved
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-graphite-700">
                      {line.quantity.toLocaleString("en-PK")}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-graphite-500">
                      {line.unitCost.toFixed(2)}
                    </td>
                    {/* The column the whole screen is for. */}
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-graphite-900">
                      {line.landedUnitCost.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-graphite-700">
                      {line.lineTotal.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <dl className="space-y-1.5 text-[0.8125rem]">
            <Row label="Goods" value={money(receipt.subtotal)} />
            {receipt.freight > 0 ? (
              <Row label="Freight — bhaara" value={money(receipt.freight)} />
            ) : null}
            {receipt.otherCost > 0 ? (
              <Row label="Other" value={money(receipt.otherCost)} />
            ) : null}
            <div className="flex items-center justify-between border-t border-orchid-100 pt-1.5">
              <dt className="font-display font-semibold text-graphite-900">Total</dt>
              <dd className="font-display text-[1.0625rem] font-bold tabular-nums text-graphite-900">
                {money(receipt.total)}
              </dd>
            </div>
          </dl>

          {extra > 0 ? (
            <p className="rounded-2xl border border-orchid-100 bg-orchid-50/60 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-graphite-700">
              The {money(extra)} of carriage is spread across the lines by what
              each is worth, which is why every landed cost above is higher than
              its invoice cost. Those landed figures are what each item is costed
              at from here on — bills rung up before this delivery keep the cost
              they were rung up with.
            </p>
          ) : null}

          {receipt.note ? (
            <p className="rounded-2xl border border-orchid-100 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-graphite-700">
              {receipt.note}
            </p>
          ) : null}
        </div>

        <footer className="sticky bottom-0 flex justify-end border-t border-orchid-100 bg-paper-50 px-4 py-3 sm:px-5">
          <button type="button" onClick={onClose} className="pos-btn pos-btn-soft">
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-graphite-500">{label}</dt>
      <dd className="tabular-nums text-graphite-900">{value}</dd>
    </div>
  );
}
