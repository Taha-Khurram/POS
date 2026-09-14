import Link from "next/link";

import { Reveal } from "@/components/motion/reveal";

export function Cta() {
  return (
    <section className="relative isolate overflow-hidden pt-8 pb-28 sm:pb-36">
      {/* ---------- Light pool ---------- */}
      <div aria-hidden className="absolute inset-0 -z-10">
        <div className="absolute inset-x-0 bottom-0 h-[78%] bg-[radial-gradient(80%_100%_at_50%_100%,#312e81_0%,#1b1b45_38%,#0a0a16_70%,transparent_100%)]" />
        <div className="stars absolute inset-0 opacity-80" />

        {/* Beam behind the button */}
        <div className="glow bottom-[26%] left-1/2 h-56 w-[34rem] -translate-x-1/2 animate-breathe bg-iris-400/30" />
        <div
          className="absolute bottom-[30%] left-1/2 h-[3px] w-[46rem] max-w-[92vw] -translate-x-1/2 blur-[2px]"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgb(173 215 246 / 0.65) 45%, rgb(255 255 255 / 0.85) 50%, rgb(173 215 246 / 0.65) 55%, transparent)",
          }}
        />

        {/* Drifting motes rising through the light */}
        {MOTES.map((mote, index) => (
          <span
            key={index}
            className="absolute rounded-full bg-iris-200"
            style={{
              left: `${mote.x}%`,
              bottom: `${mote.y}%`,
              height: mote.r,
              width: mote.r,
              animation: `twinkle ${mote.dur}s ease-in-out ${mote.delay}s infinite`,
            }}
          />
        ))}
      </div>

      <div className="shell relative text-center">
        <Reveal as="p" className="font-display text-xl font-bold text-mist-50">
          Flo
        </Reveal>

        <Reveal
          as="h2"
          className="mt-3 font-display text-[clamp(2.1rem,6.4vw,4rem)] font-bold leading-[1.05]"
          delay={100}
        >
          Start Billing Today
        </Reveal>

        <Reveal as="p" className="lede mx-auto mt-5 max-w-md" delay={200}>
          Send us your price list or menu and we&rsquo;ll load it before the
          call — you&rsquo;ll see Flo ringing up your own items, in Urdu or
          English.
        </Reveal>

        <Reveal
          className="mt-10 flex flex-wrap items-center justify-center gap-3"
          delay={300}
          scale={0.94}
        >
          <Link href="/demo" className="btn btn-primary px-10 py-4 text-base">
            Book a demo
          </Link>
          <Link href="/pricing" className="btn btn-ghost px-8 py-4 text-base">
            Compare plans
          </Link>
        </Reveal>
      </div>
    </section>
  );
}

const MOTES = [
  { x: 18, y: 12, r: 3, dur: 4.2, delay: 0 },
  { x: 27, y: 26, r: 2, dur: 3.6, delay: 0.7 },
  { x: 36, y: 8, r: 2, dur: 4.8, delay: 1.3 },
  { x: 44, y: 34, r: 3, dur: 3.9, delay: 0.4 },
  { x: 55, y: 18, r: 2, dur: 4.4, delay: 1 },
  { x: 63, y: 30, r: 4, dur: 5.2, delay: 0.2 },
  { x: 72, y: 10, r: 2, dur: 3.7, delay: 1.5 },
  { x: 81, y: 24, r: 3, dur: 4.6, delay: 0.9 },
  { x: 88, y: 14, r: 2, dur: 4.1, delay: 0.5 },
  { x: 12, y: 32, r: 2, dur: 4.9, delay: 1.1 },
];
