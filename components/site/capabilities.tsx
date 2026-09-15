import { Reveal } from "@/components/motion/reveal";

import { FloMark } from "./flo-mark";

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
                  Every branch,
                  <br />
                  on one screen,
                  <br />
                  from anywhere.
                </h3>
                <p className="mt-4 max-w-[16rem] text-[0.8125rem] leading-relaxed text-white/80">
                  Sales, cash, stock, and udhaar across all your outlets —
                  live on your phone, whether you are at the shop or not.
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

            {/* Tilted product preview */}
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
                <div className="w-[118%] translate-x-[8%] translate-y-[6%] [transform:rotateX(16deg)_rotateY(-19deg)_rotateZ(7deg)] transition-transform duration-[900ms] ease-[var(--ease-out-soft)] hover:[transform:rotateX(9deg)_rotateY(-11deg)_rotateZ(4deg)]">
                  <MiniDashboard />
                </div>
              </div>
            </Reveal>
          </div>

          {/* ---------- Row two ---------- */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.84fr)]">
            {/* Customer updates */}
            <Reveal
              className="panel relative min-h-[300px] overflow-hidden rounded-[22px] p-7"
              y={34}
            >
              <div
                aria-hidden
                className="glow -left-16 top-6 h-56 w-56 bg-iris-600/22"
              />

              <div className="relative grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] sm:items-end sm:gap-4">
                <div className="order-2 sm:order-1">
                  <h3 className="font-display text-[1.3rem] font-bold leading-tight sm:text-[1.5rem]">
                    Updates on WhatsApp,
                    <br />
                    where customers read.
                  </h3>
                  <p className="mt-3 max-w-[18rem] text-[0.8125rem] leading-relaxed text-mist-400">
                    Order ready, parcel on the way, udhaar reminder — sent from
                    the counter, in Urdu or English.
                  </p>
                </div>

                <div className="order-1 grid gap-2.5 sm:order-2">
                  {MESSAGES.map((message, index) => (
                    <Reveal
                      key={message.id}
                      className="glass rounded-2xl p-3 transition-transform duration-500 ease-[var(--ease-out-soft)] hover:-translate-y-1"
                      delay={200 + index * 130}
                      x={26}
                      y={10}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className="rounded-full px-2 py-[3px] font-display text-[0.625rem] font-semibold"
                          style={{
                            backgroundColor: message.tint,
                            color: "#fff",
                          }}
                        >
                          {message.status}
                        </span>
                        <span className="text-[0.5625rem] text-mist-500">
                          {message.id} · {message.ago}
                        </span>
                      </div>

                      <p className="mt-2 text-[0.6875rem] leading-relaxed text-mist-300">
                        {message.body}
                      </p>

                      <div className="mt-2.5 flex items-center gap-2">
                        <span
                          className="grid h-5 w-5 place-items-center rounded-full font-display text-[0.5rem] font-bold text-ink-900"
                          style={{ background: message.avatar }}
                        >
                          {message.initials}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[0.5625rem] font-medium text-mist-200">
                            {message.name}
                          </span>
                          <span className="block truncate text-[0.5rem] text-mist-500">
                            {message.contact}
                          </span>
                        </span>
                      </div>
                    </Reveal>
                  ))}
                </div>
              </div>
            </Reveal>

            {/* AI manager */}
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
                  Flo AI orders stock like your best munshi —{" "}
                  <span className="text-iris-600">on its own.</span>
                </h3>
                <p className="mt-3 text-[0.8125rem] leading-relaxed text-mist-400">
                  Sees what is running out before Eid, drafts the purchase
                  order, and flags the supplier who quietly raised his rate.
                </p>
              </div>

              <div className="relative mt-7 flex items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-iris-200/40 bg-gradient-to-br from-iris-400 to-iris-700 font-display text-[0.6875rem] font-extrabold text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.3)]">
                  AI
                </span>
                <div className="min-w-0 flex-1">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-iris-400 to-iris-200"
                      style={{
                        width: "72%",
                        transformOrigin: "left",
                        animation:
                          "bar-grow 1.4s var(--ease-out-soft) 0.5s both",
                      }}
                    />
                  </div>
                  <p className="mt-2 text-[0.625rem] text-mist-500">
                    6 orders drafted · 2 awaiting your approval
                  </p>
                </div>
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

const MESSAGES = [
  {
    id: "#1042",
    status: "Ready",
    tint: "#3b28cc",
    ago: "2m",
    body: "Your parcel is ready at the counter — thanks for waiting.",
    name: "Bilal Ahmed",
    contact: "+92 300 842 1176",
    initials: "BA",
    avatar: "linear-gradient(135deg,#f472b6,#fbbf24)",
  },
  {
    id: "#1043",
    status: "Preparing",
    tint: "#6f52dc",
    ago: "7m",
    body: "Karahi is on the fire — about ten minutes for your table.",
    name: "Ayesha Siddiqui",
    contact: "+92 321 455 9032",
    initials: "AS",
    avatar: "linear-gradient(135deg,#34d399,#9b85ea)",
  },
];

/** Static, lightweight stand-in for the product UI inside the bento cell. */
function MiniDashboard() {
  return (
    <div className="panel overflow-hidden rounded-xl shadow-[0_40px_90px_-40px_rgb(33_21_102/0.30)]">
      <div className="flex items-center justify-between border-b border-ink-700 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <FloMark className="h-3.5 w-auto" />
        </div>
        <div className="flex items-center gap-2 text-[0.4375rem] text-mist-500">
          <span className="rounded-full bg-ink-800 px-1.5 py-[2px] text-mist-200">
            Overview
          </span>
          <span>Bills</span>
          <span>Stock</span>
          <span>Khata</span>
        </div>
        <span className="h-3 w-3 rounded-full bg-gradient-to-br from-flare-400 to-sun-400" />
      </div>

      <div className="p-3">
        <p className="font-display text-[0.6875rem] font-bold text-mist-50">
          Assalam-o-alaikum, <span className="text-iris-600">Bilal</span>
        </p>

        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {[
            { w: "22%", c: "var(--color-iris-700)" },
            { w: "34%", c: "var(--color-iris-600)" },
            { w: "46%", c: "var(--color-iris-500)" },
            { w: "18%", c: "var(--color-mist-500)" },
          ].map((bar) => (
            <div key={bar.c} className="h-2 rounded-full bg-ink-800">
              <div
                className="h-full rounded-full"
                style={{ width: bar.w, backgroundColor: bar.c }}
              />
            </div>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-2">
          <div className="rounded-lg border border-ink-700 bg-ink-900 p-2">
            {["Paid", "Returns", "Udhaar"].map((row) => (
              <div
                key={row}
                className="mt-1 flex items-center justify-between rounded bg-ink-800/70 px-1.5 py-1 first:mt-0"
              >
                <span className="text-[0.4375rem] text-mist-400">{row}</span>
                <span className="text-[0.4375rem] font-semibold text-mist-50">
                  {row === "Paid" ? "1234" : row === "Returns" ? "3" : "24"}
                </span>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-ink-700 bg-ink-900 p-2">
            <svg viewBox="0 0 160 54" className="h-full w-full" aria-hidden>
              <path
                d="M2 40 C 20 34, 30 16, 46 22 S 74 44, 90 30 S 118 8, 134 18 S 152 30, 158 24"
                fill="none"
                stroke="var(--color-iris-600)"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <path
                d="M2 22 C 22 30, 34 42, 52 36 S 76 16, 94 24 S 122 40, 158 34"
                fill="none"
                stroke="var(--color-mist-400)"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
