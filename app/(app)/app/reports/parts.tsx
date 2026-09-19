import { IconTrend } from "@/components/pos/icons";
import { InfoTip } from "@/components/pos/info-tip";
import { EXPLAIN, type Delta, type Explainer } from "@/lib/pos/report";

/**
 * The small pieces every tab on Reports draws with.
 *
 * All server components. The only JavaScript this screen ships is the period
 * picker and the export button — a report is a page somebody reads, prints and
 * sends to their accountant, not an app they drive, and on a Rs 25,000 Android
 * tablet over 3G that is the difference between a report and a spinner.
 */

/** A share as a bar. Length is the encoding and the number is beside it, so the
 *  bar is never the only thing saying how big a row is. */
export function Meter({ share }: { share: number }) {
  return (
    <span className="flex items-center justify-end gap-2">
      <span className="tabular-nums text-graphite-500">
        {(share * 100).toFixed(1)}%
      </span>
      <span className="pos-meter hidden w-20 flex-none sm:block">
        <span style={{ width: `${Math.max(share * 100, 1)}%` }} />
      </span>
    </span>
  );
}

/**
 * Change against the previous period.
 *
 * Never shown without the period it is against being named somewhere on the
 * screen — `PeriodNote` does that once at the top rather than every card
 * repeating it. "+12%" on its own is the single most common way a report
 * misleads the person who owns the shop.
 */
export function Trend({
  delta,
  tone = "more-is-better",
}: {
  delta: Delta | null;
  tone?: "neutral" | "more-is-better" | "less-is-better";
}) {
  if (!delta) {
    return <span className="text-[0.75rem] text-graphite-500">New</span>;
  }

  const good =
    tone === "neutral" || delta.direction === "flat"
      ? null
      : (delta.direction === "up") === (tone === "more-is-better");

  return (
    <span
      className={`inline-flex items-center gap-1 text-[0.75rem] font-semibold tabular-nums ${
        good === null
          ? "text-graphite-500"
          : good
            ? "text-signal-good"
            : "text-signal-bad"
      }`}
    >
      <IconTrend direction={delta.direction} />
      {delta.pct > 0 ? "+" : ""}
      {delta.pct.toFixed(1)}%
    </span>
  );
}

/** A margin, written the one way. Always a percentage of the selling price —
 *  `EXPLAIN.margin` is what says so, wherever this appears. */
export const Pct = ({ value }: { value: number }) => (
  <span className="tabular-nums">{value.toFixed(1)}%</span>
);

/**
 * A line of plain English under a card's figures.
 *
 * The thing that makes a report readable is not the table, it is the sentence
 * beside the table saying what the table is of. Every card on this screen has
 * one, and where it quotes a sum the sum comes from `EXPLAIN`.
 */
export function Note({
  children,
  tone = "info",
}: {
  children: React.ReactNode;
  tone?: "info" | "warn";
}) {
  return (
    <p
      className={`mt-3 rounded-xl border px-3 py-2 text-[0.75rem] leading-relaxed ${
        tone === "warn"
          ? "border-sun-400/45 bg-sun-400/10 text-graphite-700"
          : "border-orchid-100 bg-orchid-50 text-graphite-700"
      }`}
    >
      {children}
    </p>
  );
}

/**
 * What the figures below were counted over, said once.
 *
 * At the top of every windowed tab, and it is the most important sentence on
 * the screen: a report whose period is ambiguous is a report that will be
 * argued with. It names the trading days, how many there are, and what the
 * "vs" figures are measured against — with the tips that explain why a trading
 * day is not a calendar day and how the comparison period is picked.
 */
export function PeriodNote({
  covering,
  days,
  versus,
}: {
  covering: string;
  days: number;
  versus: string;
}) {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[0.8125rem] text-graphite-500">
      <span className="font-semibold text-graphite-900">{covering}</span>
      <span aria-hidden>·</span>
      <span className="inline-flex items-center gap-1">
        {days.toLocaleString("en-PK")} trading {days === 1 ? "day" : "days"}
        <InfoTip label="Trading days" explain={EXPLAIN.window} />
      </span>
      <span aria-hidden>·</span>
      <span className="inline-flex items-center gap-1">
        compared with {versus}
        <InfoTip label="The comparison period" explain={EXPLAIN.previous} />
      </span>
    </p>
  );
}

/**
 * One line of a card's figure list: a label with its tip, and the value.
 *
 * Used where a table would be four rows of two columns — the payment mix, the
 * period's arithmetic, the stock headline. `op` is the arithmetic sign in front
 * of the label, which is what turns a stack of figures into a sum somebody can
 * read down and check.
 */
export function Figure({
  label,
  explain,
  value,
  op,
  strong = false,
  hint,
}: {
  label: string;
  explain?: Explainer;
  value: React.ReactNode;
  /** "−", "=" or nothing. */
  op?: string;
  strong?: boolean;
  hint?: string;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 py-2 ${
        strong ? "border-t border-orchid-100 pt-3" : ""
      }`}
    >
      <span className="flex min-w-0 items-center gap-1.5 text-[0.8125rem]">
        <span
          className="w-3 flex-none text-right font-display font-bold text-orchid-600"
          aria-hidden
        >
          {op}
        </span>
        <span className={strong ? "font-semibold text-graphite-900" : "text-graphite-700"}>
          {label}
          {hint ? (
            <span className="block text-[0.6875rem] text-graphite-500">{hint}</span>
          ) : null}
        </span>
        {explain ? <InfoTip label={label} explain={explain} /> : null}
      </span>

      <span
        className={`flex-none tabular-nums ${
          strong
            ? "font-display text-[1.0625rem] font-bold text-graphite-900"
            : "text-[0.9375rem] font-semibold text-graphite-900"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/** The one place a report admits what it cannot tell you. Every tab that leans
 *  on cost prices carries it, because an item with no cost reads as pure
 *  profit and an owner who does not know that will believe a margin that is
 *  not there. */
export const CostCaveat = () => (
  <Note tone="warn">
    <strong className="font-semibold">Profit assumes every item has a cost price.</strong>{" "}
    {EXPLAIN.costGap.plain}
  </Note>
);
