"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { IconCalendar, IconChevron, IconClock, IconClose } from "./icons";

/**
 * The custom-range picker behind the period filter's last option.
 *
 * Hand-rolled for the same reason the charts and the icons are: a range
 * calendar from npm is 30-odd KB to draw six rows of buttons, and this one only
 * ever ships to the dashboard route.
 *
 * Every date in here is a plain `YYYY-MM-DD` string and every calculation runs
 * through `Date.UTC`, never a local getter. The tablet behind the counter is
 * usually on Pakistan time but the accountant opening the same link from Dubai
 * is not, and a picker that quietly shifts a day when the device clock does is
 * worse than no picker. "Today" is the one thing that has to know the
 * difference: it is read off the wall clock in Karachi, matching the windows
 * the server resolves.
 */

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

const MONTH_LABEL = new Intl.DateTimeFormat("en-PK", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const DAY_LABEL = new Intl.DateTimeFormat("en-PK", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** The Pakistan-local day happening right now, as the inputs spell it. */
const pktToday = () =>
  new Date(Date.now() + PKT_OFFSET_MS).toISOString().slice(0, 10);

const key = (utcMs: number) => new Date(utcMs).toISOString().slice(0, 10);

const monthStart = (day: string) => {
  const [year, month] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, 1);
};

const addMonths = (utcMs: number, count: number) => {
  const at = new Date(utcMs);
  return Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + count, 1);
};

/** Splits `2026-09-15T18:30` into the day and the minute, either of which may be missing. */
function split(value: string | undefined) {
  const [day = "", time = ""] = (value ?? "").split("T");
  return { day, time };
}

/** Six rows of seven, Monday first. Days outside the month are left blank. */
function monthGrid(first: number) {
  const at = new Date(first);
  // getUTCDay is Sunday-0; the counter's week starts on Monday.
  const lead = (at.getUTCDay() + 6) % 7;

  return Array.from({ length: 42 }, (_, index) => {
    const ms = first + (index - lead) * DAY_MS;
    return {
      ms,
      day: key(ms),
      inMonth: new Date(ms).getUTCMonth() === at.getUTCMonth(),
    };
  });
}

