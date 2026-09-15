import { CountUp } from "@/components/motion/count-up";
import type { Delta } from "@/lib/pos/dashboard";

import { IconTrend, type IconProps } from "./icons";

/**
 * One headline figure.
 *
 * Three rules it enforces so a row of four stays comparable:
 *
 * - The number is the biggest thing on the card and the label sits above it,
 *   so the row scans as four numbers rather than four sentences.
 * - A delta never appears without naming what it is against. "+12%" on its own
 *   is the single most common way a dashboard misleads its owner.
 * - Direction is an arrow *and* a sign, never colour alone — and whether a rise
 *   is good is the caller's call. Cost going up during a stock-up week is not a
 *   problem, and the card has no way to know that.
 */
export function KpiCard({
  label,
  amount,
  prefix = "Rs ",
  suffix = "",
  decimals = 0,
  note,
  delta,
  tone = "neutral",
  icon: Icon,
  delay = 0,
}: {
  label: string;
  /** Rendered with a count-up, so pass the raw number, not a string. */
  amount: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  /** What the delta is measured against. Required whenever a delta is shown. */
  note: string;
  delta: Delta | null;
  /** Whether "up" is good for this particular measure. */
  tone?: "neutral" | "more-is-better" | "less-is-better";
  icon: (props: IconProps) => React.ReactElement;
  delay?: number;
}) {
  const good =
    tone === "neutral" || !delta || delta.direction === "flat"
      ? null
      : (delta.direction === "up") === (tone === "more-is-better");

  const deltaClass =
    good === null
      ? "text-graphite-500"
      : good
        ? "text-signal-good"
        : "text-signal-bad";

  return (
    <article className="pos-card pos-kpi p-4">
      <header className="relative flex items-start justify-between gap-3">
        <h3 className="font-display text-[0.8125rem] leading-tight font-semibold text-graphite-500">
          {label}
        </h3>
        <span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-orchid-50 text-orchid-700">
          <Icon className="h-4 w-4" />
        </span>
      </header>

      <p className="relative mt-2.5 font-display text-[1.75rem] leading-none font-bold tracking-tight text-graphite-900 tabular-nums">
        <CountUp
          to={amount}
          decimals={decimals}
          prefix={prefix}
          suffix={suffix}
          delay={delay}
        />
      </p>

      <p className="relative mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[0.75rem]">
        {delta ? (
          <span className={`inline-flex items-center gap-1 font-semibold ${deltaClass}`}>
            <IconTrend direction={delta.direction} />
            {delta.pct > 0 ? "+" : ""}
            {delta.pct.toFixed(1)}%
          </span>
        ) : (
          <span className="font-semibold text-graphite-500">No comparison</span>
        )}
        <span className="text-graphite-500">{note}</span>
      </p>
    </article>
  );
}
