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

/**
 * A custom edge: a Pakistan-local day, optionally narrowed to a minute.
 *
 * The time half is optional because most of the time it is noise — an owner
 * asking for "1 to 15 September" means whole days. It exists for the shift
 * question ("what did the evening actually take?"), which whole days cannot
 * answer.
 */
type CustomEdge = { at: Date; timed: boolean };

const CUSTOM_EDGE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

/** Parses `2026-09-15` or `2026-09-15T18:30` as the Pakistan-local instant it names. */
function fromPktInput(value: unknown): CustomEdge | null {
  if (typeof value !== "string" || !CUSTOM_EDGE.test(value)) return null;

  const timed = value.length > 10;
  const parsed = Date.parse(timed ? `${value}:00.000Z` : `${value}T00:00:00.000Z`);

  // `Date.parse` is the range check too: 2026-13-40 and T25:00 both fail here.
  return Number.isNaN(parsed)
    ? null
    : { at: new Date(parsed - PKT_OFFSET_MS), timed };
}

/** Back to the string the URL and the picker both speak. */
function toPktInput({ at, timed }: CustomEdge): string {
  const iso = new Date(at.getTime() + PKT_OFFSET_MS).toISOString();
  return timed ? iso.slice(0, 16) : iso.slice(0, 10);
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

const SHORT_DATE_TIME = new Intl.DateTimeFormat("en-PK", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "Asia/Karachi",
});

/** "15 Sept" for a whole day, "15 Sept, 6:30 pm" once a minute is named. */
const edgeLabel = (edge: CustomEdge) =>
  (edge.timed ? SHORT_DATE_TIME : SHORT_DATE).format(edge.at);

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
    const start = fromPktInput(first);
    const end = fromPktInput(last);

    if (start && end) {
      // A bare `to` names a day and that whole day is in; a timed one is the
      // exact minute the window shuts.
      const exclusiveEnd = end.timed
        ? end.at
        : new Date(end.at.getTime() + DAY_MS);

      if (exclusiveEnd.getTime() > start.at.getTime()) {
        return build(
          "custom",
          `${edgeLabel(start)} – ${edgeLabel(end)}`,
          start.at,
          exclusiveEnd,
          { from: toPktInput(start), to: toPktInput(end) },
        );
      }
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
