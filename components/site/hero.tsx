import Link from "next/link";

import { Starfield } from "./starfield";
import { DashboardMock } from "./dashboard-mock";

/** Above-the-fold copy animates on load, so entrances are plain CSS delays. */
const entrance = (delay: number) => ({
  animation: `fade-up 1s var(--ease-out-soft) ${delay}ms both`,
});

export function Hero() {
  return (
    <section id="top" className="relative isolate overflow-hidden">
      {/* ---------- Ambient background ---------- */}
      <div aria-hidden className="absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(120%_75%_at_50%_-10%,#12132b_0%,#08080f_45%,#04040a_100%)]" />

        <Starfield className="absolute inset-0 h-full w-full" />

        {/* The comet: a hard core streak, a wide diffuse wedge, and a hot head */}
        <div
          className="absolute -left-[24%] top-[4%] h-[3px] w-[82%] origin-left rotate-[33deg] blur-[1px]"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgb(199 210 254 / 0.25) 14%, rgb(255 255 255 / 0.7) 48%, rgb(255 255 255 / 1) 68%, rgb(199 210 254 / 0.5) 88%, transparent)",
          }}
        />
        <div
          className="absolute -left-[28%] top-[-2%] h-[260px] w-[92%] origin-left rotate-[33deg] blur-[64px]"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgb(99 102 241 / 0.30) 26%, rgb(165 180 252 / 0.50) 62%, rgb(129 140 248 / 0.18) 84%, transparent)",
          }}
        />
        <div className="glow left-[26%] top-[30%] h-40 w-40 bg-iris-200/45 blur-[52px]" />
        <div className="glow left-[42%] top-[16%] h-[260px] w-[260px] animate-breathe bg-iris-500/25" />

        {/* Vignette so the panel below reads as emerging from the dark */}
        <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-b from-transparent to-ink-950" />
      </div>

      <div className="shell pt-36 sm:pt-40 lg:pt-44">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="display" style={entrance(80)}>
            <span className="text-gradient">Rush hour</span> ready.
            <br className="hidden sm:block" /> FBR ready.
          </h1>

          <p
            className="lede mx-auto mt-6 max-w-xl"
            style={entrance(260)}
          >
            The point of sale built for Pakistani counters — FBR digital
            invoicing, udhaar khata, cash, card, Raast and wallet payments, all
            in one screen your staff learns in a day.
          </p>

          <div
            className="mt-9 flex flex-wrap items-center justify-center gap-3"
            style={entrance(420)}
          >
            <Link href="/demo" className="btn btn-primary">
              Book a demo
            </Link>
            <Link href="/pricing" className="btn btn-ghost">
              See pricing
            </Link>
          </div>
        </div>

        {/* ---------- Product window ---------- */}
        <div
          className="relative mx-auto mt-16 max-w-[980px] sm:mt-20"
          style={entrance(600)}
        >
          <DashboardMock />
        </div>
      </div>
    </section>
  );
}
