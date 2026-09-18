import type { Metadata } from "next";
import Link from "next/link";

import { CountUp } from "@/components/motion/count-up";
import { Reveal } from "@/components/motion/reveal";
import { PageHeader } from "@/components/site/page-header";
import { Cta } from "@/components/site/cta";

export const metadata: Metadata = {
  title: "Solutions",
  description:
    "How Flo is set up for kiryana stores, restaurants and dhabas, bakeries and mithai shops, pharmacies, clothing retail, and multi-branch chains across Pakistan.",
};

const INDUSTRIES = [
  {
    name: "Kiryana & general store",
    lede: "Two hundred regulars, four hundred lines, and everybody is in a hurry.",
    copy: "Barcode or name search, sale by kilo, loose and carton rates, and a customer list that knows your regulars by phone number — so the notebook can retire.",
    wins: ["Sale by weight", "Regulars by phone", "Loose and carton rates"],
    accent: true,
  },
  {
    name: "Restaurants, cafés & dhabas",
    lede: "Tables turn, orders change, the kitchen needs to hear it.",
    copy: "Table and parcel orders on one screen, kitchen prints for the karahi and the tandoor, and split bills that add up without a calculator.",
    wins: ["Table and parcel", "Kitchen prints", "Foodpanda orders"],
  },
  {
    name: "Bakeries & mithai shops",
    lede: "Eid week is a year of business in six days.",
    copy: "Weighing-scale billing per kilo, box and tray pricing, and advance orders taken with a deposit against a phone number.",
    wins: ["Scale billing", "Advance orders", "Gift box pricing"],
  },
  {
    name: "Pharmacies & medical stores",
    lede: "Batch, expiry, and the right rate on every strip.",
    copy: "Sell in strips or packs, watch expiry before the distributor does, and keep trade and retail rates straight on the same item.",
    wins: ["Batch and expiry", "Strip-level sale", "Trade vs retail rate"],
  },
  {
    name: "Clothing & fabric retail",
    lede: "One design, nine sizes, three colours, one price change.",
    copy: "Size and colour matrices, per-metre cutting, tailor jobs against a ticket, and season-end sale pricing pushed to every outlet at once.",
    wins: ["Size and colour grids", "Per-metre sale", "Season sale pricing"],
  },
  {
    name: "Multi-branch chains",
    lede: "Five branches should not mean five WhatsApp groups.",
    copy: "Change a rate once and it lands everywhere, compare Karachi against Lahore hour by hour, and let each manager see only their own branch.",
    wins: ["Central catalog", "Per-branch roles", "Group reporting"],
  },
];

const STEPS = [
  {
    title: "Send your rate list",
    copy: "A spreadsheet, an old software export, or photos of the price board. We load items, rates, and units before your first shift.",
  },
  {
    title: "Set up the counter",
    copy: "Terminal, printer, scanner, and staff PINs configured together on one call — usually inside an hour, in Urdu if that is easier.",
  },
  {
    title: "Register with FBR",
    copy: "We handle the POS registration and the IRIS integration, then print a test fiscal invoice with you before you go live.",
  },
  {
    title: "Run one day side by side",
    copy: "Keep your old register or notebook on standby for a day. Most shops never go back to it.",
  },
];

const METRICS = [
  { value: 38, suffix: "%", label: "Faster billing at peak hour" },
  { value: 3.5, decimals: 1, suffix: "h", label: "Saved on weekly stock counts" },
  { value: 96, suffix: "%", label: "Repeat customers matched to a bill" },
  { value: 900, suffix: "+", label: "Counters running Flo in Pakistan" },
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
        lede="The same platform, set up for how your shop actually runs — a 7pm kiryana queue in Faisalabad, a Saturday dinner service in Lahore, or nine outlets reporting into one office in Karachi."
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
                      industry.accent ? "text-white/85" : "text-iris-600"
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
                          : "border border-ink-600 bg-ink-850 text-mist-300"
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
              Live in a week, not a quarter
            </Reveal>
            <Reveal as="p" className="lede mx-auto mt-4 max-w-lg" delay={120}>
              No shop can shut for a software migration. Flo goes in alongside
              whatever you run today — register, Excel, or notebook — one step
              at a time.
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
              Figures from Flo customers in Karachi, Lahore, Islamabad, and
              Faisalabad running two or more registers, measured over their
              first six months.
            </p>
          </Reveal>
        </div>
      </section>

      <Cta />
    </>
  );
}
