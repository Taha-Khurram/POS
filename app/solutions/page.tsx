import type { Metadata } from "next";
import Link from "next/link";

import { CountUp } from "@/components/motion/count-up";
import { Reveal } from "@/components/motion/reveal";
import { PageHeader } from "@/components/site/page-header";
import { Cta } from "@/components/site/cta";

export const metadata: Metadata = {
  title: "Solutions",
  description:
    "How Flo is set up for cafés, full-service restaurants, retail floors, and multi-location groups.",
};

const INDUSTRIES = [
  {
    name: "Cafés & quick service",
    lede: "Peak is ninety minutes long. Everything else is preparation.",
    copy: "One-tap favourites, modifiers that keep the line moving, and order-ready texts that stop a crowd forming at the counter.",
    wins: ["Sub-8-second tickets", "Prepaid regulars", "Queue-aware displays"],
    accent: true,
  },
  {
    name: "Restaurants & bars",
    lede: "Tables move, tabs split, courses fire.",
    copy: "Open tabs by seat, fire courses to the right station, and settle a split six ways without recalculating anything by hand.",
    wins: ["Course firing", "Split by seat or item", "Tip pooling by rule"],
  },
  {
    name: "Retail floors",
    lede: "The stockroom and the till tell the same story.",
    copy: "Variants, barcodes, and par levels stay in step, so what the shelf says and what the system says match at close.",
    wins: ["Variant matrices", "Barcode receiving", "Stock counts on tablet"],
  },
  {
    name: "Multi-location groups",
    lede: "Five sites should not mean five spreadsheets.",
    copy: "Push a price change everywhere at once, compare sites hour by hour, and give each manager exactly what they should see.",
    wins: ["Central catalog", "Per-site permissions", "Group-wide reporting"],
  },
];

const STEPS = [
  {
    title: "Import your menu",
    copy: "Send a spreadsheet or your current export. We map items, modifiers, and prices before your first shift.",
  },
  {
    title: "Set up the floor",
    copy: "Registers, readers, printers, and staff PINs configured together on one call — usually under an hour.",
  },
  {
    title: "Run one service side by side",
    copy: "Keep your old till on standby for a shift. Most teams never switch back to it.",
  },
  {
    title: "Turn on the extras",
    copy: "Loyalty, order updates, and AI reordering come online once the basics are boring.",
  },
];

const METRICS = [
  { value: 42, suffix: "%", label: "Faster tickets at peak" },
  { value: 3.5, decimals: 1, suffix: "h", label: "Saved on weekly stock counts" },
  { value: 99.98, decimals: 2, suffix: "%", label: "Payment uptime, trailing year" },
  { value: 1200, suffix: "+", label: "Counters running Flo" },
];

