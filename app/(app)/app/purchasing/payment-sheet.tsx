"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { IconCash, IconCheck, IconClose } from "@/components/pos/icons";
import { SelectRow } from "@/components/pos/select-field";
import { useActionToast } from "@/components/pos/toaster";
import {
  balanceState,
  checkPayment,
  NOTE_MAX,
  PAYMENT_METHODS,
  REFERENCE_MAX,
  type SupplierBalance,
} from "@/lib/pos/ledger";
import { savePayment } from "./payment-actions";
import { IDLE } from "./state";

/**
 * Money paid to a supplier.
 *
 * Short, and the shortest of the four sheets in Buying, because the thing it
 * replaces is one line in a register book: who, how much, when, and the cheque
 * number if there was one.
 *
 * **It shows what is owed while the amount is being typed, and what will be
 * left afterwards.** That is the whole reason to type it here rather than on
 * paper — a shopkeeper settling with a distributor's man at the door wants to
 * know whether fifty thousand clears the account or leaves eight, and working
 * it out in their head while somebody waits is exactly when it goes wrong.
 *
 * There is no "pay it all" shortcut that fills the box with the balance. It
 * would be right most of the time and silently wrong the rest — a part payment
 * typed over a prefilled full one is how somebody pays more than they meant.
 * The balance is shown, and the number is typed.
 */
