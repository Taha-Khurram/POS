import Image from "next/image";

import { Reveal } from "@/components/motion/reveal";

/**
 * Four claims, and each one is a thing the software does rather than a thing a
 * category does. They were chosen the same way: read the code, take the part a
 * shopkeeper would care about, and say only that.
 */
export function Capabilities() {
  return (
    <section className="section pt-0">
      <div className="shell relative">
        <Reveal as="h2" className="heading mx-auto max-w-lg text-center">
          Everything the owner wants to see
        </Reveal>

        <div className="mt-12 grid gap-4 lg:mt-16">
          {/* ---------- Row one ---------- */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,0.84fr)_minmax(0,1.4fr)]">
            {/* Gradient hero cell */}
            <Reveal
              className="relative flex min-h-[290px] flex-col justify-between overflow-hidden rounded-[22px] border border-iris-200/25 bg-gradient-to-br from-iris-500 via-iris-600 to-iris-700 p-7 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.28),0_30px_70px_-34px_rgb(79_70_229/0.85)]"
              y={34}
            >
              <div
                aria-hidden
                className="absolute -left-10 -top-16 h-52 w-52 rounded-full bg-white/20 blur-3xl"
              />

              <div className="relative">
                <h3 className="font-display text-[1.4rem] font-bold leading-tight text-white sm:text-[1.6rem]">
                  The day&rsquo;s figures,
                  <br />
                  before you
                  <br />
                  reach home.
                </h3>
                <p className="mt-4 max-w-[16rem] text-[0.8125rem] leading-relaxed text-white/80">
                  Sales, profit, what it cost you and the margin between them —
                  for today, this month, or any range you pick. On the phone in
                  your pocket, not only on the shop computer.
                </p>
              </div>

              {/* Sparkle field, densest toward the lower-right */}
              <div aria-hidden className="relative h-24">
                {SPARKLES.map((sparkle, index) => (
                  <span
                    key={index}
                    className="absolute rounded-full bg-white"
                    style={{
                      left: `${sparkle.x}%`,
                      top: `${sparkle.y}%`,
                      height: sparkle.r,
                      width: sparkle.r,
                      animation: `twinkle ${sparkle.dur}s ease-in-out ${sparkle.delay}s infinite`,
                    }}
                  />
                ))}
              </div>
            </Reveal>

            {/* Tilted product preview — the real console, photographed */}
            <Reveal
              className="panel relative min-h-[290px] overflow-hidden rounded-[22px]"
              delay={110}
              y={34}
            >
              <div aria-hidden className="stars absolute inset-0 opacity-70" />
              <div
                aria-hidden
                className="glow -right-16 -top-20 h-64 w-64 bg-iris-400/25"
              />

              <div className="absolute inset-0 grid place-items-center [perspective:1200px]">
                <div className="w-[118%] translate-x-[8%] translate-y-[6%] overflow-hidden rounded-xl border border-ink-700 shadow-[0_40px_90px_-40px_rgb(33_21_102/0.35)] [transform:rotateX(16deg)_rotateY(-19deg)_rotateZ(7deg)] transition-transform duration-[900ms] ease-[var(--ease-out-soft)] hover:[transform:rotateX(9deg)_rotateY(-11deg)_rotateZ(4deg)]">
                  <Image
                    src="/shots/dashboard-light.png"
                    width={2560}
                    height={1640}
                    sizes="(min-width: 1024px) 700px, 100vw"
                    className="block h-auto w-full"
                    alt="The Flo dashboard, showing sales, profit, cost of goods and margin for the last seven days."
                  />
                </div>
              </div>
            </Reveal>
          </div>

          {/* ---------- Row two ---------- */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.84fr)]">
            {/* What comes off the roll */}
            <Reveal
              className="panel relative min-h-[300px] overflow-hidden rounded-[22px] p-7"
              y={34}
            >
              <div
                aria-hidden
                className="glow -left-16 top-6 h-56 w-56 bg-iris-600/22"
              />

              <div className="relative grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] sm:items-center sm:gap-4">
                <div className="order-2 sm:order-1">
                  <h3 className="font-display text-[1.3rem] font-bold leading-tight sm:text-[1.5rem]">
                    A receipt that
                    <br />
                    cannot be argued with.
                  </h3>
                  <p className="mt-3 max-w-[19rem] text-[0.8125rem] leading-relaxed text-mist-400">
                    Each counter runs its own numbered series, claimed in the
                    same instant the sale is saved — so there are no holes and
                    two tablets on one till can never print the same number.
                  </p>
                </div>

                <div className="order-1 grid gap-2.5 sm:order-2">
                  {ROLLS.map((roll, index) => (
                    <Reveal
                      key={roll.number}
                      className="glass rounded-2xl px-4 py-3"
                      delay={200 + index * 130}
                      x={26}
                      y={10}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono text-[0.6875rem] text-mist-200">
                          {roll.number}
                        </span>
                        <span
                          className="rounded-full px-2 py-[3px] font-display text-[0.5625rem] font-semibold uppercase tracking-[0.1em]"
                          style={{ backgroundColor: roll.tint, color: "#fff" }}
                        >
                          {roll.stamp}
                        </span>
                      </div>
                      <p className="mt-2 text-[0.6875rem] leading-relaxed text-mist-400">
                        {roll.note}
                      </p>
                    </Reveal>
                  ))}
                </div>
              </div>
            </Reveal>

            {/* The price the shop set */}
            <Reveal
              className="panel spotlight relative flex min-h-[300px] flex-col justify-between overflow-hidden rounded-[22px] p-7"
              delay={110}
              y={34}
            >
              <div
                aria-hidden
                className="glow -bottom-20 right-0 h-52 w-52 animate-breathe bg-iris-500/25"
              />

              <div className="relative">
                <h3 className="font-display text-[1.3rem] font-bold leading-tight sm:text-[1.45rem]">
                  Nobody types a price{" "}
                  <span className="text-iris-600">into a bill.</span>
                </h3>
                <p className="mt-3 text-[0.8125rem] leading-relaxed text-mist-400">
                  The tablet sends item numbers and quantities. The rate, the
                  tax and the total are worked out again on the server from your
                  own list, every single time — and the cost of each line is
                  stamped on it as it sells, so last month&rsquo;s profit does
                  not move when a supplier raises his rate next week.
                </p>
              </div>

              <div className="relative mt-7 grid gap-2">
                {GUARDS.map((guard) => (
                  <div
                    key={guard}
                    className="flex items-start gap-2.5 text-[0.75rem] leading-relaxed text-mist-300"
                  >
                    <span
                      aria-hidden
                      className="mt-[0.4rem] h-1.5 w-1.5 shrink-0 rounded-full bg-mint-400"
                    />
                    {guard}
                  </div>
                ))}
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}

