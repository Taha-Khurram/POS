import { IconChevron, IconRegister } from "@/components/pos/icons";
import { tendersOn, type Counter } from "@/lib/pos/counter";
import { chooseCounter } from "./choose-counter";

/**
 * Which till is this?
 *
 * Asked once per tablet and then remembered in a cookie, so the cashier on
 * counter 2 does not answer it again every morning. A server component with a
 * Server Action behind each button: the choice has to be readable by the server
 * before the register renders, and a client component writing `document.cookie`
 * would mean the first paint of every shift is the wrong counter.
 *
 * Only open counters are offered. A shut one is not a choice, it is a Settings
 * problem, and listing it would let a cashier pick a till that then refuses
 * every sale.
 */
export function CounterPicker({
  counters,
  current,
}: {
  counters: Counter[];
  /** Set when the cashier asked to switch, so the till they are on is marked
   *  rather than presented as an equal option. */
  current: string | null;
}) {
  return (
    <div className="mx-auto max-w-lg">
      <div className="pos-card overflow-hidden">
        <header className="px-5 pt-5 pb-4">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-orchid-50 text-orchid-700">
            <IconRegister className="h-5 w-5" />
          </span>

          <h1 className="mt-4 font-display text-[1.375rem] font-bold">
            Which counter is this?
          </h1>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-graphite-700">
            This tablet will remember. Every bill it rings up gets this
            counter&rsquo;s receipt numbers, and its takings are totalled under
            this counter at the end of the day.
          </p>
        </header>

        <ul className="divide-y divide-orchid-100 border-t border-orchid-100">
          {counters.map((counter) => (
            <li key={counter.id}>
              <form action={chooseCounter}>
                <input type="hidden" name="counter_id" value={counter.id} />

                <button
                  type="submit"
                  className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-orchid-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-display text-[0.9375rem] font-semibold text-graphite-900">
                        {counter.name}
                      </span>

                      {counter.id === current ? (
                        <span className="pos-badge pos-badge-info">
                          On this tablet now
                        </span>
                      ) : null}
                    </span>

                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.75rem] text-graphite-500">
                      <span className="font-mono">{counter.receiptPrefix}</span>
                      <span aria-hidden>·</span>
                      <span>
                        {tendersOn(counter)
                          .map((tender) => tender.label)
                          .join(" and ")}
                      </span>
                    </span>
                  </span>

                  <IconChevron className="h-4 w-4 flex-none -rotate-90 text-graphite-500" />
                </button>
              </form>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
