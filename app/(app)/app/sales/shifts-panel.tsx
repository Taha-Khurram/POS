import { IconDrawer } from "@/components/pos/icons";
import { moneyFormatter } from "@/lib/pos/counter";
import type { ShopSettings } from "@/lib/pos/settings-options";
import {
  shiftClock,
  shiftLength,
  writeVariance,
  type Shift,
} from "@/lib/pos/shift";

/**
 * Who had which drawer, and whether it balanced.
 *
 * A server component, because there is nothing to interact with: it is a list
 * somebody reads once a week and asks two questions of — "was anything short"
 * and "whose". Sorting or filtering it would be a control for a list that is
 * fifty rows long at the outside.
 *
 * **The variance column is behind `can_close_shift`.** That is the same switch
 * the closing sheet honours, and for a stronger reason here: this screen is
 * every shift the shop has run, so a cashier who could read it would know what
 * every previous count came to before doing their own. What they see instead is
 * their own counts, with the difference withheld — recorded, and not theirs to
 * read.
 *
 * Day close sits beside this and answers a different question. That tab is what
 * a *counter* took between opening and midnight; this is what a *person's*
 * drawer came to over four hours, which is the one that makes a Rs 300 gap
 * visible at all — the same Rs 300 against a whole day's forty thousand is
 * noise.
 */
export function ShiftsPanel({
  shifts,
  settings,
  canSeeVariance,
}: {
  shifts: Shift[];
  settings: ShopSettings;
  canSeeVariance: boolean;
}) {
  const money = moneyFormatter(settings);

  if (shifts.length === 0) {
    return (
      <section className="pos-card p-6">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-orchid-50 text-orchid-700">
          <IconDrawer className="h-5 w-5" />
        </span>

        <h2 className="mt-4 font-display text-[1.125rem] font-bold">
          No drawer has been counted yet
        </h2>

        <p className="mt-2.5 max-w-prose text-[0.9375rem] leading-relaxed text-graphite-700">
          A shift is one person&rsquo;s time on one counter, from the float
          going in to the notes being counted out. Open one at the top of the
          Register and every bill rung up on that till belongs to it — so a
          drawer that is Rs 300 light stops being invisible against the
          day&rsquo;s forty thousand and becomes a question somebody can answer.
        </p>

        <p className="mt-2.5 max-w-prose text-[0.9375rem] leading-relaxed text-graphite-700">
          The register needs one before it will charge anything, so this list
          fills itself from the first sale of the first morning.
        </p>
      </section>
    );
  }

  return (
    <section className="pos-card">
      <header className="border-b border-orchid-100 px-4 py-3">
        <h2 className="font-display text-[0.9375rem] font-semibold">
          The last {shifts.length} {shifts.length === 1 ? "shift" : "shifts"}
        </h2>
        <p className="mt-0.5 text-[0.75rem] text-graphite-500">
          {canSeeVariance
            ? "Counted against what the till took. Cash only — the card machine never went into the drawer."
            : "What was counted out of each drawer. The difference against the till goes to the owner."}
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="pos-table">
          <thead>
            <tr>
              <th>Counter</th>
              <th>Who</th>
              <th>When</th>
              <th className="text-end">Float</th>
              <th className="text-end">Bills</th>
              <th className="text-end">Counted</th>
              {canSeeVariance ? <th className="text-end">Expected</th> : null}
              {canSeeVariance ? <th className="text-end">Over / short</th> : null}
            </tr>
          </thead>

          <tbody>
            {shifts.map((shift) => {
              const variance =
                shift.overShort === null ? null : writeVariance(shift.overShort);

              return (
                <tr key={shift.id}>
                  <td className="font-medium text-graphite-900">
                    {shift.counterName}
                  </td>

                  <td>
                    {shift.openedBy}
                    {/* Only when it was somebody else. A shift closed by the
                        person who opened it is the normal case and naming them
                        twice is a column of repeated words. */}
                    {shift.status === "closed" &&
                    shift.closedBy !== shift.openedBy &&
                    shift.closedBy !== "—" ? (
                      <span className="block text-[0.75rem] text-graphite-500">
                        closed by {shift.closedBy}
                      </span>
                    ) : null}
                  </td>

                  <td className="whitespace-nowrap">
                    {shiftClock(shift.openedAt, settings.timezone)}
                    <span className="block text-[0.75rem] text-graphite-500">
                      {shift.status === "open" ? (
                        <span className="text-signal-good">
                          open · {shiftLength(shift.openedAt, null)}
                        </span>
                      ) : shift.autoClosed ? (
                        // Left open past the end of the trading day, so the
                        // clock shut it — said so, because a drawer nobody
                        // closed is the thing the owner wants to ask about.
                        `${shiftLength(shift.openedAt, shift.closedAt)} · closed at day end`
                      ) : (
                        shiftLength(shift.openedAt, shift.closedAt)
                      )}
                    </span>
                  </td>

                  <td className="pos-num">{money(shift.openingFloat)}</td>
                  <td className="pos-num">{shift.bills || "—"}</td>

                  <td className="pos-num">
                    {shift.countedCash === null ? (
                      <span className="text-graphite-500">
                        {shift.autoClosed ? "Not counted" : "—"}
                      </span>
                    ) : (
                      money(shift.countedCash)
                    )}
                  </td>

                  {canSeeVariance ? (
                    <td className="pos-num">
                      {shift.expectedCash === null ? (
                        <span className="text-graphite-500">—</span>
                      ) : (
                        money(shift.expectedCash)
                      )}
                    </td>
                  ) : null}

                  {canSeeVariance ? (
                    <td className="pos-num font-semibold">
                      {variance === null ? (
                        <span className="text-graphite-500">—</span>
                      ) : variance.word === "exact" ? (
                        <span className="text-signal-good">Balanced</span>
                      ) : (
                        <span
                          className={
                            variance.word === "short"
                              ? "text-signal-bad"
                              : "text-signal-warn"
                          }
                        >
                          {money(variance.amount)} {variance.word}
                        </span>
                      )}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Said under the table rather than in a tooltip, because it is the
          answer to the question the table provokes: a drawer that is short is
          not necessarily a person who took money, and the commonest cause is
          cash that left the till for something legitimate. */}
      <p className="border-t border-orchid-100 px-4 py-3 text-[0.75rem] leading-relaxed text-graphite-500">
        A short drawer is usually money that left the till for something other
        than change — a delivery paid in cash, the water man, a float moved to
        another counter. The note on each shift is where that gets written down.
      </p>
    </section>
  );
}
