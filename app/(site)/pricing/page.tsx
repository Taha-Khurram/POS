import type { Metadata } from "next";
import Link from "next/link";

import { Reveal } from "@/components/motion/reveal";
import { PageHeader } from "@/components/site/page-header";
import { Cta } from "@/components/site/cta";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Two plans, priced in rupees. Standard at Rs 5,000 a month for up to two counters and Premium at Rs 10,000 for up to four — with a list of what is built and what is not.",
};

/**
 * Every line below is a thing the software does today. The plan rows in
 * `0020_plans_tell_the_truth.sql` say the same, because a feature flag is a
 * promise the console can be held to and the two must not drift.
 */
const PLANS = [
  {
    name: "Standard",
    price: "Rs 5,000",
    cadence: "per month",
    pitch: "For a shop with one counter, or two.",
    cta: { label: "Get started", href: "/checkout" },
    features: [
      "Up to 2 counters, each with its own receipt series",
      "Unlimited staff accounts, each with their own sign-in",
      "Cash, card, Raast, Easypaisa, JazzCash or a transfer — and one bill split across them",
      "Your item list — cost, price, margin, Urdu name, barcode",
      "Departments and categories you name yourself",
      "Customer list, searchable by name or phone",
      "Every bill findable, and reprintable marked DUPLICATE",
      "Day close per counter, and CSV export",
      "Dashboard: sales, profit, cost of goods, margin",
      "WhatsApp support in Urdu and English",
    ],
  },
  {
    name: "Premium",
    price: "Rs 10,000",
    cadence: "per month",
    pitch: "For a busy floor that needs more than two tills — and wants each new module the week it ships.",
    cta: { label: "Get started", href: "/checkout" },
    featured: true,
    features: [
      "Everything in Standard",
      "Up to 4 counters",
      "New modules the week they land, at no extra cost",
      "Your rate list imported and checked for you",
      "Named person for setup and support",
      "Priority on the queue when something breaks",
    ],
  },
];

/**
 * What is not built. On the pricing page on purpose — this is the page an owner
 * reads with a calculator, and it is the last honest moment before money moves.
 */
const NOT_INCLUDED = [
  "Billing while the internet is down",
  "More than one branch",
  "Raast, Easypaisa, JazzCash and card processing through us — you can record that a bill was paid that way, with its transaction number, but the money does not move through Flo",
  "FBR digital invoicing and provincial tax filing",
  "A sales-tax summary — a line records the price it sold at and not the rate behind it, so any tax figure would be reverse-engineered",
  "Anything a dining room needs — tables, kitchen tickets, a bill that stays open. Flo is a supermarket till",
];

const ADD_ONS = [
  {
    name: "Getting your list in",
    detail:
      "Send a spreadsheet, an old export, or photos of the price board. We turn it into the import file and run it with you on a call. No charge, on either plan.",
  },
  {
    name: "Extra counter on Standard",
    detail:
      "Rs 1,500 per additional counter per month, up to the Premium ceiling. Beyond four counters, talk to us — the number has not been tested past that and we would rather say so.",
  },
  {
    name: "Hardware",
    detail:
      "We do not sell it. Flo runs in the browser on a tablet, a terminal or the shop computer, prints to any thermal printer your device can already reach, and takes a USB scanner as-is. We will tell you what to buy.",
  },
  {
    name: "Your data, out",
    detail:
      "Sales export to CSV from the screen. Ask and we will send you everything else — items, customers, every bill and line — in a format your accountant can open. No charge and no notice period.",
  },
];

