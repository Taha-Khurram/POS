"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import { IconCheck, IconRegister, IconTrash } from "@/components/pos/icons";
import { RECEIPT_FOOTER_MAX, TENDERS, type Counter } from "@/lib/pos/counter";
import { deleteCounter, saveCounter } from "./actions";
import { IDLE, SaveBar } from "./save-bar";

/**
 * One counter's settings.
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
 * three from the server's own row keeps the whole card telling one story, and
 * it is also what makes this editor safe to reuse — it is one component the URL
 * points at a different counter.
 *
 * The tender pair is also worth guarding on the client. The action refuses an
 * open counter that takes neither — but a cashier finding that out is a cashier
 * with a queue, so the card says it here first.
 */
export function CounterForm({
  counter,
  readOnly,
  deletable,
}: {
  counter: Counter;
  readOnly: boolean;
  /** The last counter standing has no Delete. A shop with none has a register
   *  that cannot open, which is not a state to leave somebody one tap from. */
  deletable: boolean;
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
    <div className="space-y-4">
      <form action={action}>
        {/* The row this form writes to. Checked against the shop's own counters
            inside the action — a crafted id must never reach the update. */}
        <input type="hidden" name="counter_id" value={counter.id} />

        <ChartCard
          title={counter.name}
          caption="Open it, and this counter's register can ring up a sale."
          footer={<SaveBar state={state} pending={pending} readOnly={readOnly} />}
        >
          <fieldset disabled={locked} className="space-y-5">
            {/* The switch, given the whole width and its own surface — it is the
                one control here that decides whether the till can sell. */}
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-orchid-100 bg-orchid-50/60 p-3.5">
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
                      A tablet can pick this counter and bill from it. Scan or
                      search an item, it goes on the bill, and the total prints
                      on an 80 mm roll.
                    </>
                  ) : (
                    <>
                      Shut. No tablet can bill from this counter until you
                      switch it on — which is the state to leave it in until the
                      prices on{" "}
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
                  — the prefix, the trading day, and the sale&rsquo;s place in
                  it. Each counter needs its own or two tills print the same
                  number. The count restarts every morning.
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
                  One line under the total. Leave it empty and the roll is a
                  line shorter on every sale.
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
      </form>

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
          The bill is worked out on the tablet, so a slow connection does not
          slow the sale down. The sale is then recorded against this counter,
          which is what Sales &amp; takings counts at the end of the day.
        </p>
      </section>

      {deletable && !readOnly ? <DeleteCounter counter={counter} /> : null}
    </div>
  );
}

/**
 * Removing a counter.
 *
 * Its own form below the card rather than a button in its footer, because a
 * Delete beside a Save is a Delete somebody eventually presses instead. The
 * action refuses outright once the counter has taken money, and the sentence
 * that comes back names how many sales — which is the number that makes the
 * refusal obvious rather than annoying.
 */
function DeleteCounter({ counter }: { counter: Counter }) {
  const [state, action, pending] = useActionState(deleteCounter, IDLE);
  const [armed, setArmed] = useState(false);

  return (
    <form action={action} className="pos-card p-4">
      <input type="hidden" name="counter_id" value={counter.id} />

      <h2 className="font-display text-[0.9375rem] leading-tight font-semibold">
        Delete this counter
      </h2>
      <p className="mt-1 text-[0.8125rem] leading-relaxed text-graphite-700">
        Only possible while it has never rung up a sale. After that it can be
        shut but not erased — its takings have to stay accounted for.
      </p>

      {state.error ? (
        <p className="mt-3 text-[0.8125rem] leading-relaxed text-signal-bad">
          {state.error}
        </p>
      ) : null}

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        {armed ? (
          <>
            <button
              type="submit"
              disabled={pending}
              className="pos-btn pos-btn-sm bg-signal-bad text-white disabled:opacity-60"
            >
              <IconTrash className="h-4 w-4" />
              {pending ? "Deleting…" : `Yes, delete ${counter.name}`}
            </button>

            <button
              type="button"
              onClick={() => setArmed(false)}
              className="pos-btn pos-btn-quiet pos-btn-sm"
            >
              Keep it
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setArmed(true)}
            className="pos-btn pos-btn-soft pos-btn-sm"
          >
            <IconTrash className="h-4 w-4" />
            Delete counter
          </button>
        )}
      </div>
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
