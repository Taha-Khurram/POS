"use client";

import { useEffect, useMemo, useState } from "react";

import { IconAlert, IconCard, IconCash, IconClose, IconReturn } from "@/components/pos/icons";
import { useToast } from "@/components/pos/toaster";
import { unitShort, type UnitId } from "@/lib/pos/catalog";
import {
  moneyFormatter,
  newSaleId,
  parseQuantity,
  round2,
  round3,
  tendersOn,
  type Counter,
  type TenderId,
} from "@/lib/pos/counter";
import { returnable, type BillDetail, type BillLine } from "@/lib/pos/history";
import type { ShopSettings } from "@/lib/pos/settings-options";
import { recordReturn } from "./actions";

/**
 * Taking a return.
 *
 * Every shop takes returns and until now the only way to take one was to open
 * the drawer and hand the money back, which leaves the takings over by the
 * refund, the shelf under by whatever came back, and the month's margin on that
 * item a fiction. This screen is the whole of the fix, and it is built around
 * what actually happens at a counter: a customer arrives with a receipt and one
 * of the four things on it.
 *
 * So it opens with the bill's own lines and nothing at zero-by-default — the
 * cashier says how many of what, and the sheet works out the money. Partial is
 * the normal case, not the exception.
 *
 * **What is refunded is what was paid.** A line on a haggled bill is refunded
 * at the price after the discount, never at the shelf price, because refunding
 * `unit_price` on a discounted bill hands back more than was taken. The figure
 * on screen comes off `line_total / quantity`, and `record_return` works the
 * same figure out again under a lock — the screen is the estimate and the
 * transaction is the truth.
 *
 * **A line can only come back once.** How much of each line has already been
 * returned is read with the bill, and the stepper caps on the remainder. The
 * function re-derives that cap inside the transaction with the original's lines
 * locked, which is what stops two tablets refunding the last unsold unit at the
 * same moment.
 *
 * **The stock only goes back if the shopkeeper says so.** A sealed packet goes
 * on the shelf; a burst bag of atta does not, and restocking it would build a
 * count that is wrong in exactly the cases somebody would notice. Asked once,
 * defaulted to yes because most returns are re-sellable, and never assumed.
 */