export function PaymentSheet({
  suppliers,
  balances,
  /** Preselected when the sheet is opened from a supplier's own record. */
  supplierId: initialSupplier = "",
  today,
  money,
  onClose,
}: {
  suppliers: { id: string; name: string }[];
  balances: Map<string, SupplierBalance>;
  supplierId?: string;
  /** The shop's own trading day, resolved on the server — the browser never
   *  decides what day it is, the same rule the till and the history follow. */
  today: string;
  money: (value: number) => string;
  onClose: () => void;
}) {
  const amountRef = useRef<HTMLInputElement>(null);

  const [state, action, pending] = useActionState(savePayment, IDLE);

  useActionToast(state, {
    saved: `Payment to ${state.saved?.name ?? "supplier"} recorded`,
    failed: "That payment was not recorded",
  });

  const [supplierId, setSupplierId] = useState(initialSupplier);
  const [paidOn, setPaidOn] = useState(today);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    amountRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const settled = useRef<number | null>(null);

  useEffect(() => {
    if (!state.savedAt || state.savedAt === settled.current) return;
    settled.current = state.savedAt;
    onClose();
  }, [state.savedAt, onClose]);

  const paid = (() => {
    const value = Number(amount.replace(/[,\s]/g, ""));
    return Number.isFinite(value) ? value : 0;
  })();

  const balance = supplierId ? balances.get(supplierId) : undefined;
  const owed = balance?.balance ?? 0;
  const after = Math.round((owed - paid) * 100) / 100;

  const complaint = checkPayment({
    supplierId,
    paidOn,
    amount: paid,
    method,
    reference,
    note,
  });

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
        aria-label="Record a payment"
        tabIndex={-1}
        className="pos-sheet outline-none"
      >
        <form action={action}>
          <input type="hidden" name="supplier_id" value={supplierId} />
          <input type="hidden" name="method" value={method} />

          <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-orchid-100 bg-paper-50 px-4 py-3.5 sm:px-5">
            <span className="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-xl bg-orchid-200 text-orchid-800">
              <IconCash className="h-[18px] w-[18px]" />
            </span>

            <div className="min-w-0 flex-1">
              <h2 className="font-display text-[1rem] leading-tight font-bold">
                Record a payment
              </h2>
              <p className="mt-0.5 truncate text-[0.75rem] text-graphite-500">
                Against the account, not against one delivery.
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
            <SelectRow
              label="Who you paid"
              value={supplierId}
              onChange={setSupplierId}
              disabled={suppliers.length === 0}
              placeholder={
                suppliers.length === 0 ? "No suppliers yet" : "Pick the supplier"
              }
              options={suppliers.map((one) => ({
                id: one.id,
                label: one.name,
                // The balance rides in the picker, so somebody settling three
                // distributors in one visit does not have to open each record
                // to see which one is owed what.
                meta: (() => {
                  const value = balances.get(one.id)?.balance ?? 0;
                  return balanceState(value) === "clear" ? undefined : money(value);
                })(),
              }))}
            />

            {/* What the account stands at, and what this leaves. The reason the
                sheet exists rather than a line in a book. */}
            {balance ? (
              <div className="rounded-2xl border border-orchid-100 bg-orchid-50/60 px-3.5 py-3 text-[0.8125rem]">
                <p className="flex items-center justify-between">
                  <span className="text-graphite-500">Owed now</span>
                  <span className="font-display font-bold tabular-nums text-graphite-900">
                    {money(owed)}
                  </span>
                </p>

                {paid > 0 ? (
                  <p className="mt-1.5 flex items-center justify-between border-t border-orchid-100 pt-1.5">
                    <span className="text-graphite-500">
                      {after > 0.005
                        ? "Still owed after this"
                        : after < -0.005
                          ? "In advance after this"
                          : "Account clear after this"}
                    </span>
                    <span
                      className={`font-display font-bold tabular-nums ${
                        after > 0.005 ? "text-graphite-900" : "text-signal-good"
                      }`}
                    >
                      {money(Math.abs(after))}
                    </span>
                  </p>
                ) : null}

                {balance.openingOn ? null : balance.deliveries === 0 ? (
                  <p className="mt-1.5 text-[0.75rem] leading-snug text-graphite-500">
                    No deliveries recorded against them yet, and no opening
                    balance set — so this will put the account in advance.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="pos-label">How much</span>
                <input
                  ref={amountRef}
                  name="amount"
                  className="pos-field text-right font-display text-[1.125rem] font-bold tabular-nums"
                  inputMode="decimal"
                  value={amount}
                  placeholder="0"
                  autoComplete="off"
                  onChange={(event) => setAmount(event.target.value)}
                />
              </label>

              <label className="block">
                <span className="pos-label">Day it left</span>
                <input
                  name="paid_on"
                  type="date"
                  className="pos-field"
                  value={paidOn}
                  onChange={(event) => setPaidOn(event.target.value)}
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <SelectRow
                label="How you paid"
                value={method}
                onChange={setMethod}
                options={PAYMENT_METHODS.map((entry) => ({
                  id: entry.id,
                  label: entry.label,
                  description: entry.note,
                }))}
              />

              <label className="block">
                <span className="pos-label">Reference — optional</span>
                <input
                  name="reference"
                  className="pos-field font-mono"
                  value={reference}
                  maxLength={REFERENCE_MAX}
                  autoComplete="off"
                  placeholder="Cheque no., TID, transfer id"
                  onChange={(event) => setReference(event.target.value)}
                />
                <p className="pos-hint">
                  What you quote if he says he never received it.
                </p>
              </label>
            </div>

            <label className="block">
              <span className="pos-label">Note — optional</span>
              <textarea
                name="note"
                className="pos-field min-h-[4rem] resize-y"
                value={note}
                maxLength={NOTE_MAX}
                placeholder="Part payment. He is coming back for the rest after Eid."
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
          </fieldset>

          <footer className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-orchid-100 bg-paper-50 px-4 py-3 sm:px-5">
            {state.error ? (
              <p className="mr-auto min-w-[8rem] flex-1 text-[0.75rem] leading-snug text-signal-bad">
                {state.error}
              </p>
            ) : complaint && (supplierId || amount) ? (
              <p className="mr-auto min-w-[8rem] flex-1 text-[0.75rem] leading-snug text-graphite-700">
                {complaint}
              </p>
            ) : null}

            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="pos-btn pos-btn-soft"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={pending || Boolean(complaint)}
              className="pos-btn pos-btn-primary disabled:opacity-60"
            >
              <IconCheck className="h-4 w-4" />
              {pending ? "Recording…" : "Record the payment"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
