import type { Metadata } from "next";

import { Reveal } from "@/components/motion/reveal";
import { PageHeader } from "@/components/site/page-header";
import { DemoForm } from "./demo-form";

export const metadata: Metadata = {
  title: "Book a demo",
  description:
    "See Flo running on your own rate list. Thirty minutes with someone who has set up a counter in Pakistan before.",
};

const EXPECT = [
  {
    title: "Thirty minutes, your rate list",
    copy: "Send a spreadsheet, an old export, or photos of your price board and we will have it loaded before the call starts. You will watch Flo ring up your own items at your own rates.",
  },
  {
    title: "In Urdu or English",
    copy: "Ask the awkward questions in whichever language is easier — including what the software cannot do.",
  },
  {
    title: "What is missing, said out loud",
    copy: "Returns, discounts at the till and offline billing are not built yet. We will tell you on the call rather than let you find out in week two.",
  },
  {
    title: "A real number in rupees",
    copy: "Counters and staff priced out — Rs 5,000 or Rs 10,000 a month, in writing, the same day.",
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
            <span className="text-gradient">on your own rate list</span>
          </>
        }
        lede="Tell us what you run and we will set the demo up around it — your items, your rates, your receipt. No generic sandbox, no slide deck."
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
                  Call or WhatsApp us on +92 300 111 3560, Monday to Saturday
                  9am–9pm PKT, and we will do it live.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>
    </>
  );
}
