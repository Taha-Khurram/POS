"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { DateRangeModal } from "@/components/pos/date-range-modal";
import { IconCalendar, IconCheck, IconChevron } from "@/components/pos/icons";
import { useDismiss } from "@/components/pos/use-dismiss";
import {
  reportRanges,
  writeReportWindow,
  type ReportRangeId,
  type ReportWindow,
} from "@/lib/pos/report";
import type { ShopSettings } from "@/lib/pos/settings-options";

/**
 * Which trading days the report covers.
 *
 * The only control on this screen that navigates, and the only reason any of it
 * ships JavaScript. Everything else is HTML by the time it reaches the tablet —
 * which is the point: a report is a page somebody reads, prints and sends on,
 * not an app they drive.
 *
 * The period lives in the URL beside the tab, so "how did last month go" is a
 * link an owner can send to their accountant and the accountant sees the same
 * figures. `tab` is carried through every change, because changing the period
 * while looking at the item list should not throw you back to the summary.
 *
 * Not the sales history's list. That screen is opened to find one bill and its
 * longest period is thirty days; this one is opened to ask about a quarter or a
 * financial year, and the financial year is the shop's own — see
 * `reportRanges`.
 */
export function PeriodPicker({
  range,
  window,
  settings,
  today,
  tab,
}: {
  range: ReportRangeId;
  window: ReportWindow;
  settings: ShopSettings;
  today: string;
  tab: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { ref, open, setOpen } = useDismiss<HTMLDivElement>();
  const [picking, setPicking] = useState(false);

  const ranges = reportRanges(settings, today);

  const go = (params: URLSearchParams) => {
    setOpen(false);
    params.set("tab", tab);
    startTransition(() => router.push(`/app/reports?${params}`, { scroll: false }));
  };

  const choose = (next: ReportRangeId) => {
    // A custom range is not a period until both ends exist, so it opens the
    // calendar rather than navigating. Everything else goes on the spot.
    if (next === "custom") {
      setOpen(false);
      setPicking(true);
      return;
    }

    go(new URLSearchParams({ range: next }));
  };

  const label = writeReportWindow(range, window, settings, today);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="pos-picker js-only w-[15rem]"
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
          {pending ? "Loading that period" : ""}
        </span>
      </button>

      {open ? (
        <div className="pos-menu pos-picker-menu" role="menu">
          {ranges.map((option) => {
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
          initial={{ from: window.from, to: window.to }}
          daysOnly
          title="Which days"
          cta="Show this period"
          onClose={() => setPicking(false)}
          onApply={(from, to) => {
            setPicking(false);
            go(new URLSearchParams({ range: "custom", from, to }));
          }}
        />
      ) : null}

      <noscript>
        {/* Same trick as the reveal fallback in `app/layout.tsx`: a style tag
            that only exists when scripting is off, standing a plain form up in
            place of the control that cannot work without JavaScript. */}
        <style>{`.js-only{display:none}`}</style>

        <form method="get" action="/app/reports" className="flex items-center gap-2">
          <input type="hidden" name="tab" value={tab} />
          <label>
            <span className="sr-only">Period</span>
            <select name="range" defaultValue={range} className="pos-field w-auto">
              {ranges
                .filter((option) => option.id !== "custom")
                .map((option) => (
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
