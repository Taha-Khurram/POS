import type { Metadata } from "next";

import { Reveal } from "@/components/motion/reveal";
import { PageHeader } from "@/components/site/page-header";
import { DemoForm } from "./demo-form";

export const metadata: Metadata = {
  title: "Book a demo",
  description:
    "See Flo running on your own menu. Thirty minutes with someone who has set up a counter before.",
};

const EXPECT = [
  {
    title: "Thirty minutes, your menu",
    copy: "Send us a menu or a spreadsheet beforehand and we will have it loaded when the call starts.",
  },
  {
    title: "An operator, not a script",
    copy: "Everyone who runs demos here has worked a counter. Ask the awkward questions.",
  },
  {
    title: "A real number at the end",
    copy: "Registers, hardware, and processing priced for your floor — in writing, the same day.",
  },
];

export default function DemoPage() {
  return (
    <>
      <PageHeader
        eyebrow="Book a demo"
        title={
          <>
            See Flo running{" "}
            <span className="text-gradient">on your own menu</span>
          </>
        }
        lede="Tell us what you run and we will set the demo up around it — no generic sandbox, no slide deck."
      />

      <section className="section pt-4">
        <div className="shell">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,0.85fr)] lg:gap-8">
            <Reveal y={26}>
              <DemoForm />
            </Reveal>

            <Reveal className="grid content-start gap-4" delay={140} x={24}>
              {EXPECT.map((item) => (
                <div
                  key={item.title}
                  className="glass card-lift rounded-2xl p-6"
                >
                  <h2 className="font-display text-[0.9375rem] font-semibold">
                    {item.title}
                  </h2>
                  <p className="mt-2 text-[0.8125rem] leading-relaxed text-mist-400">
                    {item.copy}
                  </p>
                </div>
              ))}

              <div className="relative overflow-hidden rounded-2xl border border-iris-200/25 bg-gradient-to-br from-iris-500 to-iris-700 p-6 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.28),0_28px_60px_-32px_rgb(79_70_229/0.85)]">
                <div
                  aria-hidden
                  className="absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/20 blur-3xl"
                />
                <p className="relative font-display text-[0.9375rem] font-semibold text-white">
                  In a hurry?
                </p>
                <p className="relative mt-2 text-[0.8125rem] leading-relaxed text-white/80">
                  Call the sales line on +1 555 0134, weekdays 8am–6pm ET, and
                  we will do it live.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>
    </>
  );
}
