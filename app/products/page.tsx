import type { Metadata } from "next";
import Link from "next/link";

import { Reveal } from "@/components/motion/reveal";
import { PageHeader } from "@/components/site/page-header";
import { Capabilities } from "@/components/site/capabilities";
import { Foundation } from "@/components/site/foundation";
import { Cta } from "@/components/site/cta";

export const metadata: Metadata = {
  title: "Products",
  description:
    "Register, payments, inventory, staff, and reporting — the five Flo modules that run the counter and everything behind it.",
};

const MODULES = [
  {
    name: "Register",
    tag: "On the counter",
    copy: "A till your team learns in a shift. Tabs, splits, modifiers, and refunds without hunting through menus.",
    points: ["Offline-tolerant tickets", "Tabs, splits, and merges", "Kitchen and bar routing"],
  },
  {
    name: "Payments",
    tag: "At the reader",
    copy: "Tap, chip, wallet, or gift card — one flow, one settlement, one place to chase a disputed charge.",
    points: ["Next-day payouts", "Surcharge and tip rules", "Chargeback evidence packs"],
  },
  {
    name: "Inventory",
    tag: "In the back",
    copy: "Counts that stay honest between deliveries, with waste and par levels tracked per location.",
    points: ["Recipe-level depletion", "Par levels and reorder points", "Supplier price history"],
  },
  {
    name: "Staff",
    tag: "On the roster",
    copy: "Clock-ins, permissions, and tip pools that match how the shift actually ran.",
    points: ["PIN-level permissions", "Timesheets and breaks", "Tip pooling by rule"],
  },
  {
    name: "Reporting",
    tag: "After close",
    copy: "One number per question. Sales by hour, by item, by staff member, across every location you run.",
    points: ["Hourly sales heatmap", "Cross-location roll-ups", "Scheduled email digests"],
  },
];

export default function ProductsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Products"
        title={
          <>
            Everything the counter needs,{" "}
            <span className="text-gradient">nothing it doesn&rsquo;t</span>
          </>
        }
        lede="Five modules that share one catalog, one customer record, and one set of numbers — so the register, the stockroom, and the back office never disagree."
      >
        <Link href="/demo" className="btn btn-primary">
          Book a demo
        </Link>
        <Link href="/pricing" className="btn btn-ghost">
          See pricing
        </Link>
      </PageHeader>

      <section className="section pt-4">
        <div className="shell">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {MODULES.map((module, index) => (
              <Reveal
                key={module.name}
                className="panel card-lift spotlight relative overflow-hidden rounded-[22px] p-6"
                delay={index * 90}
                y={28}
              >
                <span className="eyebrow text-[0.625rem]">{module.tag}</span>
                <h2 className="mt-2 font-display text-[1.25rem] font-bold">
                  {module.name}
                </h2>
                <p className="mt-2 text-[0.8125rem] leading-relaxed text-mist-400">
                  {module.copy}
                </p>

                <ul className="mt-5 grid gap-2 border-t border-white/6 pt-4">
                  {module.points.map((point) => (
                    <li
                      key={point}
                      className="flex items-start gap-2 text-[0.8125rem] text-mist-300"
                    >
                      <span
                        aria-hidden
                        className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-iris-400"
                      />
                      {point}
                    </li>
                  ))}
                </ul>
              </Reveal>
            ))}

            <Reveal
              className="relative flex min-h-[220px] flex-col justify-between overflow-hidden rounded-[22px] border border-iris-200/25 bg-gradient-to-br from-iris-500 via-iris-600 to-iris-700 p-6 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.28),0_30px_70px_-34px_rgb(79_70_229/0.85)]"
              delay={MODULES.length * 90}
              y={28}
            >
              <div
                aria-hidden
                className="absolute -right-12 -top-14 h-48 w-48 rounded-full bg-white/20 blur-3xl"
              />
              <h2 className="relative font-display text-[1.25rem] font-bold leading-tight text-white">
                Bring your own
                <br />
                hardware — or ours.
              </h2>
              <p className="relative mt-3 text-[0.8125rem] leading-relaxed text-white/80">
                Flo runs on the tablets and readers you already own. Need a full
                counter kit? We ship one preconfigured.
              </p>
              <Link
                href="/demo"
                className="btn btn-ghost btn-sm relative mt-5 self-start border-white/40 bg-white/10 text-white"
              >
                Talk to us
              </Link>
            </Reveal>
          </div>
        </div>
      </section>

      <Capabilities />
      <Foundation />
      <Cta />
    </>
  );
}