const SPARKLES = [
  { x: 12, y: 54, r: 2, dur: 3.4, delay: 0 },
  { x: 26, y: 72, r: 3, dur: 4.2, delay: 0.5 },
  { x: 38, y: 40, r: 2, dur: 3.8, delay: 1.1 },
  { x: 48, y: 80, r: 4, dur: 4.6, delay: 0.2 },
  { x: 57, y: 56, r: 2, dur: 3.2, delay: 0.8 },
  { x: 66, y: 88, r: 3, dur: 4.4, delay: 1.4 },
  { x: 72, y: 34, r: 2, dur: 3.6, delay: 0.6 },
  { x: 80, y: 66, r: 5, dur: 5, delay: 0.1 },
  { x: 88, y: 46, r: 2, dur: 3.9, delay: 1.2 },
  { x: 94, y: 78, r: 3, dur: 4.1, delay: 0.4 },
  { x: 20, y: 30, r: 2, dur: 4.8, delay: 1.6 },
  { x: 60, y: 22, r: 2, dur: 3.5, delay: 0.9 },
];

/** The three things that can be printed, and what each one says about itself. */
const ROLLS = [
  {
    number: "ALM-260919-0034",
    stamp: "Original",
    tint: "#3b28cc",
    note: "Front counter, thirty-fourth bill of the trading day.",
  },
  {
    number: "ALM-260919-0034",
    stamp: "Duplicate",
    tint: "#6f52dc",
    note: "A reprint says so on the paper. A copy that looks original is a bill a customer can present twice.",
  },
  {
    number: "UNSAVED-214703",
    stamp: "Not recorded",
    tint: "#e5484d",
    note: "The connection died mid-sale. The shop keeps selling, and this one is not counted in the takings until it is.",
  },
];

const GUARDS = [
  "A cashier cannot edit a rate into the bill",
  "Discounts only up to the ceiling you set",
  "Every bill records which counter and which person",
];
