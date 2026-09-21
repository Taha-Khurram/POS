"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { IconCheck, IconClose, IconTruck } from "@/components/pos/icons";
import { SelectRow } from "@/components/pos/select-field";
import { useToast } from "@/components/pos/toaster";
import type { Product } from "@/lib/pos/catalog";
import { newSaleId } from "@/lib/pos/counter";
import { rupees } from "@/lib/format";
import {
  checkReceipt,
  COST_MAX,
  INVOICE_NO_MAX,
  NOTE_MAX,
  outstanding,
  receiptTotals,
  type PurchaseOrderDetail,
} from "@/lib/pos/purchase";
import { recordGoodsReceipt } from "./receipt-actions";
import { PurchaseLines, newLineKey, type DraftLine } from "./purchase-lines";

/**
 * A delivery, taken in.
 *
 * This is the screen that changes what the shop believes its stock costs, and
 * it is built so that nobody is surprised by that. The freight box is beside
 * the lines rather than buried at the end, and under it the sheet shows what
 * each item will land at — because "Rs 500 bhaara on this van" is the figure a
 * shopkeeper has in their hand and has never before been able to get into a
 * cost price without long division.
 *
 * The id is minted here, once, for a stronger version of the reason a sale's
 * is: a retried delivery that recorded twice is a shelf count nobody can
 * reconcile without reading the ledger back.
 *
 * Receiving against an order is optional and secondary. Most kiryana buying is
 * a van that turns up, and a screen that insists on an order first is a screen
 * the shop works around — so the order picker starts empty and prefills the
 * lines when one is chosen.
 */
