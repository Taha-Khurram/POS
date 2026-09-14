import "server-only";

import { TIMEFRAME_OPTIONS, type TimeframeId } from "./timeframe-options";

// Re-exported so server callers have one import for the whole concept; the
// client filter imports the options module directly.
export { TIMEFRAME_OPTIONS, type TimeframeId };

/**
 * The dashboard's global time filter.
 *
 * The selected window lives in the URL (`?range=7d`, or `?range=custom&from=…
 * &to=…`) rather than in React state. Three reasons, in order of how much they
 * matter: the dashboard page stays a server component, so every widget is
 * rendered from one already-resolved window instead of each fetching its own;
 * a shopkeeper can bookmark or WhatsApp "last month" to their accountant; and
 * when the real queries land, the range is already a parameter the server has
 * before it renders, not something the client asks for afterwards.
 *
 * Every boundary is Pakistan time. A server in UTC would otherwise cut "today"
 * at 5 am Karachi, which is halfway through the morning rush for a tandoor and
 * badly wrong for everyone else. Pakistan has not observed DST since 2009, so a
 * fixed offset is correct rather than merely convenient.
 */

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;


export type Timeframe = {
  id: TimeframeId;
  label: string;
  /** Inclusive start, as a UTC instant. */
  from: Date;
  /** Exclusive end, as a UTC instant. */
  to: Date;
  /** Whole days spanned. Drives the trend chart's bucket size. */
  days: number;
  bucket: "hour" | "day";
  /** The equally long window immediately before, for every "vs" figure. */
  previous: { from: Date; to: Date };
  /** Set only for `custom`, so the control can repopulate its date inputs. */
  custom?: { from: string; to: string };
};


const IDS = new Set(TIMEFRAME_OPTIONS.map((option) => option.id));

const isTimeframeId = (value: unknown): value is TimeframeId =>
  typeof value === "string" && IDS.has(value as TimeframeId);

/** Pakistan-local midnight that opens the day `instant` falls in. */
function pktDayStart(instant: Date): Date {
  const shifted = new Date(instant.getTime() + PKT_OFFSET_MS);
  const midnight = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
  return new Date(midnight - PKT_OFFSET_MS);
}

/** Pakistan-local midnight that opens the month `instant` falls in. */
function pktMonthStart(instant: Date, monthsBack = 0): Date {
  const shifted = new Date(instant.getTime() + PKT_OFFSET_MS);
  const midnight = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() - monthsBack,
    1,
  );
  return new Date(midnight - PKT_OFFSET_MS);
}

/** "2026-09-15" in Pakistan time — the shape the date inputs speak. */
export function toPktDateInput(instant: Date): string {
  return new Date(instant.getTime() + PKT_OFFSET_MS).toISOString().slice(0, 10);
}

/** Parses a date input back to the Pakistan-local midnight it names. */
function fromPktDateInput(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed) ? null : new Date(parsed - PKT_OFFSET_MS);
}

const MONTH = new Intl.DateTimeFormat("en-PK", {
  month: "long",
  year: "numeric",
  timeZone: "Asia/Karachi",
});

const SHORT_DATE = new Intl.DateTimeFormat("en-PK", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Karachi",
});

const rollingDays: Partial<Record<TimeframeId, number>> = {
  "7d": 7,
  "14d": 14,
  "21d": 21,
  "30d": 30,
};

function build(
  id: TimeframeId,
  label: string,
  from: Date,
  to: Date,
  custom?: { from: string; to: string },
): Timeframe {
  const span = to.getTime() - from.getTime();
  const days = Math.max(1, Math.round(span / DAY_MS));

  return {
    id,
    label,
    from,
    to,
    days,
    // A single day is only legible split by hour; anything longer by day.
    bucket: days <= 1 ? "hour" : "day",
    previous: { from: new Date(from.getTime() - span), to: from },
    custom,
  };
}

/**
 * Resolves the `searchParams` of `/app` into the one window every widget on the
 * page reads. Anything unparseable falls back to the last 7 days rather than
 * erroring — a mistyped URL should still show the owner their shop.
 */
export function resolveTimeframe(
  params: Record<string, string | string[] | undefined>,
  now: Date = new Date(),
): Timeframe {
  const raw = Array.isArray(params.range) ? params.range[0] : params.range;
  const id: TimeframeId = isTimeframeId(raw) ? raw : "7d";

  const todayStart = pktDayStart(now);
  // Windows run to the end of today, so a sale rung up a minute ago counts.
  const todayEnd = new Date(todayStart.getTime() + DAY_MS);

  if (id === "today") {
    return build("today", "Today", todayStart, todayEnd);
  }

  if (id === "this-month") {
    return build("this-month", MONTH.format(now), pktMonthStart(now), todayEnd);
  }

  if (id === "last-month") {
    const start = pktMonthStart(now, 1);
    const end = pktMonthStart(now);
    return build("last-month", MONTH.format(start), start, end);
  }

  if (id === "custom") {
    const first = Array.isArray(params.from) ? params.from[0] : params.from;
    const last = Array.isArray(params.to) ? params.to[0] : params.to;
    const start = fromPktDateInput(first);
    const end = fromPktDateInput(last);

    // Both ends required, and `to` is inclusive in the UI but exclusive here.
    if (start && end && end.getTime() >= start.getTime()) {
      const exclusiveEnd = new Date(end.getTime() + DAY_MS);
      return build(
        "custom",
        `${SHORT_DATE.format(start)} – ${SHORT_DATE.format(end)}`,
        start,
        exclusiveEnd,
        { from: toPktDateInput(start), to: toPktDateInput(end) },
      );
    }

    // An incomplete custom range is a half-filled form, not an error state.
    const fallbackFrom = new Date(todayEnd.getTime() - 7 * DAY_MS);
    return build("custom", "Custom range", fallbackFrom, todayEnd, {
      from: toPktDateInput(fallbackFrom),
      to: toPktDateInput(todayStart),
    });
  }

  const days = rollingDays[id] ?? 7;
  return build(id, `Last ${days} days`, new Date(todayEnd.getTime() - days * DAY_MS), todayEnd);
}

/** "15 Sept" — the axis and table format, Pakistan time. */
export const shortDate = (instant: Date) => SHORT_DATE.format(instant);