const FAQS = [
  {
    q: "Is there a free plan?",
    a: "No. Flo has two plans — Rs 5,000 and Rs 10,000 a month — because a register that half works is worse than none. Every demo is free, and the first month is refundable in full if the counter does not run better.",
  },
  {
    q: "What is genuinely not built yet?",
    a: "Offline billing, more than one branch, taking the payment itself through a wallet or a card network, FBR invoicing, and a sales-tax summary. Reports, buying, batch and expiry, and variants used to be on this list and are now on the counter. The full list is above and the order is on the roadmap. If one of them is the reason you would buy, do not buy yet — tell us instead, because that is how the order gets decided.",
  },
  {
    q: "Does Flo file my FBR invoices?",
    a: "No, and it does not print a fiscal invoice number or a verification QR. If your outlet is required to be integrated with FBR, Flo is not the right software for you today. It is on the roadmap without a date, because the date would be a guess.",
  },
  {
    q: "What happens when the internet goes?",
    a: "The register needs the connection to record a sale. If it fails mid-sale, Flo offers to print the receipt anyway — that copy carries an UNSAVED number, is stamped NOT RECORDED on the roll, and is deliberately left out of the day's takings, so the shop keeps selling and nothing lies about what was counted. Offline billing that queues and syncs is being built; it is not here.",
  },
  {
    q: "Which payment methods can I record?",
    a: "Cash, card, Raast, Easypaisa, JazzCash and a bank transfer, and a bill can be split across them — two thousand on the card and the rest in notes is one bill with two tenders on it. All of them mean the machine or the app you already have: the cashier records how the money arrived, with its transaction number, so your day close reconciles against the statement. Flo does not process the payment and takes no cut of it.",
  },
  {
    q: "Is sales tax included in those figures?",
    a: "Prices are quoted before tax. Federal sales tax on services is added on your invoice at the prevailing rate, and we issue a proper tax invoice with our NTN and STRN so your accountant can claim it.",
  },
  {
    q: "Is there a contract?",
    a: "Monthly billing, cancel at the end of any period, and your data exports in full whenever you ask — including on the way out.",
  },
  {
    q: "Do you charge per staff member?",
    a: "Never. Staff accounts are unlimited on both plans, so hiring for the wedding season or Ramadan does not change your bill.",
  },
];

export default function PricingPage() {
  return (
    <>
      <PageHeader
        eyebrow="Pricing"
        title={
          <>
            Two plans, priced{" "}
            <span className="text-gradient">in rupees</span>
          </>
        }
        lede="Rs 5,000 or Rs 10,000 a month. Everything on this page is built and running today — and what is not is listed further down, on the same page, before you decide."
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
          <div className="mx-auto grid max-w-4xl items-start gap-4 lg:grid-cols-2">
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
                      More than two tills
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
                    plan.featured ? "border-white/20" : "border-ink-700"
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
                          stroke={plan.featured ? "#fff" : "var(--color-iris-600)"}
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

      {/* ---------- What is not in either plan ---------- */}
      <section className="section pt-0">
        <div className="shell">
          <Reveal
            className="panel rim mx-auto max-w-4xl rounded-[24px] p-7 sm:p-9"
            y={24}
          >
            <h2 className="font-display text-[1.25rem] font-bold">
              Not in either plan, because it is not built
            </h2>
            <p className="mt-2 max-w-2xl text-[0.875rem] leading-relaxed text-mist-400">
              No plan unlocks any of this. It is listed so nobody finds out on
              the third day, and it is the same list that decides what gets
              built next.
            </p>

            <ul className="mt-6 grid gap-2.5 border-t border-ink-700 pt-6 sm:grid-cols-2">
              {NOT_INCLUDED.map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-2.5 text-[0.8125rem] leading-relaxed text-mist-400"
                >
                  <svg
                    viewBox="0 0 16 16"
                    className="mt-[0.25rem] h-3.5 w-3.5 shrink-0"
                    aria-hidden
                  >
                    <path
                      d="M5 5l6 6M11 5l-6 6"
                      fill="none"
                      stroke="var(--color-mist-500)"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                  {item}
                </li>
              ))}
            </ul>

            <Link href="/roadmap" className="btn btn-ghost btn-sm mt-7">
              See what is being built, and in what order
            </Link>
          </Reveal>
        </div>
      </section>

      {/* ---------- Add-ons ---------- */}
      <section className="section pt-0">
        <div className="shell">
          <Reveal as="h2" className="heading text-center">
            The rest of the bill, in plain rupees
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
            What owners ask on the first call
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
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-ink-600 text-mist-300 transition-transform duration-500 ease-[var(--ease-out-back)] group-open:rotate-45"
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
