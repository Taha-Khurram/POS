"use client";

import { CountUp } from "@/components/motion/count-up";
import { Tilt } from "@/components/motion/tilt";
import { FloMark } from "./flo-mark";
import { SalesChart } from "./sales-chart";

const TABS = ["Overview", "Bills", "Stock", "Khata", "Staff"];

const METERS = [
  { label: "Cash", value: 38, tint: "#f472b6" },
  { label: "Card", value: 24, tint: "#87bfff" },
  { label: "Raast & wallets", value: 26, tint: "#3f8efc" },
  { label: "Udhaar", value: 12, tint: "#66758f" },
];

const STATS = [
  { value: 1284, label: "Bills today", delta: "+12%", up: true },
  { value: 26, label: "Udhaar accounts", delta: "-4%", up: false },
  { value: 103, label: "Items low", delta: "+8%", up: true },
];

const FLOW = [
  { label: "Paid", count: 1234, tint: "#3f8efc" },
  { label: "Returns", count: 3, tint: "#66758f" },
  { label: "On udhaar", count: 24, tint: "#f472b6" },
];

export function DashboardMock() {
  return (
    <Tilt max={4} className="relative" spotlight={false}>
      {/* Bloom behind the window */}
      <div
        aria-hidden
        className="glow inset-x-8 -bottom-10 top-16 bg-iris-600/20 blur-[80px]"
      />

      <div className="panel rim relative overflow-hidden rounded-[20px] shadow-[0_50px_120px_-50px_rgb(4_4_10/0.95)] sm:rounded-[26px]">
        {/* ---------- App chrome ---------- */}
        <div className="flex items-center justify-between gap-3 border-b border-white/6 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <FloMark className="h-5 w-auto" />
          </div>

          <div className="hidden items-center gap-0.5 rounded-full border border-white/8 bg-white/[0.03] p-0.5 md:flex">
            {TABS.map((tab, index) => (
              <span
                key={tab}
                className={`cursor-default rounded-full px-3 py-1 text-[0.6875rem] transition-colors duration-300 ${
                  index === 0
                    ? "bg-white/8 text-mist-50"
                    : "text-mist-400 hover:text-mist-200"
                }`}
              >
                {tab}
              </span>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <IconButton>
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none">
                <circle
                  cx="7"
                  cy="7"
                  r="4.5"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
                <path
                  d="M10.5 10.5 14 14"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </IconButton>
            <IconButton>
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none">
                <path
                  d="M4 6.5a4 4 0 0 1 8 0c0 3 1 4 1 4H3s1-1 1-4Z"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
                <path
                  d="M6.5 13a1.6 1.6 0 0 0 3 0"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
            </IconButton>
            <span className="ml-0.5 grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-flare-400 to-sun-400 font-display text-[0.5625rem] font-bold text-ink-900">
              BA
            </span>
          </div>
        </div>

        {/* ---------- Body ---------- */}
        <div className="px-4 pb-5 pt-4 sm:px-5 sm:pb-6 sm:pt-5">
          <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-5">
            <div className="min-w-[240px] flex-1">
              <h3 className="font-display text-lg font-bold sm:text-xl">
                Assalam-o-alaikum,{" "}
                <span className="text-iris-300">Bilal</span>
              </h3>

              <div className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                {METERS.map((meter, index) => (
                  <Meter key={meter.label} {...meter} delay={index * 110} />
                ))}
              </div>
            </div>

            <div className="flex gap-5 sm:gap-7">
              {STATS.map((stat, index) => (
                <div key={stat.label}>
                  <span
                    className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-[1px] text-[0.5rem] font-semibold ${
                      stat.up
                        ? "bg-mint-400/15 text-mint-400"
                        : "bg-flare-400/15 text-flare-400"
                    }`}
                  >
                    {stat.delta}
                  </span>
                  <p className="font-display text-2xl font-bold leading-tight text-mist-50 sm:text-[1.75rem]">
                    <CountUp to={stat.value} delay={300 + index * 140} />
                  </p>
                  <p className="text-[0.625rem] text-mist-400">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ---------- Lower row ---------- */}
          <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.9fr)_minmax(0,1fr)]">
            {/* Order flow */}
            <div className="rounded-2xl border border-white/6 bg-white/[0.02] p-3.5">
              <h4 className="font-display text-[0.8125rem] font-semibold text-mist-200">
                Bill flow
              </h4>
              <ul className="mt-3 grid gap-2">
                {FLOW.map((row) => (
                  <li
                    key={row.label}
                    className="flex items-center justify-between rounded-xl border border-white/6 bg-ink-800/80 px-2.5 py-2 transition-colors duration-300 hover:border-iris-300/25 hover:bg-ink-750"
                  >
                    <span className="flex items-center gap-1.5 text-[0.6875rem] text-mist-300">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: row.tint }}
                      />
                      {row.label}
                    </span>
                    <span className="font-display text-[0.6875rem] font-semibold text-mist-100">
                      <CountUp to={row.count} delay={600} />
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[0.5625rem] leading-relaxed text-mist-500">
                Billing time dropped 14% this week after the barcode scanner
                went in.
              </p>
            </div>

            {/* Chart */}
            <div className="rounded-2xl border border-white/6 bg-white/[0.02] p-3.5">
              <SalesChart />
            </div>

            {/* Stock alert */}
            <div className="relative flex flex-col overflow-hidden rounded-2xl border border-iris-300/25 bg-gradient-to-br from-iris-500 to-iris-700 p-3.5">
              <div
                aria-hidden
                className="absolute -right-6 -top-8 h-24 w-24 rounded-full bg-white/20 blur-2xl"
              />
              <div className="relative flex h-full flex-col">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="font-display text-[0.8125rem] font-semibold text-white">
                    Stock alert
                  </h4>
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/20 text-white transition-transform duration-500 ease-[var(--ease-out-back)] hover:rotate-45">
                    <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none">
                      <path
                        d="M3 9 9 3M9 3H4.5M9 3v4.5"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </div>

                <p className="mt-2 text-[0.5625rem] leading-relaxed text-white/80">
                  Six items are below par across two branches. Order now so
                  the fast movers are on the shelf before evening.
                </p>

                <div className="mt-3 grid gap-1.5">
                  {[
                    { label: "To order", count: 3 },
                    { label: "Suppliers", count: 1 },
                    { label: "Below par", count: 4 },
                  ].map((row) => (
                    <div
                      key={row.label}
                      className="flex items-center justify-between rounded-lg bg-white/12 px-2 py-1.5 backdrop-blur-sm"
                    >
                      <span className="text-[0.625rem] text-white/90">
                        {row.label}
                      </span>
                      <span className="grid h-4 w-4 place-items-center rounded-full bg-white font-display text-[0.5rem] font-bold text-iris-700">
                        {row.count}
                      </span>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  className="mt-auto w-full rounded-lg border border-white/25 bg-white/12 px-2 py-1.5 font-display text-[0.625rem] font-semibold text-white transition-colors duration-300 hover:bg-white/20"
                >
                  Draft purchase order
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Tilt>
  );
}

function IconButton({ children }: { children: React.ReactNode }) {
  return (
    <span className="grid h-6 w-6 place-items-center rounded-full border border-white/8 bg-white/[0.03] text-mist-400 transition-colors duration-300 hover:border-iris-300/35 hover:text-mist-100">
      {children}
    </span>
  );
}

function Meter({
  label,
  value,
  tint,
  delay,
}: {
  label: string;
  value: number;
  tint: string;
  delay: number;
}) {
  return (
    <div>
      <p className="text-[0.5625rem] text-mist-500">{label}</p>
      <div className="mt-1.5 h-4 overflow-hidden rounded-full bg-white/6">
        <div
          className="flex h-full items-center justify-center rounded-full font-display text-[0.5rem] font-bold text-white"
          style={{
            width: `${value}%`,
            minWidth: "2.25rem",
            backgroundColor: tint,
            animation: `bar-grow 1.1s var(--ease-out-soft) ${delay + 500}ms both`,
            transformOrigin: "left",
          }}
        >
          {value}%
        </div>
      </div>
    </div>
  );
}
