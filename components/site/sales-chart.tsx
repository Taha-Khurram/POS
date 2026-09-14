"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, usePrefersReducedMotion } from "@/components/motion/use-in-view";

const W = 480;
const H = 168;

type Range = {
  id: string;
  label: string;
  ticks: string[];
  /** Current period. */
  primary: number[];
  /** Comparison period. */
  compare: number[];
  /** Index of the point the callout points at. */
  marker: number;
  callout: { date: string; value: string };
};

const RANGES: Range[] = [
  {
    id: "12m",
    label: "12 months",
    ticks: ["Oct", "Jan", "Apr", "Jul", "Sep"],
    primary: [180, 240, 210, 300, 275, 350, 320, 410, 380, 300, 340, 420],
    compare: [260, 215, 285, 240, 330, 290, 245, 300, 265, 355, 300, 330],
    marker: 4,
    callout: { date: "February", value: "Rs 2.86M sales" },
  },
  {
    id: "30d",
    label: "30 days",
    ticks: ["24 Aug", "31 Aug", "7 Sept", "14 Sept", "21 Sept", "28 Sept"],
    primary: [210, 170, 260, 230, 330, 300, 395, 350, 250, 290, 240, 330],
    compare: [300, 340, 250, 290, 220, 265, 210, 245, 320, 275, 350, 290],
    marker: 3,
    callout: { date: "5 September", value: "Rs 284,500 sales" },
  },
  {
    id: "1w",
    label: "1 week",
    ticks: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    primary: [150, 220, 195, 280, 340, 420, 380, 300, 260, 320, 355, 400],
    compare: [230, 190, 260, 215, 250, 300, 275, 340, 300, 245, 280, 320],
    marker: 8,
    callout: { date: "Friday", value: "Rs 196,400 sales" },
  },
];

const MIN = 120;
const MAX = 440;

const pointAt = (values: number[], index: number) => ({
  x: (index / (values.length - 1)) * W,
  y: H - ((values[index] - MIN) / (MAX - MIN)) * H,
});

/** Catmull-Rom through the points, emitted as cubic beziers. */
function smoothPath(values: number[]) {
  const points = values.map((_, index) => pointAt(values, index));
  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;

  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;

    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;

    path += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(
      2,
    )} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }

  return path;
}

