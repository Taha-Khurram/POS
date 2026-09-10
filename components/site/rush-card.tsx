import { Reveal } from "@/components/motion/reveal";

/**
 * Labels hang from strings that run off the top of the card and swing gently.
 * `left` / `drop` are hand-placed to match the scattered look of the mock.
 */
const TAGS = [
  { text: "Line moved fast", left: 34, drop: 92, duration: 6.2, delay: 0.6, accent: true },
  { text: "Reader ready", left: 76, drop: 140, duration: 6.6, delay: 0.3, accent: false },
  { text: "Every ticket paid", left: 14, drop: 186, duration: 5.4, delay: 0, accent: false },
  { text: "Rush handled", left: 52, drop: 232, duration: 5.1, delay: 0.9, accent: false },
  { text: "Drawer balanced", left: 26, drop: 276, duration: 5.8, delay: 1.1, accent: false },
];

export function RushCard() {
  return (
    <section id="solutions" className="relative pb-4">
      <div className="shell">
        <Reveal
          className="panel rim relative overflow-hidden rounded-[24px] sm:rounded-[32px]"
          y={44}
          scale={0.97}
        >
          <div aria-hidden className="stars absolute inset-0 opacity-60" />
          <div
            aria-hidden
            className="glow -right-10 -top-24 h-72 w-72 animate-breathe bg-iris-600/22"
          />

          <div className="relative grid items-center gap-8 p-7 sm:p-10 lg:grid-cols-2 lg:gap-6 lg:p-14">
            <div>
              <h2 className="heading">
                Rushes happen
                <br />
                every day
              </h2>
              <p className="lede mt-4 max-w-sm">
                The lunch rush is inevitable. With the right register, the chaos
                isn&rsquo;t — orders land, cards clear, and the line keeps
                moving.
              </p>
            </div>

            {/* Hanging tags */}
            <div className="relative -mt-7 h-[320px] sm:-mt-10 lg:-mt-14 lg:h-[330px]">
              {TAGS.map((tag, index) => (
                <Reveal
                  key={tag.text}
                  className="absolute top-0 origin-top"
                  style={{ left: `${tag.left}%` }}
                  delay={index * 120}
                  y={-24}
                  blur={4}
                >
                  <span
                    className="flex origin-top flex-col items-center"
                    style={{
                      animation: `swing ${tag.duration}s var(--ease-in-out-soft) ${tag.delay}s infinite`,
                    }}
                  >
                    {/* String */}
                    <span
                      aria-hidden
                      className="w-px shrink-0 bg-gradient-to-b from-white/5 via-iris-300/25 to-iris-300/45"
                      style={{ height: tag.drop }}
                    />
                    {/* Bead where the string meets the tag */}
                    <span
                      aria-hidden
                      className="-mb-1 h-1.5 w-1.5 rounded-full bg-iris-200 shadow-[0_0_10px_2px_rgb(165_180_252/0.55)]"
                    />
                    <span
                      className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 font-display text-[0.6875rem] font-medium transition-transform duration-500 ease-[var(--ease-out-back)] hover:scale-105 sm:text-xs ${
                        tag.accent
                          ? "border border-iris-200/40 bg-iris-600 text-white shadow-[0_10px_28px_-10px_rgb(99_102_241/0.9)]"
                          : "border border-white/10 bg-ink-750/85 text-mist-200 shadow-[0_10px_26px_-14px_rgb(0_0_0/0.9)] backdrop-blur-sm"
                      }`}
                    >
                      {tag.text}
                    </span>
                  </span>
                </Reveal>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
