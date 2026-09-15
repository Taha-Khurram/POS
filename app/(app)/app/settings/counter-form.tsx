"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import { IconCheck, IconRegister } from "@/components/pos/icons";
import {
  RECEIPT_FOOTER_MAX,
  TENDERS,
  type CounterSettings,
} from "@/lib/pos/counter";
import { saveCounter } from "./actions";
import { IDLE, SaveBar } from "./save-bar";

/**
 * The counter switch, and what the register does once it is on.
 *
 * Three controlled values in an otherwise uncontrolled form — the switch and
 * the two tenders — because the copy beside them reads back what they mean, and
 * a sentence that only catches up after a save is a sentence nobody trusts.
 * Everything else is `defaultValue`, the same as the other three cards.
 *
 * That split is why the sync below exists. React resets an uncontrolled field
 * to its `defaultValue` once a form action settles, but it cannot reset a value
 * held in `useState` — so after a save the text fields follow the row that came
 * back and the checkboxes would follow whatever was last clicked. They agree
 * when the save succeeds and disagree the moment it is refused: the name snaps
 * back to what is stored while the switch still reads open. Re-seeding the
 * three from the server's own row keeps the whole card telling one story.
 *
 * The tender pair is also worth guarding on the client. The action refuses an
 * open counter that takes neither — but a cashier finding that out is a cashier
 * with a queue, so the card says it here first.
 */
