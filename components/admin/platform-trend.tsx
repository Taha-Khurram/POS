"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { usePrefersReducedMotion } from "@/components/motion/use-in-view";
import { compactRupees, rupees } from "@/lib/format";
import { writeAxisDay } from "@/lib/platform/admin";
import type { PlatformDay } from "@/lib/platform/console";

/**
 * Thirty days of everything sold through Flo, across every shop.
 *
 * The Overview used to carry no chart at all, on the argument — written into
 * the page — that a business with twelve clients has nothing to plot. That is
 * still true of the *client count*, and there is still no chart of it. It was
 * never true of the volume going through the product: a dozen shops ring up
 * thousands of bills a month, and whether that line is climbing is the single
 * thing that says the product is being used rather than merely sold.
 *
 * Three decisions, two of them borrowed from `components/pos/trend-chart.tsx`
 * because a console with two chart grammars is a console that looks assembled:
 *
 * - **One series on the axis, because there is one unit.** Bills is a count and
 *   rupees are rupees; putting both on one scale would be meaningless and
 *   giving the count its own axis would let the two swap places wherever the
 *   scaling happened to put them. So bills appears in the tooltip, named, and
 *   never as a plotted shape.
 * - **Straight segments, not a spline.** A smoothed curve through daily totals
 *   draws sales that never happened between the points.
 * - **Measured, not scaled.** Real pixels from a ResizeObserver rather than a
 *   stretched viewBox, which would thicken the stroke horizontally and squash
 *   the labels.
 *
 * The zeroes matter and are why `0038` gap-fills in SQL: a day nobody sold
 * anything has to draw as a trough. A chart that quietly omitted it would join
 * the days either side and draw a slope that never happened.
 */

const HEIGHT = 232;
const PAD = { top: 14, right: 18, bottom: 28, left: 54 };

/** Rounds an axis top up to a number a person would have chosen. */
function niceMax(value: number) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10].find(
    (candidate) => candidate * magnitude >= value,
  );
  return (step ?? 10) * magnitude;
}

export function PlatformTrend({ points }: { points: PlatformDay[] }) {
  const host = useRef<HTMLDivElement>(null);
  const lineRef = useRef<SVGPathElement>(null);

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

    const y = (value: number) =>
      PAD.top + plotHeight - (Math.max(value, 0) / max) * plotHeight;

    const linePath = points
      .map(
        (point, index) =>
          `${index ? "L" : "M"} ${x(index).toFixed(1)} ${y(point.sales).toFixed(1)}`,
      )
      .join(" ");

    return {
      plotWidth,
      plotHeight,
      baseline,
      max,
      x,
      y,
      linePath,
      areaPath: `${linePath} L ${x(points.length - 1).toFixed(1)} ${baseline.toFixed(1)} L ${x(0).toFixed(1)} ${baseline.toFixed(1)} Z`,
    };
  }, [points, width]);

  // Measure the real path length rather than guessing a dash array that has to
  // be longer than any path the data could produce.
  useEffect(() => {
    if (reduced) return;

    const path = lineRef.current;
    if (!path) return;

    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length}`;

    const run = path.animate(
      [{ strokeDashoffset: length }, { strokeDashoffset: 0 }],
      {
        duration: 1100,
        delay: 120,
        easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
        fill: "both",
      },
    );

    return () => run.cancel();
  }, [chart.linePath, reduced]);

  // Label density is a function of how much room there is, not of how many
  // days there are: thirty labels is a grey smear at any width the console
  // runs at.
  const stride = Math.max(
    1,
    Math.ceil(points.length / Math.max(2, Math.floor(chart.plotWidth / 72))),
  );
  const hovered = active === null ? null : points[active];

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - bounds.left - PAD.left) / chart.plotWidth;
    const index = Math.round(ratio * (points.length - 1));
    setActive(Math.min(points.length - 1, Math.max(0, index)));
  };

  if (points.length === 0) {
    return (
      <p className="py-10 text-center text-[0.8125rem] text-graphite-500">
        Nothing has been sold through Flo yet.
      </p>
    );
  }

  return (
    <div ref={host} className="relative">
      <svg
        width={width}
        height={HEIGHT}
        className="block touch-none"
        role="img"
        aria-label={`Everything sold through Flo each day from ${writeAxisDay(points[0].day)} to ${writeAxisDay(points[points.length - 1].day)}.`}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setActive(null)}
      >
        <defs>
          <linearGradient id="admin-trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-sales)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--chart-sales)" stopOpacity="0" />
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
              key={point.day}
              x={chart.x(index)}
              y={HEIGHT - 9}
              textAnchor={
                index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"
              }
              className="fill-graphite-500 text-[10px]"
            >
              {writeAxisDay(point.day)}
            </text>
          ) : null,
        )}

        <path d={chart.areaPath} fill="url(#admin-trend-fill)" />

        {active !== null ? (
          <line
            x1={chart.x(active)}
            x2={chart.x(active)}
            y1={PAD.top}
            y2={chart.baseline}
            stroke="var(--chart-sales)"
            strokeWidth="1.5"
            opacity="0.4"
          />
        ) : null}

        <path
          ref={lineRef}
          d={chart.linePath}
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
            stroke="var(--color-paper-50)"
            strokeWidth="2.5"
          />
        ) : null}
      </svg>

      {hovered && active !== null ? (
        <div
          className="pos-tip"
          style={{
            left: Math.min(
              Math.max(chart.x(active) - 74, 0),
              Math.max(0, width - 152),
            ),
            top: Math.max(4, chart.y(hovered.sales) - 78),
          }}
        >
          <p className="font-display text-[0.75rem] font-semibold text-graphite-900">
            {writeAxisDay(hovered.day)}
          </p>
          <p className="mt-1 flex items-center justify-between gap-3 text-[0.75rem] text-graphite-700">
            <span>Sold</span>
            <span className="font-medium tabular-nums">{rupees(hovered.sales)}</span>
          </p>
          <p className="mt-0.5 flex items-center justify-between gap-3 text-[0.75rem] text-graphite-700">
            <span>Bills</span>
            <span className="font-medium tabular-nums">
              {hovered.bills.toLocaleString("en-PK")}
            </span>
          </p>
        </div>
      ) : null}
    </div>
  );
}
