"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { usePrefersReducedMotion } from "@/components/motion/use-in-view";
import { compactRupees, rupees } from "@/lib/format";
import type { TrendPoint } from "@/lib/pos/dashboard";

/**
 * Sales and profit over the selected window: sales as a line, profit as the
 * bars underneath it.
 *
 * Hand-rolled SVG, per `Plan.md`: a chart library is 60 KB of JavaScript to
 * draw a line and thirty rectangles, and the register's budget for that is
 * zero.
 *
 * Four decisions worth knowing before editing it:
 *
 * - **One y-axis.** Sales and profit are both rupees, so they share a scale and
 *   the air between the top of a bar and the line *is* the cost of the goods.
 *   A second axis would let the two swap places wherever the scaling happened
 *   to put them, which is how a dashboard tells you a lie with real numbers.
 * - **Two forms, not two lines.** Profit is a bar because it is a quantity you
 *   compare day against day; sales is a line because it is a shape you read
 *   left to right. Form also does work colour cannot here: pacific-blue is
 *   2.3:1 against white and could never carry a series on its own.
 * - **Straight segments, not a spline.** A smoothed curve through daily totals
 *   draws sales that never happened between the points. The marketing chart
 *   smooths because it is a picture of a chart; this one is a chart.
 * - **Measured, not scaled.** The SVG is laid out in real pixels from a
 *   ResizeObserver rather than a viewBox stretched with `preserveAspectRatio`,
 *   which would thicken the strokes horizontally and squash the labels.
 */

const HEIGHT = 268;
const PAD = { top: 14, right: 18, bottom: 28, left: 54 };

const SERIES = [
  { key: "sales", label: "Sales", color: "var(--chart-sales)", shape: "line" },
  { key: "profit", label: "Profit", color: "var(--chart-profit)", shape: "bar" },
] as const;

/** Rounds an axis top up to a number a person would have chosen. */
function niceMax(value: number) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10].find(
    (candidate) => candidate * magnitude >= value,
  );
  return (step ?? 10) * magnitude;
}