export function ReturnSheet({
  detail,
  counter,
  settings,
  onClose,
  onDone,
}: {
  detail: BillDetail;
  /** The counter the money leaves from — this device's till. The refund takes
   *  a number out of its series and comes out of its drawer, so it has to be a
   *  real open counter and not whichever one rang the original up a week ago. */
  counter: Counter;
  settings: ShopSettings;
  onClose: () => void;
  /** Handed the refund's receipt number so the drawer can print the roll. */
  onDone: (result: { receiptNo: string; refunded: number; lines: RefundLine[] }) => void;
}) {
  const money = moneyFormatter(settings);
  const toast = useToast();

  // Which of the bill's lines still have anything on them to give back. A line
  // already returned in full is shown, greyed, rather than hidden — a customer
  // holding the receipt can see all four items on it, and a line that silently
  // vanished reads as a bill that has been edited.
  const lines = detail.lines;

  const [taking, setTaking] = useState<Record<string, number>>({});
  const [tender, setTender] = useState<TenderId>(
    tendersOn(counter)[0]?.id ?? "cash",
  );
  const [restock, setRestock] = useState(true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // Minted once, on the tablet, so a retry after a dropped connection replays
  // rather than handing the customer their money a second time.
  const [returnId] = useState(newSaleId);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, busy]);

  const chosen = useMemo(
    () =>
      lines
        .map((line) => ({ line, quantity: taking[line.id] ?? 0 }))
        .filter((entry) => entry.quantity > 0)
        .map((entry) => ({
          ...entry,
          amount: refundOf(entry.line, entry.quantity),
        })),
    [lines, taking],
  );

  const total = round2(chosen.reduce((sum, entry) => sum + entry.amount, 0));
  const ready = chosen.length > 0 && !busy;

  const set = (line: BillLine, value: number) =>
    setTaking((previous) => ({
      ...previous,
      [line.id]: Math.max(0, Math.min(returnable(line), round3(value))),
    }));

  const settle = async () => {
    if (!ready) return;

    setBusy(true);
    setFailure(null);

    const result = await recordReturn({
      returnId,
      saleId: detail.id,
      counterId: counter.id,
      lines: chosen.map((entry) => ({
        lineId: entry.line.id,
        quantity: entry.quantity,
      })),
      tender,
      restock,
      note,
    }).catch(() => ({
      ok: false as const,
      error:
        "We could not reach Flo to record this return. Check the connection and try again — do not hand the money back until it saves.",
    }));

    setBusy(false);

    if (!result.ok) {
      setFailure(result.error);
      return;
    }

    toast({
      title: `Refunded ${money(result.refunded)}`,
      detail: restock
        ? "Back on the shelf and out of today's takings."
        : "Out of today's takings. The stock was not put back.",
      tone: "good",
    });

    onDone({
      receiptNo: result.receiptNo,
      refunded: result.refunded,
      lines: chosen.map((entry) => ({
        name: entry.line.name,
        unit: entry.line.unit,
        quantity: entry.quantity,
        unitPrice: entry.line.unitPrice,
        amount: entry.amount,
      })),
    });
  };

  return (
    <div
      className="pos-modal"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Return against ${detail.receiptNo}`}
        className="pos-sheet outline-none"
      >
        <header className="flex items-start gap-3 border-b border-orchid-100 px-4 py-3.5 sm:px-5">
          <span className="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-xl bg-orchid-100 text-orchid-800">
            <IconReturn className="h-[18px] w-[18px]" />
          </span>

          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[1rem] leading-tight font-bold">
              Take a return
            </h2>
            <p className="mt-0.5 text-[0.75rem] text-graphite-500">
              Against <span className="font-mono">{detail.receiptNo}</span> ·
              money out of {counter.name}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="pos-icon-btn -mr-1.5 flex-none disabled:opacity-50"
            aria-label="Close"
          >
            <IconClose className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 px-4 py-4 sm:px-5">
          {/* ---- What is coming back ---- */}
          <div className="overflow-hidden rounded-xl border border-orchid-100">
            <table className="pos-table">
              <thead>
                <tr>
                  <th>On the bill</th>
                  <th className="text-right">Coming back</th>
                  <th className="text-right">Refund</th>
                </tr>
              </thead>

              <tbody>
                {lines.map((line) => {
                  const left = returnable(line);
                  const quantity = taking[line.id] ?? 0;

                  return (
                    <tr key={line.id} className={left === 0 ? "opacity-55" : undefined}>
                      <td className="whitespace-normal">
                        <span className="block font-medium text-graphite-900">
                          {line.name}
                        </span>
                        <span className="mt-0.5 block text-[0.75rem] text-graphite-500">
                          {line.quantity.toLocaleString("en-PK", {
                            maximumFractionDigits: 3,
                          })}{" "}
                          {short(line.unit)} sold at {money(unitPaid(line))}
                          {/* The price after any discount, and said so, because
                              it is not the figure printed beside the line on
                              the original roll and a cashier would otherwise
                              read the difference as a mistake. */}
                          {line.unitPrice !== unitPaid(line) ? (
                            <span className="text-graphite-500">
                              {" "}
                              (after the discount)
                            </span>
                          ) : null}
                          {line.returned > 0 ? (
                            <span className="ml-1 text-signal-warn">
                              ·{" "}
                              {line.returned.toLocaleString("en-PK", {
                                maximumFractionDigits: 3,
                              })}{" "}
                              already back
                            </span>
                          ) : null}
                        </span>
                      </td>

                      <td>
                        {left === 0 ? (
                          <span className="block text-right text-[0.75rem] text-graphite-500">
                            All returned
                          </span>
                        ) : (
                          <div className="flex items-center justify-end gap-1.5">
                            <input
                              className="pos-field pos-qty"
                              inputMode="decimal"
                              value={quantity === 0 ? "" : String(quantity)}
                              placeholder="0"
                              onChange={(event) => {
                                const parsed = parseQuantity(
                                  event.target.value,
                                  !Number.isInteger(left) || isLoose(line.unit),
                                );
                                set(line, event.target.value.trim() === "" ? 0 : parsed ?? quantity);
                              }}
                              onFocus={(event) => event.target.select()}
                              aria-label={`How many ${line.name} are coming back`}
                            />

                            {/* The whole line, which is what most returns are.
                                One tap rather than typing the number that is
                                already printed two columns to the left. */}
                            <button
                              type="button"
                              onClick={() => set(line, quantity === left ? 0 : left)}
                              className={`pos-btn pos-btn-sm ${quantity === left ? "pos-btn-primary" : "pos-btn-quiet"}`}
                            >
                              All {left.toLocaleString("en-PK", { maximumFractionDigits: 3 })}
                            </button>
                          </div>
                        )}
                      </td>

                      <td className="pos-num font-medium">
                        {quantity > 0 ? money(refundOf(line, quantity)) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ---- Does it go back on the shelf ---- */}
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-orchid-100 bg-orchid-50/60 p-3.5">
            <input
              type="checkbox"
              checked={restock}
              onChange={(event) => setRestock(event.target.checked)}
              className="mt-0.5 h-4 w-4 flex-none accent-orchid-700"
            />

            <span className="min-w-0">
              <span className="block font-display text-[0.875rem] font-semibold text-graphite-900">
                Put it back on the shelf
              </span>
              <span className="mt-1 block text-[0.8125rem] leading-relaxed text-graphite-700">
                {restock
                  ? "The stock count goes back up, and the ledger records why."
                  : "The count stays where it is — right for anything damaged, opened or past its date. The money still goes back."}
              </span>
            </span>
          </label>

          {/* ---- How the money goes back ---- */}
          <div role="radiogroup" aria-label="How the money goes back">
            <span className="pos-label">Giving back by</span>

            <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
              {tendersOn(counter).map((option) => {
                const Icon = option.id === "cash" ? IconCash : IconCard;
                const on = option.id === tender;

                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setTender(option.id)}
                    className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition-colors ${
                      on
                        ? "border-orchid-700 bg-orchid-50"
                        : "border-orchid-100 hover:border-orchid-300"
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 flex-none ${on ? "text-orchid-800" : "text-graphite-500"}`}
                    />
                    <span className="font-display text-[0.875rem] font-semibold text-graphite-900">
                      {option.id === "cash" ? "Cash out of the drawer" : "Back on the card"}
                    </span>
                  </button>
                );
              })}
            </div>

            {tender === "card" ? (
              <p className="mt-2 text-[0.75rem] leading-relaxed text-graphite-500">
                Reverse it on the shop&rsquo;s own card machine first. Flo never
                sees the reversal — this only records that the money went back
                that way.
              </p>
            ) : null}
          </div>

          <label className="block">
            <span className="pos-label">Why it came back</span>
            <input
              className="pos-field"
              value={note}
              onChange={(event) => setNote(event.target.value.slice(0, 200))}
              placeholder="Wrong size, leaking, changed their mind…"
              autoComplete="off"
            />
            <p className="pos-hint">
              Optional, and worth a few words: one supplier&rsquo;s stock coming
              back three times in a month is a pattern nobody spots without it.
            </p>
          </label>

          {failure ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-signal-bad/40 bg-signal-bad/5 p-3 text-[0.8125rem] leading-relaxed text-graphite-700"
            >
              <IconAlert className="mt-0.5 h-4 w-4 flex-none text-signal-bad" />
              {failure}
            </p>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-orchid-100 px-4 py-3 sm:px-5">
          <p className="text-[0.8125rem]">
            <span className="text-graphite-500">Giving back</span>{" "}
            <span className="font-display text-[1.25rem] font-bold tabular-nums text-orchid-800">
              {money(total)}
            </span>
          </p>

          <div className="ms-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="pos-btn pos-btn-quiet disabled:opacity-60"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={() => void settle()}
              disabled={!ready}
              className="pos-btn pos-btn-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy
                ? "Recording…"
                : failure
                  ? `Try again · ${money(total)}`
                  : `Give back ${money(total)}`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/** What the roll needs to print a refund, handed up so the drawer can show it
 *  the moment the write lands rather than re-reading the bill. */
export type RefundLine = {
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

/**
 * What one of them actually cost the customer.
 *
 * `line_total / quantity`, not `unit_price`: on a haggled bill the line carries
 * its share of the discount, and refunding the shelf price would hand back more
 * than was taken. `record_return` works out the same figure under a lock, so
 * this is the estimate the cashier reads and that one is what is recorded.
 */
const unitPaid = (line: BillLine) =>
  line.quantity === 0 ? 0 : round2(line.lineTotal / line.quantity);

const refundOf = (line: BillLine, quantity: number) =>
  line.quantity === 0 ? 0 : round2((line.lineTotal / line.quantity) * quantity);

/** 0008's spelling for a kilogram is still valid in the column. One name here. */
const short = (unit: string) => unitShort((unit === "kilo" ? "kg" : unit) as UnitId);

/** Whether half of one can come back. Anything off a scale can; two thirds of
 *  a bottle of Coke cannot. */
const isLoose = (unit: string) =>
  ["kg", "kilo", "gram", "litre"].includes(unit);
