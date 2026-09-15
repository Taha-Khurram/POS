"use client";

import { useEffect, useRef, useState } from "react";

import { IconCard, IconCash, IconClose } from "@/components/pos/icons";
import {
  changeDue,
  moneyFormatter,
  parseTendered,
  quickTenders,
  tendersOn,
  type Bill,
  type CounterSettings,
  type TenderId,
} from "@/lib/pos/counter";
import type { ShopSettings } from "@/lib/pos/settings-options";

/**
 * Taking the money.
 *
 * Two questions and no more: which way, and — for cash — how much was handed
 * over. Everything else a payment screen usually asks (split tenders, a
 * customer, a discount) is a queue behind a cashier holding a 5,000 note.
 *
 * The cash path is the one that earns its keep. A cashier doing the change in
 * their head is the single most common way a drawer ends the day short, so the
 * amount given is typed in, the quick-tender buttons cover what a customer
 * actually hands over, and the change is worked out in front of both of them.
 *
 * Card is a confirmation, not a transaction: the shop's machine is a separate
 * box on the counter and Flo never sees the authorisation. The button says so.
 */
export function PaymentSheet({
  bill,
  counter,
  settings,
  onClose,
  onTender,
}: {
  bill: Bill;
  counter: CounterSettings;
  settings: ShopSettings;
  onClose: () => void;
  onTender: (tender: TenderId, tendered: number | null, change: number) => void;
}) {
  const money = moneyFormatter(settings);
  const available = tendersOn(counter);

  // Cash first when the counter takes it, because most bills are cash and the
  // default should be the one nobody has to think about.
  const [tender, setTender] = useState<TenderId>(available[0]?.id ?? "cash");
  const [given, setGiven] = useState("");

  const cashRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

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

  // The amount box on cash, the dialog itself on card — there is nothing to
  // type on a card sale, and focusing a field that wants no input only puts a
  // keyboard over the Take payment button on a tablet.
  useEffect(() => {
    if (tender === "cash") cashRef.current?.focus();
    else dialogRef.current?.focus();
  }, [tender]);

  const cash = tender === "cash";
  const tendered = parseTendered(given);

  // An empty box is not a short payment — it is a cashier who has not counted
  // yet, so the button waits rather than accusing them of anything.
  const short = cash && tendered !== null && tendered < bill.total;
  const ready = !cash || (tendered !== null && !short);
  const change = cash && tendered !== null ? changeDue(tendered, bill.total) : 0;

  const settle = () => {
    if (!ready) return;
    onTender(tender, cash ? tendered : null, cash ? change : 0);
  };

  return (
    <div
      className="pos-modal"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Take payment"
        tabIndex={-1}
        className="pos-sheet outline-none"
        onKeyDown={(event) => {
          // Enter settles from anywhere in the dialog — the cashier's hand is on
          // the number pad, not on the button. Anywhere except a button, that
          // is: Enter on "Back to the bill" has to mean Back, not Take cash.
          if (event.key !== "Enter") return;
          if (event.target instanceof HTMLButtonElement) return;

          event.preventDefault();
          settle();
        }}
      >
        <header className="flex items-start gap-3 border-b border-orchid-100 px-4 py-3.5 sm:px-5">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[1rem] leading-tight font-bold">
              Take payment
            </h2>
            <p className="mt-0.5 text-[0.75rem] text-graphite-500">
              {bill.lines} {bill.lines === 1 ? "line" : "lines"} · {bill.units}{" "}
              units
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

        <div className="space-y-5 px-4 py-5 sm:px-5">
          {/* The figure everything else on this screen is measured against,
              set as large as the card allows. */}
          <p className="rounded-2xl bg-orchid-50 px-4 py-3.5 text-center">
            <span className="block text-[0.75rem] font-medium text-graphite-500">
              Amount due
            </span>
            <span className="mt-1 block font-display text-[2rem] leading-none font-bold tracking-tight tabular-nums text-orchid-800">
              {money(bill.total)}
            </span>
          </p>

          {/* ---- Which way ---- */}
          <div role="radiogroup" aria-label="Payment method">
            <span className="pos-label">Paying by</span>

            <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
              {available.map((option) => {
                const Icon = option.id === "cash" ? IconCash : IconCard;
                const on = option.id === tender;

                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setTender(option.id)}
                    className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors ${
                      on
                        ? "border-orchid-700 bg-orchid-50"
                        : "border-orchid-100 hover:border-orchid-300"
                    }`}
                  >
                    <Icon
                      className={`mt-0.5 h-4 w-4 flex-none ${on ? "text-orchid-800" : "text-graphite-500"}`}
                    />

                    <span className="min-w-0">
                      <span className="block font-display text-[0.875rem] font-semibold text-graphite-900">
                        {option.label}
                      </span>
                      <span className="mt-0.5 block text-[0.75rem] leading-relaxed text-graphite-500">
                        {option.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ---- How much ---- */}
          {cash ? (
            <div>
              <label className="block">
                <span className="pos-label">Cash given</span>
                <input
                  ref={cashRef}
                  className="pos-field text-right text-[1.125rem] font-semibold tabular-nums"
                  value={given}
                  onChange={(event) => setGiven(event.target.value)}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  aria-describedby="change-due"
                />
              </label>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {quickTenders(bill.total).map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    onClick={() => setGiven(String(amount))}
                    className="pos-btn pos-btn-soft pos-btn-sm tabular-nums"
                  >
                    {amount === bill.total ? "Exact" : money(amount)}
                  </button>
                ))}
              </div>

              <p
                id="change-due"
                aria-live="polite"
                className="mt-3 flex items-baseline justify-between gap-2 border-t border-orchid-100 pt-3 text-[0.9375rem]"
              >
                {short ? (
                  <>
                    <span className="text-graphite-700">Still owed</span>
                    <span className="font-display font-bold tabular-nums text-signal-bad">
                      {money(bill.total - (tendered ?? 0))}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-graphite-700">Change</span>
                    <span className="font-display text-[1.25rem] font-bold tabular-nums text-graphite-900">
                      {money(change)}
                    </span>
                  </>
                )}
              </p>
            </div>
          ) : (
            <p className="rounded-xl border border-orchid-100 p-3 text-[0.8125rem] leading-relaxed text-graphite-700">
              Swipe or tap it on the shop&rsquo;s own card machine first. Flo
              never sees the approval, so this button only records that the bill
              was settled by card — press it once the machine says approved.
            </p>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-orchid-100 px-4 py-3 sm:px-5">
          <button type="button" onClick={onClose} className="pos-btn pos-btn-soft">
            Back to the bill
          </button>

          <button
            type="button"
            onClick={settle}
            disabled={!ready}
            className="pos-btn pos-btn-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cash ? "Take cash" : "Card approved"} · {money(bill.total)}
          </button>
        </footer>
      </div>
    </div>
  );
}
