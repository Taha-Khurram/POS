import Link from "next/link";

import { IconAlert, IconChevron, IconPlus, IconRegister } from "@/components/pos/icons";
import { tendersOn, type Counter } from "@/lib/pos/counter";
import { addCounter } from "./actions";
import { CounterForm } from "./counter-form";

/**
 * The shop's counters.
 *
 * A list, or one counter's settings — which of the two lives in the URL, the
 * same way the tab above it does. The page stays a server component, the owner
 * can send "go and fix counter 2" as a link, and a tablet that lost the network
 * mid-tap comes back to the same screen.
 *
 * Adding is a plain Server Action behind a button rather than a form with
 * fields, because everything a new counter needs it can work out for itself —
 * the owner's actual first act is renaming it, which is what the editor opens
 * on.
 */
export function CountersPanel({
  counters,
  selected,
  maxRegisters,
  atLimit,
  readOnly,
}: {
  counters: Counter[];
  /** The counter being edited, if the URL names one of the shop's own. */
  selected: Counter | null;
  maxRegisters: number;
  /** The owner pressed Add with no room left, and came back with `?full=1`. */
  atLimit: boolean;
  readOnly: boolean;
}) {
  if (selected) {
    return (
      <div className="space-y-4">
        <Link
          href="/app/settings?tab=counter"
          className="pos-btn pos-btn-quiet pos-btn-sm"
          scroll={false}
        >
          <IconChevron className="h-4 w-4 rotate-90" />
          All counters
        </Link>

        <CounterForm
          counter={selected}
          readOnly={readOnly}
          deletable={counters.length > 1}
        />
      </div>
    );
  }

  const room = maxRegisters - counters.length;

  return (
    <div className="space-y-4">
      <section className="pos-card">
        <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 pt-4 pb-3">
          <div className="min-w-0">
            <h2 className="font-display text-[0.9375rem] leading-tight font-semibold">
              Counters
            </h2>
            <p className="mt-0.5 text-[0.75rem] text-graphite-500">
              {counters.length} of {maxRegisters} on your plan. Each one has its
              own register, its own receipt series, and its own day-end total.
            </p>
          </div>

          {!readOnly && room > 0 ? (
            <form action={addCounter}>
              <button type="submit" className="pos-btn pos-btn-primary">
                <IconPlus className="h-4 w-4" />
                Add counter
              </button>
            </form>
          ) : null}
        </header>

        {counters.length === 0 ? (
          <p className="px-4 pb-5 text-[0.875rem] leading-relaxed text-graphite-700">
            No counters yet. Add one and the register can start billing —
            nothing else on this screen matters until then.
          </p>
        ) : (
          <ul className="divide-y divide-orchid-100 border-t border-orchid-100">
            {counters.map((counter) => (
              <li key={counter.id}>
                <Link
                  href={`/app/settings?tab=counter&counter=${counter.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-orchid-50"
                  scroll={false}
                >
                  <span
                    className={`grid h-9 w-9 flex-none place-items-center rounded-xl ${
                      counter.isActive
                        ? "bg-orchid-200 text-orchid-800"
                        : "bg-orchid-50 text-graphite-500"
                    }`}
                  >
                    <IconRegister className="h-[18px] w-[18px]" />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-graphite-900">
                        {counter.name}
                      </span>
                      <span
                        className={`pos-badge ${counter.isActive ? "pos-badge-good" : "pos-badge-info"}`}
                      >
                        {counter.isActive ? "Open" : "Shut"}
                      </span>
                    </span>

                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.75rem] text-graphite-500">
                      <span className="font-mono">{counter.receiptPrefix}</span>
                      <span aria-hidden>·</span>
                      <span>
                        {tendersOn(counter)
                          .map((tender) => tender.label)
                          .join(" and ") || "Takes nothing"}
                      </span>

                      {counter.lastReceiptNo ? (
                        <>
                          <span aria-hidden>·</span>
                          <span className="font-mono">
                            last {counter.lastReceiptNo}
                          </span>
                        </>
                      ) : null}
                    </span>
                  </span>

                  <IconChevron className="h-4 w-4 flex-none -rotate-90 text-graphite-500" />
                </Link>
              </li>
            ))}
          </ul>
        )}

        {atLimit || room <= 0 ? (
          <p className="flex items-start gap-2 border-t border-orchid-100 px-4 py-3 text-[0.75rem] leading-relaxed text-graphite-500">
            <IconAlert className="mt-0.5 h-3.5 w-3.5 flex-none text-signal-warn" />
            Your plan covers {maxRegisters}{" "}
            {maxRegisters === 1 ? "counter" : "counters"}. Message us on the same
            WhatsApp number you arranged Flo on and we will move you up.
          </p>
        ) : null}
      </section>

      <section className="pos-card p-4">
        <h2 className="font-display text-[0.9375rem] leading-tight font-semibold">
          How a second counter works
        </h2>

        <ul className="mt-3 space-y-2.5">
          {NOTES.map((note) => (
            <li key={note} className="flex gap-2.5 text-[0.875rem] leading-relaxed">
              <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-orchid-300" />
              <span className="text-graphite-700">{note}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const NOTES = [
  "Each tablet picks its counter once, on the register, and remembers it. The cashier on counter 2 never sees counter 1's bills.",
  "Receipt numbers are per counter — ALM-260916-0042 and BACK-260916-0007 on the same day, so a bill says which till it came off.",
  "Sales & takings totals each counter separately and then together, so you can count one drawer against one number at close.",
  "A counter that has rung up a sale cannot be deleted, only shut. Its takings stay in the day it took them.",
];