export function SalesChart() {
  const [active, setActive] = useState(1);
  const { ref, inView } = useInView<HTMLDivElement>({ threshold: 0.3 });
  const reduced = usePrefersReducedMotion();

  const primaryRef = useRef<SVGPathElement | null>(null);
  const compareRef = useRef<SVGPathElement | null>(null);

  const range = RANGES[active];
  const primaryPath = smoothPath(range.primary);
  const comparePath = smoothPath(range.compare);
  const marker = pointAt(range.primary, range.marker);
  const markerHigh = marker.y / H < 0.38;

  // Redraw whenever the series changes or the card first scrolls into view.
  useEffect(() => {
    if (!inView || reduced) return;

    const paths = [primaryRef.current, compareRef.current];
    const animations = paths.map((path, index) => {
      if (!path) return null;
      const length = path.getTotalLength();
      path.style.strokeDasharray = `${length}`;
      return path.animate(
        [{ strokeDashoffset: length }, { strokeDashoffset: 0 }],
        {
          duration: 1500,
          delay: index * 140,
          easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
          fill: "both",
        },
      );
    });

    return () => animations.forEach((animation) => animation?.cancel());
  }, [inView, reduced, active]);

  return (
    <div ref={ref} className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-display text-[0.8125rem] font-semibold text-mist-200">
          Sales (Rs 000s)
        </h4>

        <div
          role="tablist"
          aria-label="Date range"
          className="relative flex items-center gap-0.5 rounded-full border border-white/8 bg-white/[0.03] p-0.5"
        >
          {/* Sliding pill sits behind the labels */}
          <span
            aria-hidden
            className="absolute inset-y-0.5 rounded-full bg-iris-600/85 shadow-[0_4px_14px_-6px_rgb(79_70_229/0.9)] transition-[left,width] duration-500 ease-[var(--ease-out-back)]"
            style={{
              left: `calc(${(active * 100) / RANGES.length}% + 2px)`,
              width: `calc(${100 / RANGES.length}% - 4px)`,
            }}
          />
          {RANGES.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={index === active}
              onClick={() => setActive(index)}
              className={`relative z-10 flex-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[0.625rem] font-medium transition-colors duration-300 ${
                index === active
                  ? "text-white"
                  : "text-mist-400 hover:text-mist-200"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative mt-3 flex-1">
        <div className="flex h-full gap-2">
          {/* Y axis */}
          <div className="flex flex-col justify-between py-0.5 text-[0.5625rem] text-mist-500">
            {[400, 300, 200, 100].map((tick) => (
              <span key={tick}>{tick}</span>
            ))}
          </div>

          <div className="relative flex-1">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              className="h-full w-full overflow-visible"
              aria-hidden
            >
              <defs>
                <linearGradient id="chart-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3f8efc" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="#3f8efc" stopOpacity="0" />
                </linearGradient>
              </defs>

              {/* Gridlines */}
              {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
                <line
                  key={fraction}
                  x1="0"
                  x2={W}
                  y1={fraction * H}
                  y2={fraction * H}
                  stroke="rgb(255 255 255 / 0.05)"
                  strokeWidth="1"
                />
              ))}

              <path
                key={`area-${range.id}`}
                d={`${primaryPath} L ${W} ${H} L 0 ${H} Z`}
                fill="url(#chart-area)"
                className="[animation:fade-up_1.2s_var(--ease-out-soft)_0.3s_both]"
              />

              <path
                key={`compare-${range.id}`}
                ref={compareRef}
                d={comparePath}
                fill="none"
                stroke="#f472b6"
                strokeWidth="2"
                strokeLinecap="round"
              />

              <path
                key={`primary-${range.id}`}
                ref={primaryRef}
                d={primaryPath}
                fill="none"
                stroke="#3f8efc"
                strokeWidth="2"
                strokeLinecap="round"
              />

              {/* Marker on the highlighted point */}
              <g
                key={`marker-${range.id}`}
                className="[animation:fade-up_0.7s_var(--ease-out-back)_1.2s_both]"
              >
                <circle
                  cx={marker.x}
                  cy={marker.y}
                  r="8"
                  fill="rgb(63 142 252 / 0.18)"
                />
                <circle
                  cx={marker.x}
                  cy={marker.y}
                  r="3.5"
                  fill="#add7f6"
                  stroke="#3b28cc"
                  strokeWidth="1.5"
                />
              </g>
            </svg>

            {/* Callout — positioned in percentage space so it tracks the point */}
            <div
              key={`callout-${range.id}`}
              className={`pointer-events-none absolute z-10 -translate-x-1/2 ${
                markerHigh ? "translate-y-[34%]" : "-translate-y-[130%]"
              } rounded-lg border border-white/10 bg-ink-750/95 px-2 py-1.5 text-center whitespace-nowrap shadow-[0_10px_30px_-14px_rgb(0_0_0/0.9)] backdrop-blur-sm [animation:fade-up_0.7s_var(--ease-out-back)_1.35s_both]`}
              style={{
                left: `${(marker.x / W) * 100}%`,
                top: `${(marker.y / H) * 100}%`,
              }}
            >
              <p className="text-[0.5625rem] text-mist-400">
                {range.callout.date}
              </p>
              <p className="font-display text-[0.625rem] font-semibold text-mist-50">
                {range.callout.value}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* X axis */}
      <div className="mt-2 flex justify-between pl-6 text-[0.5625rem] text-mist-500">
        {range.ticks.map((tick) => (
          <span key={tick}>{tick}</span>
        ))}
      </div>
    </div>
  );
}
