"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { IconCheck, IconClose, IconTruck } from "@/components/pos/icons";
import { SelectRow } from "@/components/pos/select-field";
import { useToast } from "@/components/pos/toaster";
import { newSaleId } from "@/lib/pos/counter";
import type { Product } from "@/lib/pos/catalog";
import {
  checkOrder,
  lineTotalOf,
  NOTE_MAX,
  orderStatus,
  outstanding,
  type OrderStatus,
  type PurchaseOrderDetail,
} from "@/lib/pos/purchase";
import { saveOrder, setOrderStatus } from "./order-actions";
import { PurchaseLines, type DraftLine } from "./purchase-lines";

/**
 * One purchase order, raised or corrected.
 *
 * The id is minted here and not by the database, for the reason a sale's is:
 * shop 3G drops a request halfway and the tablet retries, and
 * `save_purchase_order` hands back the number the first attempt claimed rather
 * than raising a second order. A gap in a shop's PO series is a question an
 * accountant asks and nobody can answer.
 *
 * **An order with goods against it cannot have its lines changed** — the
 * function refuses, and this sheet says so before anybody types rather than
 * letting them fill a form that will bounce. What is offered instead is
 * closing it, which is what a shopkeeper means when the rest is not coming.
 */
export function OrderSheet({
  order,
  suppliers,
  products,
  onClose,
}: {
  /** The order being corrected, or null for a new one. */
  order: PurchaseOrderDetail | null;
  suppliers: { id: string; name: string }[];
  /** The shop's catalog, for the line search. Handed in rather than fetched so
   *  the sheet opens instantly — the page already read it. */
  products: Product[];
  onClose: () => void;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Minted once per sheet, not per save: a retry has to carry the *same* id or
  // it is a second order. A ref, because a re-render must not re-mint it.
  const orderId = useRef(order?.id ?? newSaleId());

  const [supplierId, setSupplierId] = useState(order?.supplierId ?? "");
  const [expectedOn, setExpectedOn] = useState(order?.expectedOn ?? "");
  const [note, setNote] = useState(order?.note ?? "");
  const [lines, setLines] = useState<DraftLine[]>(
    order
      ? order.items.map((line) => ({
          key: line.key,
          itemId: line.itemId,
          orderLineId: null,
          name: line.name,
          unit: line.unit,
          quantity: line.quantity,
          unitCost: line.unitCost,
        }))
      : [],
  );

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

  // Anything already delivered freezes the lines. Worked out here from what the
  // reader counted, so the sheet says it before somebody types rather than
  // after the function refuses.
  const frozen =
    order !== null &&
    (order.items.some((line) => line.received > 0) ||
      order.status === "closed" ||
      order.status === "cancelled");

  const subtotal = lines.reduce((total, line) => total + lineTotalOf(line), 0);

  const complaint = checkOrder({
    supplierId,
    expectedOn,
    note,
    lines,
  });

  const submit = (status: "draft" | "placed") => {
    setError(null);

    start(async () => {
      const result = await saveOrder({
        orderId: orderId.current,
        supplierId,
        expectedOn,
        note,
        status,
        lines: lines.map((line) => ({
          itemId: line.itemId,
          name: line.name,
          unit: line.unit,
          quantity: line.quantity,
          unitCost: line.unitCost,
        })),
      });

      if (!result.ok) return setError(result.error);

      toast({
        title:
          status === "placed"
            ? `${result.orderNumber} placed`
            : `${result.orderNumber} saved as a draft`,
        detail:
          status === "placed"
            ? "Receive against it when the van comes."
            : "Nobody has been rung yet.",
        tone: "good",
      });

      onClose();
    });
  };

  const move = (status: OrderStatus) => {
    setError(null);

    start(async () => {
      if (!order) return;

      const result = await setOrderStatus(order.id, status);
      if (!result.ok) return setError(result.error);

      toast({
        title: `${result.orderNumber} ${orderStatus(status).label.toLowerCase()}`,
        tone: status === "cancelled" ? "warn" : "good",
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
        aria-label={order ? `Order ${order.orderNumber}` : "Raise an order"}
        tabIndex={-1}
        className="pos-sheet outline-none"
      >
        <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-orchid-100 bg-paper-50 px-4 py-3.5 sm:px-5">
          <span className="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-xl bg-orchid-200 text-orchid-800">
            <IconTruck className="h-[18px] w-[18px]" />
          </span>

          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[1rem] leading-tight font-bold">
              {order ? order.orderNumber : "Raise an order"}
              {order ? (
                <span className="pos-badge ml-2 align-middle">
                  {orderStatus(order.status).label}
                </span>
              ) : null}
            </h2>
            <p className="mt-0.5 truncate text-[0.75rem] text-graphite-500">
              {frozen
                ? "Goods have come in against this, so its lines are fixed."
                : "What you are asking for. Nothing moves stock until it arrives."}
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
              label="Supplier"
              value={supplierId}
              onChange={setSupplierId}
              disabled={frozen || suppliers.length === 0}
              placeholder={
                suppliers.length === 0 ? "No suppliers yet" : "Who are you ordering from?"
              }
              options={suppliers.map((one) => ({ id: one.id, label: one.name }))}
              hint={
                suppliers.length === 0
                  ? "Add one on the Suppliers tab first — an order has to be with somebody."
                  : undefined
              }
            />

            <label className="block">
              <span className="pos-label">Expected — optional</span>
              <input
                type="date"
                className="pos-field"
                value={expectedOn}
                disabled={frozen}
                onChange={(event) => setExpectedOn(event.target.value)}
              />
              <p className="pos-hint">
                Leave it empty for &ldquo;when he comes&rdquo;, which is most of
                them.
              </p>
            </label>
          </div>

          {/* ---------------- What is being asked for ---------------- */}
          <div>
            <span className="pos-label">What you are ordering</span>
            {frozen ? (
              <ul className="mt-1 space-y-2">
                {(order?.items ?? []).map((line) => (
                  <li
                    key={line.key}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-orchid-100 px-3 py-2.5 text-[0.8125rem]"
                  >
                    <span className="min-w-0 flex-1 truncate text-graphite-900">
                      {line.name}
                    </span>
                    <span className="flex-none tabular-nums text-graphite-500">
                      {line.received.toLocaleString("en-PK")} of{" "}
                      {line.quantity.toLocaleString("en-PK")} in
                      {outstanding(line) > 0 ? (
                        <span className="text-signal-warn">
                          {" "}
                          · {outstanding(line).toLocaleString("en-PK")} to come
                        </span>
                      ) : null}
                    </span>
                    <span className="flex-none font-semibold tabular-nums text-graphite-900">
                      {lineTotalOf(line).toLocaleString("en-PK", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-1">
                <PurchaseLines
                  lines={lines}
                  products={products}
                  onChange={setLines}
                  costLabel="Cost each"
                />
              </div>
            )}
          </div>

          <label className="block">
            <span className="pos-label">Note — optional</span>
            <textarea
              className="pos-field min-h-[4rem] resize-y"
              value={note}
              maxLength={NOTE_MAX}
              disabled={frozen}
              placeholder="Send the 1.5 L, not the 2 L. Ask him for the old rate."
              onChange={(event) => setNote(event.target.value)}
            />
          </label>

          {/* ---------------- Moving it along ---------------- */}
          {order && frozen ? (
            <section className="rounded-2xl border border-orchid-100 p-3.5">
              <h3 className="font-display text-[0.9375rem] font-semibold">
                Close this order
              </h3>
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-graphite-700">
                Use this when the rest is not coming. It stays in the list with
                everything that did arrive against it — nothing is deleted, and
                the shelf keeps what it was given.
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                {order.status !== "closed" ? (
                  <button
                    type="button"
                    onClick={() => move("closed")}
                    className="pos-btn pos-btn-soft pos-btn-sm"
                  >
                    Close it
                  </button>
                ) : null}
                {order.status !== "cancelled" &&
                !order.items.some((line) => line.received > 0) ? (
                  <button
                    type="button"
                    onClick={() => move("cancelled")}
                    className="pos-btn pos-btn-quiet pos-btn-sm"
                  >
                    Cancel it
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}
        </fieldset>

        <footer className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-orchid-100 bg-paper-50 px-4 py-3 sm:px-5">
          {error ? (
            <p className="mr-auto min-w-[8rem] flex-1 text-[0.75rem] leading-snug text-signal-bad">
              {error}
            </p>
          ) : complaint && lines.length > 0 ? (
            <p className="mr-auto min-w-[8rem] flex-1 text-[0.75rem] leading-snug text-graphite-700">
              {complaint}
            </p>
          ) : (
            <p className="mr-auto min-w-[8rem] flex-1 text-[0.8125rem] tabular-nums text-graphite-700">
              {subtotal > 0 ? (
                <>
                  <span className="text-graphite-500">Order comes to </span>
                  <span className="font-display font-bold text-graphite-900">
                    {subtotal.toLocaleString("en-PK", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </>
              ) : null}
            </p>
          )}

          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="pos-btn pos-btn-soft"
          >
            {frozen ? "Close" : "Cancel"}
          </button>

          {frozen ? null : (
            <>
              <button
                type="button"
                onClick={() => submit("draft")}
                disabled={pending || Boolean(complaint)}
                className="pos-btn pos-btn-soft disabled:opacity-60"
              >
                {pending ? "Saving…" : "Save as draft"}
              </button>

              <button
                type="button"
                onClick={() => submit("placed")}
                disabled={pending || Boolean(complaint)}
                className="pos-btn pos-btn-primary disabled:opacity-60"
              >
                <IconCheck className="h-4 w-4" />
                {pending ? "Saving…" : "Place the order"}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