export function ReceiveSheet({
  suppliers,
  products,
  /** The placed orders with something still owed on them, by supplier. Read on
   *  the server with the page, so choosing a supplier costs no round trip. */
  openOrders,
  onClose,
}: {
  suppliers: { id: string; name: string }[];
  products: Product[];
  openOrders: PurchaseOrderDetail[];
  onClose: () => void;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const receiptId = useRef(newSaleId());

  const [supplierId, setSupplierId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [receivedOn, setReceivedOn] = useState(today());
  const [invoiceNo, setInvoiceNo] = useState("");
  const [note, setNote] = useState("");
  const [freight, setFreight] = useState("");
  const [otherCost, setOtherCost] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);

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

  const ordersForSupplier = useMemo(
    () => openOrders.filter((order) => order.supplierId === supplierId),
    [openOrders, supplierId],
  );

  /**
   * Choosing an order fills the lines with what it is still owed.
   *
   * Prefilled at what was *ordered*, not at what last arrived: the order is the
   * rate that was agreed, and a delivery that comes in dearer is exactly the
   * thing the person at the door should have to notice and change. `expected`
   * rides along so the line can say what is outstanding without the order being
   * open beside it.
   */
  const chooseOrder = (next: string) => {
    setOrderId(next);

    const order = openOrders.find((entry) => entry.id === next);
    if (!order) return;

    setLines(
      order.items
        .filter((line) => outstanding(line) > 0)
        .map((line) => ({
          key: newLineKey(),
          itemId: line.itemId,
          orderLineId: line.key,
          name: line.name,
          unit: line.unit,
          quantity: outstanding(line),
          unitCost: line.unitCost,
          expected: outstanding(line),
          // Off the catalog, not off the order: an order does not know which
          // carton will come, and whether the item is tracked is a fact about
          // the item now rather than when the order was raised.
          tracksBatches: products.find((p) => p.id === line.itemId)?.tracksBatches,
          batchNo: "",
          expiresOn: "",
        })),
    );
  };

  const freightValue = amount(freight);
  const otherValue = amount(otherCost);

  // The same arithmetic `record_receipt` does inside the transaction, restated
  // so the sheet can show it live. The one that lands is the function's.
  const totals = receiptTotals(lines, freightValue, otherValue);

  const complaint = checkReceipt({
    supplierId,
    receivedOn,
    supplierInvoiceNo: invoiceNo,
    note,
    freight: freightValue,
    otherCost: otherValue,
    lines,
  });

  const costed = lines.filter((line) => line.itemId).length;

  const submit = () => {
    setError(null);

    start(async () => {
      const result = await recordGoodsReceipt({
        receiptId: receiptId.current,
        supplierId,
        orderId,
        receivedOn,
        supplierInvoiceNo: invoiceNo,
        note,
        freight: freightValue,
        otherCost: otherValue,
        lines: lines.map((line) => ({
          itemId: line.itemId,
          orderLineId: line.orderLineId,
          name: line.name,
          unit: line.unit,
          quantity: line.quantity,
          unitCost: line.unitCost,
          batchNo: line.batchNo ?? "",
          expiresOn: line.expiresOn ?? "",
        })),
      });

      if (!result.ok) return setError(result.error);

      toast({
        title: `${result.grnNumber} received`,
        detail: costed
          ? `On the shelf, and the cost updated on ${costed} ${costed === 1 ? "item" : "items"}.`
          : "On the record. No catalog item on it, so no shelf moved.",
        tone: "good",
      });

      onClose();
    });
  };

  return (
    <div
      className="pos-modal"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Take a delivery in"
        tabIndex={-1}
        className="pos-sheet outline-none"
      >
        <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-orchid-100 bg-paper-50 px-4 py-3.5 sm:px-5">
          <span className="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-xl bg-orchid-200 text-orchid-800">
            <IconTruck className="h-[18px] w-[18px]" />
          </span>

          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[1rem] leading-tight font-bold">
              Take a delivery in
            </h2>
            <p className="mt-0.5 truncate text-[0.75rem] text-graphite-500">
              Goes on the shelf and sets what each item cost you.
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

        <fieldset disabled={pending} className="space-y-5 px-4 py-5 sm:px-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectRow
              label="Who it came from"
              value={supplierId}
              onChange={(next) => {
                setSupplierId(next);
                // The order belonged to the old supplier. Keeping it would file
                // this delivery under somebody else's paperwork, and
                // `record_receipt` refuses that outright — better to clear it
                // here than to bounce the save.
                setOrderId("");
              }}
              disabled={suppliers.length === 0}
              placeholder={
                suppliers.length === 0 ? "No suppliers yet" : "Pick the supplier"
              }
              options={suppliers.map((one) => ({ id: one.id, label: one.name }))}
              hint={
                suppliers.length === 0
                  ? "Add one on the Suppliers tab first."
                  : undefined
              }
            />

            <label className="block">
              <span className="pos-label">Day it arrived</span>
              <input
                type="date"
                className="pos-field"
                value={receivedOn}
                onChange={(event) => setReceivedOn(event.target.value)}
              />
              <p className="pos-hint">
                Not the day you are typing it. A Saturday delivery entered on
                Monday belongs to Saturday.
              </p>
            </label>
          </div>

          {/* ---------------- Against an order, if there was one ------------- */}
          {supplierId ? (
            ordersForSupplier.length > 0 ? (
              <SelectRow
                label="Against an order — optional"
                value={orderId}
                onChange={chooseOrder}
                placeholder="No order — the van just came"
                options={[
                  { id: "", label: "No order — the van just came" },
                  ...ordersForSupplier.map((order) => ({
                    id: order.id,
                    label: order.orderNumber,
                    description: `${order.items.filter((line) => outstanding(line) > 0).length} lines still owed`,
                  })),
                ]}
                hint="Picking one fills the lines with what it is still owed."
              />
            ) : (
              <p className="rounded-2xl border border-orchid-100 bg-orchid-50/60 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-graphite-700">
                No open order with them — which is fine, and normal. Add the
                lines below as they come off the van.
              </p>
            )
          ) : null}

          {/* ---------------- What arrived ---------------- */}
          <div>
            <span className="pos-label">What came in</span>
            <div className="mt-1">
              <PurchaseLines
                lines={lines}
                products={products}
                onChange={setLines}
                costLabel="Invoice cost each"
                askBatch
              />
            </div>
          </div>

          {/* ---------------- What it cost to get here ---------------- */}
          <section className="rounded-2xl border border-orchid-100 p-3.5">
            <h3 className="font-display text-[0.9375rem] font-semibold">
              What it cost to get here
            </h3>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-graphite-700">
              Spread across the lines by what each is worth, then added to what
              each item costs you. This is the difference between a margin you
              guess and one you can stand behind.
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="pos-label">Freight — bhaara</span>
                <input
                  className="pos-field text-right tabular-nums"
                  inputMode="decimal"
                  value={freight}
                  placeholder="0"
                  onChange={(event) => setFreight(event.target.value)}
                />
              </label>

              <label className="block">
                <span className="pos-label">Anything else</span>
                <input
                  className="pos-field text-right tabular-nums"
                  inputMode="decimal"
                  value={otherCost}
                  placeholder="0"
                  onChange={(event) => setOtherCost(event.target.value)}
                />
                <p className="pos-hint">Labour, octroi, the boy who carried it up.</p>
              </label>
            </div>

            {/* What that does, per line, before anybody presses save. The whole
                argument for landed cost is invisible until it is shown like
                this: Rs 500 across a van is nothing until it is Rs 19.75 on a
                roll of foil. */}
            {totals.extra > 0 && lines.length > 0 ? (
              <ul className="mt-3 space-y-1 border-t border-orchid-100 pt-2.5">
                {lines.map((line, index) => {
                  const landed = totals.landed[index];
                  const moved = landed.landedUnitCost - line.unitCost;

                  return (
                    <li
                      key={line.key}
                      className="flex items-center justify-between gap-3 text-[0.75rem]"
                    >
                      <span className="min-w-0 flex-1 truncate text-graphite-700">
                        {line.name}
                      </span>
                      <span className="flex-none tabular-nums text-graphite-500">
                        {line.unitCost.toFixed(2)} →{" "}
                        <strong className="font-semibold text-graphite-900">
                          {landed.landedUnitCost.toFixed(2)}
                        </strong>
                        <span className="text-signal-warn"> +{moved.toFixed(2)}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="pos-label">Their invoice number — optional</span>
              <input
                className="pos-field font-mono"
                value={invoiceNo}
                maxLength={INVOICE_NO_MAX}
                autoComplete="off"
                placeholder="RT-4821"
                onChange={(event) => setInvoiceNo(event.target.value)}
              />
              <p className="pos-hint">
                Theirs, not ours. It is what you match against when he comes to
                settle.
              </p>
            </label>

            <label className="block">
              <span className="pos-label">Note — optional</span>
              <textarea
                className="pos-field min-h-[4rem] resize-y"
                value={note}
                maxLength={NOTE_MAX}
                placeholder="Two bags torn. He is replacing them next week."
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
          </div>
        </fieldset>

        <footer className="sticky bottom-0 border-t border-orchid-100 bg-paper-50 px-4 py-3 sm:px-5">
          {error ? (
            <p className="mb-2 text-[0.8125rem] leading-snug text-signal-bad">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="mr-auto min-w-[10rem] flex-1">
              {complaint && lines.length > 0 ? (
                <p className="text-[0.75rem] leading-snug text-graphite-700">
                  {complaint}
                </p>
              ) : lines.length > 0 ? (
                <p className="text-[0.8125rem] tabular-nums">
                  <span className="text-graphite-500">Goods </span>
                  <span className="text-graphite-900">{rupees(totals.subtotal)}</span>
                  {totals.extra > 0 ? (
                    <>
                      <span className="text-graphite-500"> + </span>
                      <span className="text-graphite-900">{rupees(totals.extra)}</span>
                      <span className="text-graphite-500"> carriage</span>
                    </>
                  ) : null}
                  <span className="text-graphite-500"> = </span>
                  <span className="font-display font-bold text-graphite-900">
                    {rupees(totals.total)}
                  </span>
                </p>
              ) : null}
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="pos-btn pos-btn-soft"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={submit}
              disabled={pending || Boolean(complaint)}
              className="pos-btn pos-btn-primary disabled:opacity-60"
            >
              <IconCheck className="h-4 w-4" />
              {pending ? "Recording…" : "Put it on the shelf"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/** A typed amount. Empty is nought, which is what an untouched freight box
 *  means — not a refusal. */
function amount(raw: string): number {
  const value = Number(raw.replace(/[,\s]/g, ""));
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(value, COST_MAX);
}

/** The browser's own date, and the one place in this codebase that is allowed
 *  to be: it is the *default* in a date input somebody can change, not a figure
 *  anything is filed under. The trading day never enters into it — a delivery
 *  is filed by the day it arrived, which is a calendar date on a delivery note
 *  and not a till's idea of when the books close. */
function today(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}
