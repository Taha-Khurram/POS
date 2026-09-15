"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  TIMEFRAME_OPTIONS,
  type TimeframeId,
} from "@/lib/pos/timeframe-options";
import { DateRangeModal } from "./date-range-modal";
import { IconCalendar, IconCheck, IconChevron } from "./icons";
import { useDismiss } from "./use-dismiss";

/**
 * The dashboard's global time filter.
 *
 * Every widget on the page reads the resolved window from `searchParams`, so
 * there is no "apply to all" wiring to get wrong: one navigation re-renders the
 * whole dashboard from one range, and the resulting URL can be sent to an
 * accountant.
 *
 * It is a listbox rather than a `<select>` because the last row is not a
 * period — it opens a calendar — and because a native dropdown cannot carry the
 * dates a custom range resolved to. The `<noscript>` twin below is the same
 * control as a plain GET form: on a tablet that has not finished hydrating, or
 * lost the bundle to a dead connection, changing the period is still a browser
 * navigation.
 */
export function TimeframeFilter({
  value,
  label,
  custom,
}: {
  value: TimeframeId;
  /** The resolved window's own words — "Last 7 days", or "1 – 15 Sept". */
  label: string;
  custom?: { from: string; to: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const {
    ref: menuRef,
    open,
    setOpen,
  } = useDismiss<HTMLDivElement>();

  const [picking, setPicking] = useState(false);

  const go = (params: URLSearchParams) => {
    setOpen(false);
    startTransition(() => router.push(`/app?${params}`, { scroll: false }));
  };

  const choose = (next: TimeframeId) => {
    // A custom range is not a period until both ends exist, so it opens the
    // calendar instead of navigating. Everything else goes on the spot.
    if (next === "custom") {
      setOpen(false);
      setPicking(true);
      return;
    }

    go(new URLSearchParams({ range: next }));
  };

  return (
    <div className="relative ml-auto flex justify-end" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="pos-picker js-only"
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
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
          {pending ? "Updating the dashboard" : ""}
        </span>
      </button>

      {open ? (
        <div className="pos-menu pos-picker-menu" role="menu">
          {TIMEFRAME_OPTIONS.map((option) => {
            const selected = option.id === value;

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
                  {option.id === "custom" ? "Pick your own dates…" : option.label}

                  {/* A selected custom range says what it resolved to; the
                      trigger above it is showing the same dates, but the list
                      is where you go to change them. */}
                  {option.id === "custom" && selected && custom ? (
                    <span className="pos-option-note">
                      {custom.from.replace("T", " ")} → {custom.to.replace("T", " ")}
                    </span>
                  ) : null}
                </span>

                {selected ? (
                  <IconCheck className="h-4 w-4 flex-none" />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {picking ? (
        <DateRangeModal
          initial={custom}
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

        <form method="get" action="/app" className="flex items-center gap-2">
          <label>
            <span className="sr-only">Period</span>
            <select name="range" defaultValue={value} className="pos-field w-auto">
              {TIMEFRAME_OPTIONS.filter((option) => option.id !== "custom").map(
                (option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ),
              )}
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