export function TrendChart({ points }: { points: TrendPoint[] }) {
  const host = useRef<HTMLDivElement>(null);
  const salesRef = useRef<SVGPathElement>(null);

  const [width, setWidth] = useState(760);
  const [active, setActive] = useState<number | null>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const element = host.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(260, Math.round(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const chart = useMemo(() => {
    const plotWidth = Math.max(1, width - PAD.left - PAD.right);
    const plotHeight = HEIGHT - PAD.top - PAD.bottom;
    const max = niceMax(Math.max(...points.map((point) => point.sales), 1));
    const baseline = PAD.top + plotHeight;

    const x = (index: number) =>
      points.length < 2
        ? PAD.left + plotWidth / 2
        : PAD.left + (index / (points.length - 1)) * plotWidth;

    const y = (value: number) => PAD.top + plotHeight - (value / max) * plotHeight;

    const salesPath = points
      .map(
        (point, index) =>
          `${index ? "L" : "M"} ${x(index).toFixed(1)} ${y(point.sales).toFixed(1)}`,
      )
      .join(" ");

    // The line's scale puts the first and last point *on* the plot edges, so a
    // bar centred under either would hang half outside it. Rather than inset
    // the whole scale — which would bend the line away from its own axis
    // labels — the two end bars are nudged back inside.
    const slot = plotWidth / Math.max(points.length, 1);
    const barWidth = Math.max(2, Math.min(20, slot * 0.58));

    const bars = points.map((point, index) => {
      const top = y(Math.max(point.profit, 0));

      return {
        x: Math.min(
          Math.max(x(index) - barWidth / 2, PAD.left),
          PAD.left + plotWidth - barWidth,
        ),
        y: top,
        height: Math.max(1, baseline - top),
      };
    });

    return {
      plotWidth,
      plotHeight,
      baseline,
      max,
      x,
      y,
      salesPath,
      barWidth,
      bars,
      areaPath: `${salesPath} L ${x(points.length - 1).toFixed(1)} ${baseline.toFixed(1)} L ${x(0).toFixed(1)} ${baseline.toFixed(1)} Z`,
    };
  }, [points, width]);

  // Draw the line on, the way `components/site/sales-chart.tsx` does: measure
  // the real path length rather than guessing a dash array that has to be
  // longer than any path the data could produce.
  useEffect(() => {
    if (reduced) return;

    const path = salesRef.current;
    if (!path) return;

    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length}`;

    // Starts after the bars have risen, so the two do not compete.
    const run = path.animate(
      [{ strokeDashoffset: length }, { strokeDashoffset: 0 }],
      {
        duration: 1100,
        delay: 160,
        easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
        fill: "both",
      },
    );

    return () => run.cancel();
  }, [chart.salesPath, reduced]);

  // Label density is a function of how much room there is, not of how many
  // buckets there are: a 30-day axis with 30 labels is a grey smear on a
  // desktop and an unreadable one on a phone. ~78px per label leaves "15 Sept"
  // at 10px room to breathe at every width the console runs at.
  const stride = Math.max(
    1,
    Math.ceil(points.length / Math.max(2, Math.floor(chart.plotWidth / 78))),
  );
  const hovered = active === null ? null : points[active];

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - bounds.left - PAD.left) / chart.plotWidth;
    const index = Math.round(ratio * (points.length - 1));
    setActive(Math.min(points.length - 1, Math.max(0, index)));
  };

  return (
    <div ref={host} className="relative">
      <svg
        width={width}
        height={HEIGHT}
        className="block touch-none"
        role="img"
        aria-label={`Sales as a line and profit as bars, from ${points[0]?.label} to ${points[points.length - 1]?.label}. Full figures are in the recent sales table below.`}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setActive(null)}
      >
        <defs>
          <linearGradient id="pos-trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-sales)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--chart-sales)" stopOpacity="0" />
          </linearGradient>

          {/* Bars are lit at the top and fade into the card at the foot, so a
              row of them reads as one band rather than thirty blocks. */}
          <linearGradient id="pos-trend-bar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-profit)" />
            <stop offset="100%" stopColor="var(--frozen-water)" />
          </linearGradient>

          <linearGradient id="pos-trend-bar-on" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--harbour)" />
            <stop offset="100%" stopColor="var(--pacific-blue)" />
          </linearGradient>
        </defs>

        {/* Four bands is enough to judge a height against; more turns the plot
            into graph paper. */}
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
          const gridY = PAD.top + fraction * chart.plotHeight;

          return (
            <g key={fraction}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={gridY}
                y2={gridY}
                stroke="var(--chart-grid)"
                strokeWidth="1"
              />
              <text
                x={PAD.left - 10}
                y={gridY + 3.5}
                textAnchor="end"
                className="fill-graphite-500 text-[10px] tabular-nums"
              >
                {compactRupees(chart.max * (1 - fraction))}
              </text>
            </g>
          );
        })}

        {points.map((point, index) =>
          index % stride === 0 || index === points.length - 1 ? (
            <text
              key={`${point.label}-${index}`}
              x={chart.x(index)}
              y={HEIGHT - 9}
              textAnchor={
                index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"
              }
              className="fill-graphite-500 text-[10px]"
            >
              {point.label}
            </text>
          ) : null,
        )}

        <path d={chart.areaPath} fill="url(#pos-trend-fill)" />

        {chart.bars.map((bar, index) => (
          <rect
            key={index}
            className="pos-bar"
            x={bar.x}
            y={bar.y}
            width={chart.barWidth}
            height={bar.height}
            rx={Math.min(chart.barWidth / 2, 4)}
            fill={index === active ? "url(#pos-trend-bar-on)" : "url(#pos-trend-bar)"}
            // Under reduced motion the duration is flattened globally but the
            // delay is not, so a staggered chart would still trickle in.
            style={reduced ? undefined : { animationDelay: `${index * 16}ms` }}
          />
        ))}

        {/* The stem ties the marker to its own bar. It runs over the bars
            rather than under them, which is the only way it reads once the
            bars are tall. */}
        {active !== null ? (
          <line
            x1={chart.x(active)}
            x2={chart.x(active)}
            y1={chart.y(points[active].sales)}
            y2={chart.baseline}
            stroke="var(--harbour)"
            strokeWidth="1.5"
            opacity="0.55"
          />
        ) : null}

        <path
          ref={salesRef}
          d={chart.salesPath}
          fill="none"
          stroke="var(--chart-sales)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* A white ring keeps the marker legible wherever on the plot it lands */}
        {hovered && active !== null ? (
          <circle
            cx={chart.x(active)}
            cy={chart.y(hovered.sales)}
            r="5"
            fill="var(--chart-sales)"
            stroke="#fff"
            strokeWidth="2.5"
          />
        ) : null}
      </svg>

      {/* The pill rides above the marker rather than parking in a corner, so
          the number and the point it belongs to are one glance apart. */}
      {hovered && active !== null ? (
        <div
          className="pos-tip"
          style={{
            left: Math.min(
              Math.max(chart.x(active) - 74, 0),
              Math.max(0, width - 152),
            ),
            top: Math.max(4, chart.y(hovered.sales) - 86),
          }}
        >
          <p className="font-display text-[0.75rem] font-semibold text-graphite-900">
            {hovered.label}
          </p>

          {SERIES.map((series) => (
            <p
              key={series.key}
              className="mt-1 flex items-center justify-between gap-3 text-[0.75rem] text-graphite-700"
            >
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="pos-legend-key"
                  data-shape={series.shape}
                  style={{ background: series.color }}
                />
                {series.label}
              </span>
              <span className="font-medium tabular-nums">
                {rupees(hovered[series.key])}
              </span>
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The legend, lifted out so it can sit in the card header rather than under the
 * plot. With two series it is the only thing tying a colour *and a shape* to a
 * name, so it belongs where the eye lands first — and it carries the totals,
 * which is what most people came to the chart for anyway.
 */
export function TrendLegend({
  totals,
}: {
  totals: { sales: number; profit: number };
}) {
  return (
    <div className="pos-legend">
      {SERIES.map((series) => (
        <span key={series.key} className="inline-flex items-center gap-1.5">
          <span
            className="pos-legend-key"
            data-shape={series.shape}
            style={{ background: series.color }}
          />
          {series.label}
          <span className="font-semibold text-graphite-900 tabular-nums">
            {compactRupees(totals[series.key])}
          </span>
        </span>
      ))}
    </div>
  );
}
