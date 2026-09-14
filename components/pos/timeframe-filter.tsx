"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  TIMEFRAME_OPTIONS,
  type TimeframeId,
} from "@/lib/pos/timeframe-options";

/**
 * The dashboard's global time filter.
 *
 * It is a real `<form method="get">` pointed at `/app`, so on a tablet that has
 * not finished hydrating — or has JavaScript disabled, or lost the bundle to a
 * dead connection halfway through — changing the range still works as a plain
 * browser navigation. Once hydrated, the same submit is intercepted and pushed
 * through the router instead, which keeps the rail and the scroll position.
 *
 * Every widget on the page reads the resolved window from `searchParams`, so
 * there is no "apply to all" wiring to get wrong: one navigation re-renders the
 * whole dashboard from one range.
 */
export function TimeframeFilter({
  value,
  custom,
}: {
  value: TimeframeId;
  custom?: { from: string; to: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [range, setRange] = useState<TimeframeId>(value);
  const [from, setFrom] = useState(custom?.from ?? "");
  const [to, setTo] = useState(custom?.to ?? "");

  const go = (next: TimeframeId, nextFrom = from, nextTo = to) => {
    const params = new URLSearchParams({ range: next });

    if (next === "custom") {
      params.set("from", nextFrom);
      params.set("to", nextTo);
    }

    startTransition(() => router.push(`/app?${params}`, { scroll: false }));
  };

  return (
    <form
      method="get"
      action="/app"
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        go(range);
      }}
      data-pending={pending}
    >
      <label className="relative">
        <span className="sr-only">Period</span>
        <select
          name="range"
          value={range}
          className="pos-field w-auto font-medium"
          onChange={(event) => {
            const next = event.target.value as TimeframeId;
            setRange(next);
            // A custom range is not a period until both ends are filled in, so
            // it waits for Apply. Everything else navigates on the spot.
            if (next !== "custom") go(next);
          }}
        >
          {TIMEFRAME_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {range === "custom" ? (
        <>
          <input
            type="date"
            name="from"
            value={from}
            max={to || undefined}
            onChange={(event) => setFrom(event.target.value)}
            className="pos-field w-auto"
            aria-label="From date"
            required
          />
          <span className="text-[0.8125rem] text-graphite-500">to</span>
          <input
            type="date"
            name="to"
            value={to}
            min={from || undefined}
            onChange={(event) => setTo(event.target.value)}
            className="pos-field w-auto"
            aria-label="To date"
            required
          />
          <button type="submit" className="pos-btn pos-btn-soft">
            Apply
          </button>
        </>
      ) : null}

      {/* Reserved space rather than a spinner that shifts the row when it
          appears — the whole point of this control is that it sits still. */}
      <span
        aria-live="polite"
        className={`text-[0.75rem] text-azure-700 transition-opacity duration-200 ${
          pending ? "opacity-100" : "opacity-0"
        }`}
      >
        Updating…
      </span>
    </form>
  );
}
