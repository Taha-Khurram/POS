import type { Metadata } from "next";
import Link from "next/link";

import { Reveal } from "@/components/motion/reveal";
import { PageHeader } from "@/components/site/page-header";
import { Cta } from "@/components/site/cta";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Two plans, priced in rupees. Standard at Rs 5,000 per branch per month and Premium at Rs 10,000 — FBR digital invoicing included on both.",
};

const PLANS = [
  {
    name: "Standard",
    price: "Rs 5,000",
    cadence: "per branch / month",
    pitch: "For a single shop or restaurant that needs clean billing and honest stock.",
    cta: { label: "Get started", href: "/checkout" },
    features: [
      "Up to 2 registers, unlimited staff PINs",
      "Cash, card, Raast, Easypaisa and JazzCash",
      "FBR digital invoicing with QR receipts",
      "Item catalog with rates, deals, and sizes",
      "Udhaar khata with customer balances",
      "Stock in and out, low-stock alerts",
      "Daily sales and cash-count report",
      "WhatsApp support in Urdu and English",
    ],
  },
  {
    name: "Premium",
    price: "Rs 10,000",
    cadence: "per branch / month",
    pitch: "For busy floors and multi-branch owners who want one set of numbers.",
    cta: { label: "Get started", href: "/checkout" },
    featured: true,
    features: [
      "Everything in Standard",
      "Unlimited registers per branch",
      "Multi-branch dashboard and central catalog",
      "Recipe-level depletion for kitchens",
      "Purchase orders and supplier rate history",
      "Foodpanda and delivery reconciliation",
      "Attendance, roster, and payroll export",
      "PRA and SRB service-tax filing support",
      "Loyalty plus WhatsApp and SMS campaigns",
      "API access, data exports, priority support",
    ],
  },
];

const ADD_ONS = [
  {
    name: "Card and wallet processing",
    detail:
      "1.9% per card tap or swipe through our acquiring partners. Raast and wallet QR settle at 0.9%. Cash costs nothing, and there is no monthly minimum.",
  },
  {
    name: "Counter hardware bundle",
    detail:
      "Android billing terminal, thermal receipt printer, barcode scanner, and cash drawer — delivered configured for Rs 65,000, or Rs 3,500 per month.",
  },
  {
    name: "Extra register on Standard",
    detail:
      "Rs 1,500 per additional register per month. Premium includes as many registers as your branch can fit.",
  },
  {
    name: "FBR and provincial setup",
    detail:
      "POS registration, IRIS integration, and your first fiscal invoice — done with you on a call, at no charge on either plan.",
  },
];

const FAQS = [
  {
    q: "Is there a free plan?",
    a: "No. Flo has two plans — Standard at Rs 5,000 per branch per month and Premium at Rs 10,000 — because a register that half works is worse than none. Every demo is free, and the first month is refundable in full if the counter does not run better.",
  },
  {
    q: "Is sales tax included in those figures?",
    a: "Prices are quoted before tax. Federal sales tax on services is added on your invoice at the prevailing rate, and we issue a proper tax invoice with our NTN and STRN so your accountant can claim it.",
  },
  {
    q: "How does the FBR integration work?",
    a: "Your branch is registered as a POS with FBR, and every bill Flo prints carries the fiscal invoice number and verification QR code that the law requires. Invoices queue locally if IRIS is unreachable and post automatically once it responds — nothing is filed by hand.",
  },
  {
    q: "What happens when the power or internet goes?",
    a: "The register keeps billing offline on the tablet or terminal, holds card and wallet receipts in a local queue, and settles everything when the connection returns. Reports and FBR filings backfill on their own.",
  },
  {
    q: "Which payment methods can I accept?",
    a: "Cash, cards through any 1LINK-connected acquirer, Raast QR, Easypaisa, JazzCash, and bank transfer against an invoice. Udhaar is tracked as a balance rather than a payment, so your khata and your cash always reconcile.",
  },
  {
    q: "Is there a contract, and can I add branches later?",
    a: "Monthly billing, cancel at the end of any period, and your data exports in full whenever you ask. Branches and registers are prorated to the day, so a seasonal outlet for Ramadan or Eid costs only the weeks it runs.",
  },
  {
    q: "Do you charge per staff member?",
    a: "Never. Staff PINs are unlimited on both plans, so hiring for the wedding season or Ramadan does not change your bill.",
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
        lede="Rs 5,000 or Rs 10,000 per branch per month. FBR invoicing, udhaar khata, and support in Urdu are in both — no free tier, and no fees invented at the end of the quarter."
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
                      Most chosen in Pakistan
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
                          stroke={plan.featured ? "#fff" : "#87bfff"}
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

          <Reveal
            className="panel mx-auto mt-4 max-w-4xl rounded-2xl px-6 py-5 text-center"
            delay={220}
            y={20}
          >
            <p className="text-[0.8125rem] leading-relaxed text-mist-400">
              Running more than ten branches, or a franchise network?{" "}
              <Link
                href="/demo"
                className="font-medium text-iris-300 transition-colors duration-300 hover:text-iris-200"
              >
                Talk to sales
              </Link>{" "}
              — we quote annually on Premium and put an onboarding lead on it.
            </p>
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
