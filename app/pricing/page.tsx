import type { Metadata } from "next";
import Link from "next/link";

import { Reveal } from "@/components/motion/reveal";
import { PageHeader } from "@/components/site/page-header";
import { Cta } from "@/components/site/cta";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Flat monthly pricing per register, with card processing at a published rate. Counter, Floor, and Group plans.",
};

const PLANS = [
  {
    name: "Counter",
    price: "$0",
    cadence: "per register / month",
    pitch: "For a single till that just needs to take money cleanly.",
    cta: { label: "Start free", href: "/login" },
    features: [
      "One register, unlimited staff PINs",
      "Tap, chip, and wallet payments",
      "Item catalog with modifiers",
      "Daily sales and close-out report",
      "Email support",
    ],
  },
  {
    name: "Floor",
    price: "$79",
    cadence: "per register / month",
    pitch: "For rooms where the rush is the business — tabs, stock, and staff.",
    cta: { label: "Book a demo", href: "/demo" },
    featured: true,
    features: [
      "Everything in Counter",
      "Tabs, splits, and course firing",
      "Inventory with par levels and waste",
      "Timesheets and tip pooling",
      "Order-status messaging",
      "Priority support, 7 days",
    ],
  },
  {
    name: "Group",
    price: "Let's talk",
    cadence: "billed annually",
    pitch: "For multi-site operators who need one catalog and one set of numbers.",
    cta: { label: "Talk to sales", href: "/demo" },
    features: [
      "Everything in Floor",
      "Central catalog across locations",
      "Per-site roles and permissions",
      "AI reordering and price alerts",
      "API access and data exports",
      "Named onboarding lead",
    ],
  },
];

const ADD_ONS = [
  { name: "Card processing", detail: "2.5% + 10¢ per tap, chip, or wallet payment. No monthly minimum." },
  { name: "Counter hardware kit", detail: "Tablet, stand, reader, and printer, preconfigured. $499 or $22/month." },
  { name: "Loyalty", detail: "Points, punch cards, and stored value. $19 per location / month." },
  { name: "Extra register", detail: "Add a till mid-month and we prorate it to the day." },
];

const FAQS = [
  {
    q: "Is there a contract?",
    a: "No. Monthly plans cancel at the end of the billing period, and your data exports in full whenever you ask for it. Group plans are billed annually because the onboarding work is front-loaded, but they carry the same exit terms.",
  },
  {
    q: "What does card processing actually cost?",
    a: "2.5% + 10¢ per card-present payment, settled next business day. Keyed and online payments run at 2.9% + 30¢. There is no separate gateway fee, statement fee, or PCI fee.",
  },
  {
    q: "Can I keep my current card processor?",
    a: "On Group plans, yes — we integrate with most major acquirers. On Counter and Floor, payments run through Flo so that refunds, disputes, and reporting stay in one system.",
  },
  {
    q: "What happens if the internet drops mid-service?",
    a: "The register keeps taking orders and card payments offline, queues them locally, and settles the queue when the connection returns. Reporting backfills automatically.",
  },
  {
    q: "Do you charge for staff accounts?",
    a: "Never. Pricing is per register, so seasonal hiring does not change your bill.",
  },
];

