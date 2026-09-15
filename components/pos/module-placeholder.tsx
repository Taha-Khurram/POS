import Link from "next/link";

import { IconChevron, type IconProps } from "./icons";

/**
 * What a module that has not shipped yet looks like.
 *
 * It names what will be here and when, rather than a shrug. A shopkeeper who
 * paid for Flo this month and tapped "Reports" deserves a date they can hold
 * us to — and if the date is wrong, an empty screen would not have made it
 * righter.
 */
export function ModulePlaceholder({
  title,
  lede,
  icon: Icon,
  arriving,
  bullets,
}: {
  title: string;
  lede: string;
  icon: (props: IconProps) => React.ReactElement;
  /** Plain words, e.g. "Part 4 — week of 29 September". */
  arriving: string;
  bullets: string[];
}) {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="pos-card p-6 sm:p-8">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-orchid-50 text-orchid-700">
          <Icon className="h-5 w-5" />
        </span>

        <h1 className="mt-4 font-display text-[1.375rem] font-bold">{title}</h1>
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-graphite-700">
          {lede}
        </p>

        <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-orchid-50 px-3 py-1.5 text-[0.75rem] font-semibold text-orchid-800">
          Arriving {arriving}
        </p>

        <ul className="mt-5 space-y-2 border-t border-orchid-100 pt-5">
          {bullets.map((bullet) => (
            <li
              key={bullet}
              className="flex gap-2.5 text-[0.875rem] leading-relaxed text-graphite-700"
            >
              <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-orchid-300" />
              {bullet}
            </li>
          ))}
        </ul>

        <Link href="/app" className="pos-btn pos-btn-soft mt-6">
          <IconChevron className="h-4 w-4 rotate-90" />
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
