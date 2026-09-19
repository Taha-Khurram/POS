import Link from "next/link";

import { Reveal } from "@/components/motion/reveal";

/**
 * What used to sit here was a marquee of six shop names, none of which were
 * customers. A logo wall before the first customer is the cheapest lie a
 * landing page tells and the easiest one to catch, so it is gone.
 *
 * This says the true thing in its place. It should be deleted the week there
 * are real shops to name — with their permission, and with the city they trade
 * in.
 */
export function PreviewBand() {
  return (
    <section
      aria-label="Where Flo is today"
      className="relative py-10 sm:py-14"
    >
      <div className="shell">
        <Reveal className="glass rounded-[20px] px-6 py-5 sm:px-8 sm:py-6" y={18}>
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="mt-[0.4rem] h-2 w-2 shrink-0 rounded-full bg-mint-400 shadow-[0_0_12px_2px_rgb(52_211_153/0.45)]"
              />
              <p className="max-w-2xl text-[0.875rem] leading-relaxed text-mist-300">
                <span className="font-display font-semibold text-mist-50">
                  Flo is in private preview.
                </span>{" "}
                Everything shown on this site is photographed from the working
                software. What is not built yet is on the roadmap with a date
                beside it, not in the sales pitch.
              </p>
            </div>

            <Link href="/roadmap" className="btn btn-ghost btn-sm shrink-0">
              See the roadmap
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