export function DateRangeModal({
  initial,
  onClose,
  onApply,
  daysOnly = false,
  title = "Pick your own dates",
  cta = "Show this range",
}: {
  initial?: { from: string; to: string };
  onClose: () => void;
  onApply: (from: string, to: string) => void;
  /**
   * Hides the time-of-day row.
   *
   * The sales history windows on `sales.business_day`, which is a trading day
   * and not a clock — a dhaba's 1 am sale is stamped to the day it opened. A
   * time field over that would look like it narrowed something and would
   * narrow nothing, which is worse than not offering it.
   */
  daysOnly?: boolean;
  title?: string;
  cta?: string;
}) {
  // Pinned for the life of the dialog: a shop open past midnight should not
  // have the calendar change shape under the owner's finger.
  const today = useMemo(() => pktToday(), []);

  const opening = useMemo(
    () => ({ from: split(initial?.from), to: split(initial?.to) }),
    [initial?.from, initial?.to],
  );

  const [from, setFrom] = useState(opening.from.day);
  const [to, setTo] = useState(opening.to.day);
  // A half-drawn range follows the pointer; it is the only thing that makes a
  // two-tap selection read as one gesture.
  const [hover, setHover] = useState("");

  const [timed, setTimed] = useState(
    !daysOnly && Boolean(opening.from.time || opening.to.time),
  );
  const [fromTime, setFromTime] = useState(opening.from.time || "00:00");
  const [toTime, setToTime] = useState(opening.to.time || "23:59");

  // Two months are shown, so open one back: the range being edited sits on the
  // right and last month is already in view, which is what most edits want.
  const [cursor, setCursor] = useState(() =>
    addMonths(monthStart(opening.from.day || today), -1),
  );

  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    // The page behind must not scroll while a sheet is over it.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const months = [cursor, addMonths(cursor, 1)];
  // Nothing has been sold in October yet, so there is nowhere to page to.
  const atEnd = months[1] >= monthStart(today);

  // While only one end is set, the range paints out to whatever is under the
  // cursor, so its shape is visible before the second tap lands.
  const provisional = to || (from && hover > from ? hover : from);

  const pick = (day: string) => {
    // A tap before the open day restarts the range rather than inverting it —
    // reaching backwards is how people correct a mis-tap, not how they select.
    if (!from || to || day < from) {
      setFrom(day);
      setTo("");
      return;
    }
    setTo(day);
  };

  const fillRolling = (days: number) => {
    const start = Date.parse(today) - (days - 1) * DAY_MS;
    setFrom(key(start));
    setTo(today);
    setCursor(addMonths(monthStart(key(start)), 0));
  };

  const fillMonth = () => {
    const start = monthStart(today);
    setFrom(key(start));
    setTo(today);
    setCursor(addMonths(start, -1));
  };

  const span =
    from && to ? Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1 : 0;

  // A same-day window needs the clock to run forwards; a longer one cannot be
  // inverted by the time fields.
  const timesValid = !timed || from !== to || toTime > fromTime;
  const ready = Boolean(from && to) && timesValid;

  const apply = () => {
    if (!ready) return;
    onApply(timed ? `${from}T${fromTime}` : from, timed ? `${to}T${toTime}` : to);
  };

  return (
    <div
      className="pos-modal"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Pick a date range"
        tabIndex={-1}
        className="pos-sheet outline-none"
      >
        <header className="flex items-start gap-3 border-b border-orchid-100 px-4 py-3.5 sm:px-5">
          <span className="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-xl bg-orchid-200 text-orchid-800">
            <IconCalendar className="h-[18px] w-[18px]" />
          </span>

          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[0.9375rem] font-bold text-graphite-900">
              {title}
            </h2>
            {/* The caption is the instruction and the receipt in one line, so
                the dialog never needs a second row of helper text. */}
            <p className="mt-0.5 text-[0.75rem] text-graphite-500">
              {from && to
                ? `${DAY_LABEL.format(Date.parse(from))} – ${DAY_LABEL.format(Date.parse(to))} · ${span} ${span === 1 ? "day" : "days"}`
                : from
                  ? "Now the closing day."
                  : "Tap the opening day, then the closing one."}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="pos-icon-btn -mr-1.5 flex-none"
            aria-label="Close"
          >
            <IconClose className="h-4 w-4" />
          </button>
        </header>

        <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3 sm:px-5">
          <button type="button" className="pos-chip" onClick={() => fillRolling(7)}>
            Last 7 days
          </button>
          <button type="button" className="pos-chip" onClick={() => fillRolling(30)}>
            Last 30 days
          </button>
          <button type="button" className="pos-chip" onClick={fillMonth}>
            Month to date
          </button>
        </div>

        <div className="relative px-3 py-3 sm:px-5">
          {/* The arrows sit over the month headings rather than in a bar of
              their own — two rows of chrome above a calendar is one too many
              on a 10-inch screen. */}
          <button
            type="button"
            onClick={() => setCursor(addMonths(cursor, -1))}
            className="pos-icon-btn absolute top-2.5 left-2 z-10 h-8 w-8 sm:left-4"
            aria-label="Previous month"
          >
            <IconChevron className="h-4 w-4 rotate-90" />
          </button>

          <button
            type="button"
            onClick={() => setCursor(addMonths(cursor, 1))}
            disabled={atEnd}
            className="pos-icon-btn absolute top-2.5 right-2 z-10 h-8 w-8 disabled:pointer-events-none disabled:opacity-30 sm:right-4"
            aria-label="Next month"
          >
            <IconChevron className="h-4 w-4 -rotate-90" />
          </button>

          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {months.map((first, index) => (
              <section
                key={first}
                // The second month is a luxury of width, not of information.
                className={index === 1 ? "hidden sm:block" : undefined}
                aria-label={MONTH_LABEL.format(first)}
              >
                <p className="mb-1.5 text-center font-display text-[0.8125rem] font-semibold text-graphite-900">
                  {MONTH_LABEL.format(first)}
                </p>

                <div className="pos-cal-grid" aria-hidden>
                  {WEEKDAYS.map((weekday, day) => (
                    <span key={day} className="pos-cal-head">
                      {weekday}
                    </span>
                  ))}
                </div>

                <div className="pos-cal-grid" onPointerLeave={() => setHover("")}>
                  {monthGrid(first).map((cell) =>
                    cell.inMonth ? (
                      <button
                        key={cell.ms}
                        type="button"
                        disabled={cell.day > today}
                        onClick={() => pick(cell.day)}
                        onPointerEnter={() => setHover(cell.day)}
                        onFocus={() => setHover(cell.day)}
                        className="pos-day"
                        data-in={
                          Boolean(from && provisional) &&
                          cell.day >= from &&
                          cell.day <= provisional
                        }
                        data-edge={
                          cell.day === from || cell.day === provisional
                        }
                        data-today={cell.day === today}
                        aria-pressed={cell.day === from || cell.day === to}
                        aria-label={DAY_LABEL.format(cell.ms)}
                      >
                        {new Date(cell.ms).getUTCDate()}
                      </button>
                    ) : (
                      <span key={cell.ms} />
                    ),
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>

        {/* Time of day is folded away by default. Nearly every question this
            screen is asked is a question about whole days; the shift question
            is the exception, so it costs one tap rather than two fields that
            are wrong most of the time. */}
        <div
          className={`border-t border-orchid-100 px-4 py-3 sm:px-5 ${daysOnly ? "hidden" : ""}`}
        >
          <label className="flex cursor-pointer items-center gap-2.5 text-[0.8125rem] text-graphite-700">
            <input
              type="checkbox"
              checked={timed}
              onChange={(event) => setTimed(event.target.checked)}
              className="h-4 w-4 flex-none accent-orchid-700"
            />
            <IconClock className="h-4 w-4 flex-none text-orchid-600" />
            Narrow it to a time of day
          </label>

          {timed ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-7">
              <input
                type="time"
                value={fromTime}
                onChange={(event) => setFromTime(event.target.value)}
                className="pos-field w-auto"
                aria-label="Start time"
              />
              <span className="text-[0.8125rem] text-graphite-500">to</span>
              <input
                type="time"
                value={toTime}
                onChange={(event) => setToTime(event.target.value)}
                className="pos-field w-auto"
                aria-label="End time"
              />
              <p className="w-full text-[0.75rem] text-graphite-500">
                Pakistan time. The window shuts at the end time, so 9:00 pm
                leaves out the sale rung at 9:00 pm.
              </p>
            </div>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-orchid-100 px-4 py-3 sm:px-5">
          {!timesValid ? (
            <p className="mr-auto text-[0.75rem] font-medium text-signal-bad">
              The closing time has to come after the opening one.
            </p>
          ) : null}

          <button type="button" onClick={onClose} className="pos-btn pos-btn-quiet">
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={!ready}
            className="pos-btn pos-btn-primary disabled:pointer-events-none disabled:opacity-45"
          >
            {cta}
          </button>
        </footer>
      </div>
    </div>
  );
}