export function CounterForm({
  counter,
  readOnly,
}: {
  counter: CounterSettings;
  readOnly: boolean;
}) {
  const [state, action, pending] = useActionState(saveCounter, IDLE);
  const locked = readOnly || pending;

  const [open, setOpen] = useState(counter.isActive);
  const [cash, setCash] = useState(counter.acceptsCash);
  const [card, setCard] = useState(counter.acceptsCard);

  // Re-seed from the row the server just sent, the way React documents
  // adjusting state when a prop changes: set it during the render rather than
  // in an effect, so the card never paints one frame of the old answer.
  const [seed, setSeed] = useState(counter);

  if (seed !== counter) {
    setSeed(counter);
    setOpen(counter.isActive);
    setCash(counter.acceptsCash);
    setCard(counter.acceptsCard);
  }

  const noTender = open && !cash && !card;

  return (
    <form action={action} className="space-y-4">
      <ChartCard
        title="The counter"
        caption="Open it, and the register can ring up a sale."
        footer={<SaveBar state={state} pending={pending} readOnly={readOnly} />}
      >
        <fieldset disabled={locked} className="space-y-5">
          {/* The switch, given the whole width and its own surface — it is the
              one control on this tab that changes whether the shop can sell. */}
          <label
            className="flex cursor-pointer items-start gap-3 rounded-2xl border border-orchid-100 bg-orchid-50/60 p-3.5">
            <input
              type="checkbox"
              name="is_active"
              checked={open}
              onChange={(event) => setOpen(event.target.checked)}
              className="mt-0.5 h-4 w-4 flex-none accent-orchid-700"
            />

            <span className="min-w-0">
              <span className="flex items-center gap-2 font-display text-[0.875rem] font-semibold text-graphite-900">
                <IconRegister className="h-4 w-4 text-orchid-700" />
                Counter is open
              </span>

              <span className="mt-1 block text-[0.8125rem] leading-relaxed text-graphite-700">
                {open ? (
                  <>
                    The register bills. Scan or search an item, it goes on the
                    bill, and the total prints on an 80 mm roll.
                  </>
                ) : (
                  <>
                    The register is shut. Nobody can ring up a sale until you
                    switch this on — which is the state a shop should be in
                    until the prices on{" "}
                    <Link
                      href="/app/inventory"
                      className="font-medium text-orchid-800 underline underline-offset-2"
                    >
                      Products &amp; stock
                    </Link>{" "}
                    are right.
                  </>
                )}
              </span>
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="pos-label">Counter name</span>
              <input
                name="name"
                className="pos-field"
                defaultValue={counter.name}
                maxLength={40}
                required
              />
              <p className="pos-hint">
                Printed on the receipt, so the till a bill came off is never a
                guess. &ldquo;Front counter&rdquo;, &ldquo;Takeaway&rdquo;.
              </p>
            </label>

            <label className="block">
              <span className="pos-label">Receipt prefix</span>
              <input
                name="receipt_prefix"
                className="pos-field font-mono tracking-[0.08em] uppercase"
                defaultValue={counter.receiptPrefix}
                maxLength={8}
                pattern="[A-Za-z0-9][A-Za-z0-9-]{0,7}"
                autoCapitalize="characters"
                autoComplete="off"
                required
              />
              <p className="pos-hint">
                Bills run{" "}
                <span className="font-mono text-graphite-700">
                  {counter.receiptPrefix}-YYMMDD-0042
                </span>{" "}
                — the prefix, the day, and the sale&rsquo;s place in it. The
                count restarts every morning.
              </p>
            </label>
          </div>

          {/* ---- What it can take ---- */}
          <div>
            <span className="pos-label">The counter takes</span>

            <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
              {TENDERS.map((tender) => {
                const on = tender.id === "cash" ? cash : card;
                const set = tender.id === "cash" ? setCash : setCard;

                return (
                  <label
                    key={tender.id}
                    className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-orchid-100 p-3"
                  >
                    <input
                      type="checkbox"
                      name={`accepts_${tender.id}`}
                      checked={on}
                      onChange={(event) => set(event.target.checked)}
                      className="mt-0.5 h-4 w-4 flex-none accent-orchid-700"
                    />

                    <span className="min-w-0">
                      <span className="block text-[0.875rem] font-medium text-graphite-900">
                        {tender.label}
                      </span>
                      <span className="mt-0.5 block text-[0.75rem] leading-relaxed text-graphite-500">
                        {tender.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>

            <p className="pos-hint">
              {noTender ? (
                <span className="font-medium text-signal-bad">
                  An open counter has to take cash, card, or both — otherwise
                  the register has a Charge button that cannot finish a sale.
                </span>
              ) : (
                <>
                  Raast, Easypaisa, JazzCash and udhaar are not here yet. A
                  button that cannot settle is worse than no button.
                </>
              )}
            </p>
          </div>

          {/* ---- The roll ---- */}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="pos-label">Footer line</span>
              <input
                name="receipt_footer"
                className="pos-field"
                defaultValue={counter.receiptFooter ?? ""}
                maxLength={RECEIPT_FOOTER_MAX}
                placeholder="Exchange within 7 days with the receipt"
              />
              <p className="pos-hint">
                One line under the total. Leave it empty and the roll is a line
                shorter on every sale.
              </p>
            </label>

            <label className="flex cursor-pointer items-start gap-2.5 self-start rounded-xl border border-orchid-100 p-3 sm:mt-[1.625rem]">
              <input
                type="checkbox"
                name="auto_print"
                defaultChecked={counter.autoPrint}
                className="mt-0.5 h-4 w-4 flex-none accent-orchid-700"
              />

              <span className="min-w-0">
                <span className="block text-[0.875rem] font-medium text-graphite-900">
                  Print as soon as the sale is tendered
                </span>
                <span className="mt-0.5 block text-[0.75rem] leading-relaxed text-graphite-500">
                  A dhaba at dinner wants this. A cloth house billing once an
                  hour would rather press Print itself.
                </span>
              </span>
            </label>
          </div>
        </fieldset>
      </ChartCard>

      {/* What the register will actually do, in the order it does it. Here
          rather than on the register itself because this is the screen where
          somebody decides whether to switch it on. */}
      <section className="pos-card p-4">
        <h2 className="font-display text-[0.9375rem] leading-tight font-semibold">
          What the cashier gets
        </h2>

        <ol className="mt-3 space-y-2.5">
          {STEPS.map((step, index) => (
            <li key={step} className="flex gap-2.5 text-[0.875rem] leading-relaxed">
              <span className="pos-stamp mt-0.5 h-5 w-5 rounded-md text-[0.625rem]">
                {index + 1}
              </span>
              <span className="text-graphite-700">{step}</span>
            </li>
          ))}
        </ol>

        <p className="mt-4 flex items-start gap-2 border-t border-orchid-100 pt-3.5 text-[0.75rem] leading-relaxed text-graphite-500">
          <IconCheck className="mt-0.5 h-3.5 w-3.5 flex-none text-signal-good" />
          The bill is worked out on the tablet, so a dead connection does not
          stop a sale. Receipts are not written to sales history yet — that
          arrives with the offline sync in Part 4.
        </p>
      </section>
    </form>
  );
}

const STEPS = [
  "Scan the barcode with a USB scanner or the tablet camera, or type a name, Urdu name, SKU or code into the search box.",
  "The item lands on the bill. Scan it twice and the quantity goes to 2; anything sold off a scale takes a weight instead.",
  "The register totals the bill as it goes, and shows the sales tax already inside it.",
  "Charge takes cash — with the change worked out from what the customer handed over — or card.",
  "The receipt prints with every line, the total, and how it was paid.",
];
