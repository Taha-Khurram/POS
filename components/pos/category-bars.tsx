import { compactRupees } from "@/lib/format";
import type { CategorySlice } from "@/lib/pos/dashboard";

/**
 * Where the money came from, by category.
 *
 * **Bars, not a donut**, and the reason is the palette. Flo's console runs a
 * single blue ramp, and identity-by-colour needs hues a person can tell apart —
 * six steps of one hue sit far below that threshold (adjacent steps measure
 * ΔE 5 in OKLab against a floor of 15). A donut coloured that way would be six
 * wedges nobody can match to the legend.
 *
 * Ranked bars dodge the problem entirely: the category is named on its own row,
 * so colour carries no information at all and one hue is the honest choice.
 * Length is also a more accurate encoding than angle, which matters here
 * because the point of this widget is "is oil bigger than dairy this week".
 *
 * No client JavaScript — the bars grow with a CSS animation.
 */
export function CategoryBars({ slices }: { slices: CategorySlice[] }) {
  const largest = Math.max(...slices.map((slice) => slice.sales), 1);

  return (
    <ol className="space-y-3">
      {slices.map((slice, index) => (
        <li key={slice.name}>
          <p className="flex items-baseline justify-between gap-3 text-[0.8125rem]">
            <span className="min-w-0 truncate text-graphite-700">{slice.name}</span>
            <span className="flex-none tabular-nums">
              <span className="font-semibold text-graphite-900">
                {compactRupees(slice.sales)}
              </span>
              <span className="ml-1.5 text-graphite-500">
                {Math.round(slice.share * 100)}%
              </span>
            </span>
          </p>

          <div className="pos-meter mt-1.5">
            <span
              style={{
                width: `${(slice.sales / largest) * 100}%`,
                animationDelay: `${index * 70}ms`,
              }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}
