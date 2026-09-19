"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { DateRangeModal } from "@/components/pos/date-range-modal";
import { IconCalendar, IconCheck, IconChevron } from "@/components/pos/icons";
import { useDismiss } from "@/components/pos/use-dismiss";
import {
  RANGES,
  writeWindow,
  type RangeId,
  type Window,
} from "@/lib/pos/history";

/**
 * Which trading days the history is showing.
 *
 * The only control on this screen that navigates. Everything else — the search
 * box, the counter, the cashier, the payment method, the page — filters rows
 * the browser already has, because a keystroke that costs a round trip on shop
 * 3G is a search box a shopkeeper stops using. The window cannot work that way:
 * it decides what is read at all, so it lives in the URL, and last Tuesday can
 * be sent to an accountant as a link.
 *
 * A listbox rather than a `<select>` for the same reason the dashboard's is:
 * the last row is not a period, it opens a calendar. The `<noscript>` twin is
 * the same control as a plain GET form, so a tablet that lost the bundle to a
 * dead connection can still change the days.
 */
export function RangePicker({
  range,
  window,
  today,
}: {
  range: RangeId;
  window: Window;
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { ref, open, setOpen } = useDismiss<HTMLDivElement>();
  const [picking, setPicking] = useState(false);

  const go = (params: URLSearchParams) => {
    setOpen(false);
    params.set("tab", "history");
    startTransition(() => router.push(`/app/sales?${params}`, { scroll: false }));
  };

  const choose = (next: RangeId) => {
    // A custom range is not a period until both ends exist, so it opens the
    // calendar rather than navigating. Everything else goes on the spot.
    if (next === "custom") {
      setOpen(false);
      setPicking(true);
      return;
    }

    go(new URLSearchParams({ range: next }));
  };

  const label = writeWindow(range, window, today);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="pos-picker js-only w-[13.5rem]"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${window.from} to ${window.to}`}
      >
        <IconCalendar className="h-4 w-4 flex-none text-orchid-600" />
        <span className="flex-1 truncate text-left">{label}</span>

        {/* The spinner takes the caret's place rather than standing beside it,
            so the control is exactly as wide while it is thinking. */}
        {pending ? (
          <span
            className="h-3.5 w-3.5 flex-none animate-spin rounded-full border-2 border-orchid-200 border-t-orchid-700"
            aria-hidden
          />
        ) : (
          <IconChevron className="pos-picker-caret h-3.5 w-3.5" />
        )}

        <span aria-live="polite" className="sr-only">
          {pending ? "Loading those days" : ""}
        </span>
      </button>

      {open ? (
        <div className="pos-menu pos-picker-menu" role="menu">
          {RANGES.map((option) => {
            const selected = option.id === range;

            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => choose(option.id)}
                className="pos-option"
              >
                <span className="flex-1">
                  {option.label}
                  <span className="pos-option-note">
                    {/* A chosen custom range says what it resolved to; the
                        trigger is showing the same dates, but the list is
                        where you go to change them. */}
                    {option.id === "custom" && selected
                      ? `${window.from} → ${window.to}`
                      : option.note}
                  </span>
                </span>

                {selected ? <IconCheck className="h-4 w-4 flex-none" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {picking ? (
        <DateRangeModal
          initial={window}
          daysOnly
          title="Which days"
          cta="Show these bills"
          onClose={() => setPicking(false)}
          onApply={(from, to) => {
            setPicking(false);
            go(new URLSearchParams({ range: "custom", from, to }));
          }}
        />
      ) : null}

      <noscript>
        {/* Same trick as the reveal fallback in `app/layout.tsx`: a style tag
            that only exists when scripting is off, standing the plain form up
            in place of the control that cannot work without JavaScript. */}
        <style>{`.js-only{display:none}`}</style>

        <form method="get" action="/app/sales" className="flex items-center gap-2">
          <input type="hidden" name="tab" value="history" />
          <label>
            <span className="sr-only">Days</span>
            <select name="range" defaultValue={range} className="pos-field w-auto">
              {RANGES.filter((option) => option.id !== "custom").map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="pos-btn pos-btn-soft">
            Show
          </button>
        </form>
      </noscript>
    </div>
  );
}