export default function PricingPage() {
  return (
    <>
      <PageHeader
        eyebrow="Pricing"
        title={
          <>
            Priced per register,{" "}
            <span className="text-gradient">not per surprise</span>
          </>
        }
        lede="One monthly figure per till, one published processing rate, and no fees invented at the end of the quarter. Add and remove registers as your season changes."
      >
        <Link href="/demo" className="btn btn-primary">
          Book a demo
        </Link>
        <Link href="/products" className="btn btn-ghost">
          See what is included
        </Link>
      </PageHeader>

      {/* ---------- Plans ---------- */}
      <section className="section pt-4">
        <div className="shell">
          <div className="grid items-start gap-4 lg:grid-cols-3">
            {PLANS.map((plan, index) => (
              <Reveal
                key={plan.name}
                className={`relative flex flex-col overflow-hidden rounded-[22px] p-7 ${
                  plan.featured
                    ? "border border-iris-200/30 bg-gradient-to-br from-iris-500 via-iris-600 to-iris-700 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.28),0_34px_80px_-38px_rgb(79_70_229/0.9)] lg:-mt-4 lg:pb-9"
                    : "panel card-lift spotlight"
                }`}
                delay={index * 110}
                y={32}
              >
                {plan.featured ? (
                  <>
                    <div
                      aria-hidden
                      className="absolute -right-14 -top-16 h-52 w-52 rounded-full bg-white/20 blur-3xl"
                    />
                    <span className="relative self-start rounded-full border border-white/30 bg-white/15 px-3 py-1 font-display text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-white">
                      Most chosen
                    </span>
                  </>
                ) : null}

                <h2
                  className={`relative font-display text-[1.25rem] font-bold ${
                    plan.featured ? "mt-4 text-white" : ""
                  }`}
                >
                  {plan.name}
                </h2>

                <p
                  className={`relative mt-1 text-[0.8125rem] leading-relaxed ${
                    plan.featured ? "text-white/80" : "text-mist-400"
                  }`}
                >
                  {plan.pitch}
                </p>

                <p className="relative mt-6 flex items-baseline gap-2">
                  <span
                    className={`font-display text-[2.4rem] font-bold leading-none tracking-tight ${
                      plan.featured ? "text-white" : "text-mist-50"
                    }`}
                  >
                    {plan.price}
                  </span>
                  <span
                    className={`text-[0.75rem] ${
                      plan.featured ? "text-white/75" : "text-mist-500"
                    }`}
                  >
                    {plan.cadence}
                  </span>
                </p>

                <Link
                  href={plan.cta.href}
                  className={`relative mt-6 w-full ${
                    plan.featured
                      ? "btn btn-ghost border-white/40 bg-white/12 text-white"
                      : "btn btn-primary"
                  }`}
                >
                  {plan.cta.label}
                </Link>

                <ul
                  className={`relative mt-7 grid gap-2.5 border-t pt-5 ${
                    plan.featured ? "border-white/20" : "border-white/6"
                  }`}
                >
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className={`flex items-start gap-2.5 text-[0.8125rem] leading-relaxed ${
                        plan.featured ? "text-white/85" : "text-mist-300"
                      }`}
                    >
                      <svg
                        viewBox="0 0 16 16"
                        className="mt-[0.2rem] h-3.5 w-3.5 shrink-0"
                        aria-hidden
                      >
                        <path
                          d="M3 8.4 6.4 11.8 13 5"
                          fill="none"
                          stroke={plan.featured ? "#fff" : "#a5b4fc"}
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      {feature}
                    </li>
                  ))}
                </ul>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Add-ons ---------- */}
      <section className="section pt-0">
        <div className="shell">
          <Reveal as="h2" className="heading text-center">
            The rest of the bill, in plain numbers
          </Reveal>

          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {ADD_ONS.map((addOn, index) => (
              <Reveal
                key={addOn.name}
                className="panel card-lift rounded-2xl p-6"
                delay={index * 90}
                y={26}
              >
                <h3 className="font-display text-[0.9375rem] font-semibold">
                  {addOn.name}
                </h3>
                <p className="mt-2 text-[0.8125rem] leading-relaxed text-mist-400">
                  {addOn.detail}
                </p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- FAQ ---------- */}
      <section className="section pt-0">
        <div
          aria-hidden
          className="glow left-1/2 top-10 h-72 w-[34rem] -translate-x-1/2 bg-iris-700/12"
        />

        <div className="shell relative mx-auto max-w-3xl">
          <Reveal as="h2" className="heading text-center">
            Questions we get on the first call
          </Reveal>

          <div className="mt-10 grid gap-3">
            {FAQS.map((faq, index) => (
              <Reveal
                key={faq.q}
                as="details"
                className="panel group rounded-2xl px-6 py-5 transition-colors duration-500 hover:border-iris-300/25"
                delay={index * 80}
                y={20}
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-[0.9375rem] font-semibold text-mist-50">
                  {faq.q}
                  <span
                    aria-hidden
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/12 text-mist-300 transition-transform duration-500 ease-[var(--ease-out-back)] group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 text-[0.8125rem] leading-relaxed text-mist-400">
                  {faq.a}
                </p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <Cta />
    </>
  );
}
