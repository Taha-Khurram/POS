/**
 * The periods the dashboard offers, and nothing else.
 *
 * Split out of `timeframes.ts` because the filter control is a client
 * component and needs the list to render its `<select>`, while the resolution
 * around it — Pakistan-local boundaries, the comparison window — is
 * `server-only`. A client component importing that module pulls `server-only`
 * into the browser bundle and the build fails, so the shared half lives here
 * with no imports at all.
 */

export type TimeframeId =
  | "today"
  | "7d"
  | "14d"
  | "21d"
  | "30d"
  | "this-month"
  | "last-month"
  | "custom";

/** What the `<select>` offers, in the order it offers it. */
export const TIMEFRAME_OPTIONS: { id: TimeframeId; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "14d", label: "Last 14 days" },
  { id: "21d", label: "Last 21 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "custom", label: "Custom range" },
];
