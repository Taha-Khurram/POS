import Link from "next/link";

import { Reveal } from "@/components/motion/reveal";

const PILLARS = [
  { title: "Billing", copy: "Cash or card, a numbered receipt either way" },
  { title: "Stock", copy: "Your own list, with what each line costs you" },
  { title: "Customers", copy: "The regulars, and what they buy" },
  { title: "The books", copy: "Every bill findable, every drawer countable" },
];

/** Traces run from the card block (left edge) into the chip's left pads. */
const TRACES = [
  "M0 96 H60 Q76 96 76 112 V158 Q76 174 92 174 H108",
  "M0 152 H92 Q108 152 108 168 V190 H108",
  "M0 252 H92 Q108 252 108 236 V214 H108",
  "M0 308 H60 Q76 308 76 292 V246 Q76 230 92 230 H108",
];

/** Short stubs leaving the right side of the chip, PCB-style. */
const STUBS = [
  "M292 168 H340 Q356 168 356 152 V120",
  "M292 190 H372 Q388 190 388 174 V148",
  "M292 212 H372 Q388 212 388 228 V254",
  "M292 234 H340 Q356 234 356 250 V284",
];

export function UnifiedPlatform() {
  return (
    <section className="section">
      <div
        aria-hidden
        className="glow left-1/2 top-24 h-72 w-[36rem] -translate-x-1/2 bg-iris-700/15"
      />

      <div className="shell relative">
        <div className="mx-auto max-w-2xl text-center">
          <Reveal as="h2" className="heading">
            One system for the whole shop
          </Reveal>
          <Reveal as="p" className="lede mx-auto mt-4 max-w-lg" delay={120}>
            From the first bill of the morning to the cash count at closing —
            one item list, one customer list, and one set of numbers, so the
            counter and the back office never disagree.
          </Reveal>
        </div>

        <div className="mt-12 grid items-center gap-10 lg:mt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-0">
          {/* ---------- Pillar cards ---------- */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {PILLARS.map((pillar, index) => (
              <Reveal
                key={pillar.title}
                className={`panel card-lift spotlight relative overflow-hidden rounded-2xl p-5 ${
                  // Odd cards ride lower, echoing the staggered mock.
                  index % 2 === 1 ? "sm:mt-8" : ""
                }`}
                delay={index * 110}
                x={-24}
                y={16}
              >
                <h3 className="font-display text-[0.9375rem] font-semibold">
                  {pillar.title}
                </h3>
                <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-mist-400">
                  {pillar.copy}
                </p>
              </Reveal>
            ))}
          </div>

          {/* ---------- Chip + traces ---------- */}
          {/* Hugs the left of its column on desktop so traces meet the cards */}
          <Reveal
            className="relative mx-auto aspect-square w-full max-w-[420px] lg:ml-0 lg:mr-auto"
            delay={220}
            scale={0.94}
          >
            <svg
              viewBox="0 0 400 400"
              className="absolute inset-0 h-full w-full"
              aria-hidden
            >
              <defs>
                <linearGradient id="trace-base" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#3020a4" stopOpacity="0.15" />
                  <stop offset="100%" stopColor="#9b85ea" stopOpacity="0.55" />
                </linearGradient>
              </defs>

              {[...TRACES, ...STUBS].map((d, index) => (
                <g key={d}>
                  {/* Resting copper */}
                  <path
                    d={d}
                    fill="none"
                    stroke="url(#trace-base)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  {/* Signal travelling toward the chip */}
                  <path
                    d={d}
                    fill="none"
                    stroke="#dcd4ff"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeDasharray="16 300"
                    style={{
                      animation: `trace 3.4s linear ${index * 0.42}s infinite`,
                      ["--trace-len" as string]: "316",
                    }}
                  />
                </g>
              ))}

              {/* Solder pads at the line ends */}
              {[96, 152, 252, 308].map((y) => (
                <circle key={y} cx="2" cy={y} r="2.5" fill="#9b85ea" opacity="0.7" />
              ))}
            </svg>

            {/* The chip itself stays real DOM so the label renders crisply */}
            <div className="absolute left-1/2 top-1/2 h-[46%] w-[46%] -translate-x-1/2 -translate-y-1/2">
              <div
                aria-hidden
                className="glow inset-[-30%] animate-breathe bg-iris-500/40"
              />
              <div className="relative grid h-full w-full place-items-center overflow-hidden rounded-[22%] border border-iris-200/45 bg-gradient-to-br from-iris-400 via-iris-500 to-iris-700 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.35),0_24px_60px_-20px_rgb(79_70_229/0.9)]">
                <div
                  aria-hidden
                  className="absolute inset-0 bg-[radial-gradient(circle_at_30%_22%,rgb(255_255_255/0.45),transparent_60%)]"
                />
                {/* One chip, because there is one database under all four
                    cards — not four products with an integration between. */}
                <span className="relative font-display text-[clamp(1.75rem,5vw,2.75rem)] font-extrabold tracking-tight text-white">
                  Flo
                </span>
              </div>
            </div>
          </Reveal>
        </div>

        <Reveal className="mt-12 flex justify-center" delay={160}>
          <Link href="/products" className="btn btn-ghost">
            Explore the platform
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
