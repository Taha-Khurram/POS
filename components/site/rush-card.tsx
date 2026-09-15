import Link from "next/link";

import { Reveal } from "@/components/motion/reveal";

/**
 * Labels hang from strings that run off the top of the card and swing gently.
 * `left` / `drop` are hand-placed to match the scattered look of the mock.
 */
const TAGS = [
  { text: "Iftar rush handled", left: 32, drop: 92, duration: 6.2, delay: 0.6, accent: true },
  { text: "Raast QR cleared", left: 76, drop: 140, duration: 6.6, delay: 0.3, accent: false },
  { text: "FBR invoice filed", left: 12, drop: 186, duration: 5.4, delay: 0, accent: false },
  { text: "Udhaar written up", left: 52, drop: 232, duration: 5.1, delay: 0.9, accent: false },
  { text: "Cash drawer tallied", left: 24, drop: 276, duration: 5.8, delay: 1.1, accent: false },
];

export function RushCard() {
  return (
    <section className="relative pb-4">
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
                The rush won&rsquo;t
                <br />
                wait for the light
              </h2>
              <p className="lede mt-4 max-w-sm">
                Iftar, the Sunday dinner crowd, the 7pm kiryana queue. Flo keeps
                billing when the power cuts and the internet drops, then syncs
                every invoice the moment it&rsquo;s back.
              </p>
              <Link href="/solutions" className="btn btn-ghost btn-sm mt-6">
                See Flo by business type
              </Link>
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
                      className="w-px shrink-0 bg-gradient-to-b from-ink-700 via-iris-400/40 to-iris-500/60"
                      style={{ height: tag.drop }}
                    />
                    {/* Bead where the string meets the tag */}
                    <span
                      aria-hidden
                      className="-mb-1 h-1.5 w-1.5 rounded-full bg-iris-500 shadow-[0_0_10px_2px_rgb(111_82_220/0.35)]"
                    />
                    <span
                      className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 font-display text-[0.6875rem] font-medium transition-transform duration-500 ease-[var(--ease-out-back)] hover:scale-105 sm:text-xs ${
                        tag.accent
                          ? "border border-iris-200/40 bg-iris-600 text-white shadow-[0_10px_28px_-10px_rgb(99_102_241/0.9)]"
                          : "border border-ink-600 bg-ink-750/85 text-mist-200 shadow-[0_10px_26px_-14px_rgb(33_21_102/0.25)] backdrop-blur-sm"
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