export default function SolutionsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Solutions"
        title={
          <>
            Built for your floor,{" "}
            <span className="text-gradient">not a generic one</span>
          </>
        }
        lede="Same platform, configured for how your room actually runs — a morning coffee rush, a Saturday dinner service, or nine stores reporting into one office."
      >
        <Link href="/demo" className="btn btn-primary">
          Book a demo
        </Link>
        <Link href="/products" className="btn btn-ghost">
          See the products
        </Link>
      </PageHeader>

      {/* ---------- Industries ---------- */}
      <section className="section pt-4">
        <div className="shell">
          <div className="grid gap-4 lg:grid-cols-2">
            {INDUSTRIES.map((industry, index) => (
              <Reveal
                key={industry.name}
                className={`card-lift relative flex flex-col overflow-hidden rounded-[22px] p-7 ${
                  industry.accent
                    ? "border border-iris-200/25 bg-gradient-to-br from-iris-500 via-iris-600 to-iris-700 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.28),0_30px_70px_-34px_rgb(79_70_229/0.85)]"
                    : "panel spotlight"
                }`}
                delay={index * 100}
                y={30}
              >
                <div
                  aria-hidden
                  className={
                    industry.accent
                      ? "absolute -left-12 -top-16 h-52 w-52 rounded-full bg-white/20 blur-3xl"
                      : "glow -right-16 -top-20 h-56 w-56 bg-iris-600/20"
                  }
                />

                <div className="relative">
                  <h2
                    className={`font-display text-[1.35rem] font-bold ${
                      industry.accent ? "text-white" : ""
                    }`}
                  >
                    {industry.name}
                  </h2>
                  <p
                    className={`mt-2 font-display text-[0.9375rem] font-medium ${
                      industry.accent ? "text-white/85" : "text-iris-300"
                    }`}
                  >
                    {industry.lede}
                  </p>
                  <p
                    className={`mt-3 text-[0.8125rem] leading-relaxed ${
                      industry.accent ? "text-white/80" : "text-mist-400"
                    }`}
                  >
                    {industry.copy}
                  </p>
                </div>

                <ul className="relative mt-6 flex flex-wrap gap-2">
                  {industry.wins.map((win) => (
                    <li
                      key={win}
                      className={`rounded-full px-3 py-1.5 font-display text-[0.6875rem] font-medium ${
                        industry.accent
                          ? "border border-white/30 bg-white/12 text-white"
                          : "border border-white/10 bg-white/[0.03] text-mist-300"
                      }`}
                    >
                      {win}
                    </li>
                  ))}
                </ul>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Onboarding steps ---------- */}
      <section className="section pt-0">
        <div
          aria-hidden
          className="glow left-1/2 top-16 h-72 w-[36rem] -translate-x-1/2 bg-iris-700/15"
        />

        <div className="shell relative">
          <div className="mx-auto max-w-2xl text-center">
            <Reveal as="h2" className="heading">
              Switching takes a week, not a quarter
            </Reveal>
            <Reveal as="p" className="lede mx-auto mt-4 max-w-lg" delay={120}>
              Nobody can close for a migration. Flo goes in alongside what
              you&rsquo;re already running, one step at a time.
            </Reveal>
          </div>

          <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <Reveal
                key={step.title}
                as="li"
                className="panel card-lift relative overflow-hidden rounded-2xl p-6"
                delay={index * 110}
                y={26}
              >
                <span className="grid h-9 w-9 place-items-center rounded-xl border border-iris-200/35 bg-gradient-to-br from-iris-400 to-iris-700 font-display text-[0.8125rem] font-extrabold text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.3)]">
                  {index + 1}
                </span>
                <h3 className="mt-4 font-display text-[0.9375rem] font-semibold">
                  {step.title}
                </h3>
                <p className="mt-2 text-[0.8125rem] leading-relaxed text-mist-400">
                  {step.copy}
                </p>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------- Metrics ---------- */}
      <section className="section pt-0">
        <div className="shell">
          <Reveal className="panel rim relative overflow-hidden rounded-[24px] p-8 sm:p-12">
            <div aria-hidden className="stars absolute inset-0 opacity-60" />
            <div
              aria-hidden
              className="glow -left-10 -top-20 h-64 w-64 animate-breathe bg-iris-600/22"
            />

            <dl className="relative grid gap-8 text-center sm:grid-cols-2 lg:grid-cols-4">
              {METRICS.map((metric, index) => (
                <div key={metric.label}>
                  <dt className="sr-only">{metric.label}</dt>
                  <dd>
                    <CountUp
                      to={metric.value}
                      decimals={metric.decimals ?? 0}
                      suffix={metric.suffix}
                      delay={index * 140}
                      className="font-display text-[clamp(2rem,4.4vw,2.9rem)] font-bold tracking-tight text-mist-50"
                    />
                    <span className="mt-2 block text-[0.8125rem] text-mist-400">
                      {metric.label}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>

            <p className="relative mt-8 text-center text-[0.6875rem] text-mist-500">
              Figures from Flo customers running two or more registers, measured
              over their first six months.
            </p>
          </Reveal>
        </div>
      </section>

      <Cta />
    </>
  );
}
