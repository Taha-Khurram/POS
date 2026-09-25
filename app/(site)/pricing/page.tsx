import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { Reveal } from "@/components/motion/reveal";
import { PageHeader } from "@/components/site/page-header";
import { Cta } from "@/components/site/cta";
import { rupees } from "@/lib/format";
import { limitOf, pricingLines, type FeatureFlags } from "@/lib/platform/admin";
import { createAdminClient } from "@/utils/supabase/admin";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Flo's plans, priced in rupees a month, by how many counters the shop runs — with a list of what is built and what is not.",
};

type PricedPlan = {
  code: string;
  name: string;
  pitch: string;
  price: number;
  counters: number | null;
  lines: string[];
};

/**
 * The plans on sale, read from `plans` per request (`0045`).
 *
 * This page used to write its cards by hand, so a price saved on
 * `/admin/plans` reached `/checkout` and was contradicted by the page a buyer
 * reads first. Now the name, price, pitch, order and every line come off the
 * row: a line per flag that is on (`PLAN_FEATURES[].line`) and the plan's own
 * `highlights` for what no flag can say. `pricingLines` decides the words.
 *
 * `connection()` for `/checkout`'s reason — `next build` must not need a live
 * database. The service role because `plans` has no anonymous read policy;
 * only on-sale rows and only the columns a buyer is shown leave this function.
 * A failed read draws the page without cards rather than a 500: the rest of it
 * is still true, and the demo link still works.
 */
async function loadPlans(): Promise<{ plans: PricedPlan[]; staff: (number | null)[] }> {
  await connection();

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("plans")
    .select("code, name, pitch, list_price, features, highlights")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[pricing] plans read failed", error);
    return { plans: [], staff: [] };
  }

  const rows = (data ?? []).map((row) => ({
    code: String(row.code),
    name: String(row.name),
    pitch: row.pitch ? String(row.pitch) : "",
    price: Number(row.list_price),
    features: (row.features as FeatureFlags | null) ?? {},
    highlights: Array.isArray(row.highlights) ? row.highlights.map(String) : [],
  }));

  return {
    plans: rows.map((row, index) => ({
      code: row.code,
      name: row.name,
      pitch: row.pitch,
      price: row.price,
      counters: limitOf(row.features, "max_registers"),
      lines: pricingLines(row, index > 0 ? rows[index - 1] : null),
    })),
    staff: rows.map((row) => limitOf(row.features, "max_staff_pins")),
  };
}

/** "Rs 5,000 or Rs 10,000" — the prices as a buyer reads them in a sentence. */
const priceList = (plans: PricedPlan[]) => {
  const prices = plans.map((plan) => rupees(plan.price));
  return prices.length <= 1
    ? (prices[0] ?? "")
    : `${prices.slice(0, -1).join(", ")} or ${prices[prices.length - 1]}`;
};

const COUNT_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six"];
const countWord = (count: number) => COUNT_WORDS[count] ?? String(count);

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
      "Send a spreadsheet, an old export, or photos of the price board. We turn it into the import file and run it with you on a call. No charge, on any plan.",
  },
  {
    name: "An extra counter",
    detail:
      "Rs 1,500 per additional counter per month, beyond what your plan includes. Beyond four counters, talk to us — the number has not been tested past that and we would rather say so.",
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

/** The two answers that quote the plans are worked out from them, so an edit
 *  on `/admin/plans` cannot leave the FAQ saying something the cards do not. */
const planFaqs = (plans: PricedPlan[], staff: (number | null)[]) => {
  const unlimited = staff.every((limit) => limit === null);

  return [
    {
      q: "Is there a free plan?",
      a: `No. Flo has ${countWord(plans.length).toLowerCase()} ${plans.length === 1 ? "plan" : "plans"} — ${priceList(plans)} a month — because a register that half works is worse than none. Every demo is free, and the first month is refundable in full if the counter does not run better.`,
    },
    {
      q: "Do you charge per staff member?",
      a: unlimited
        ? "Never. Staff accounts are unlimited on every plan, so hiring for the wedding season or Ramadan does not change your bill."
        : "Never per head — each plan says how many staff accounts it includes, and the owner adds and removes them from the Staff screen. Hiring inside that number for the wedding season or Ramadan does not change your bill.",
    },
  ];
};

const FAQS = [
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
    q: "How do I pay for Flo?",
    a: "Press Get started on a plan. One page asks for your shop, shows the exact amount and our bank, Easypaisa and JazzCash accounts, and takes the screenshot once you have sent it. We match the transfer against our statement and send your shop's login on WhatsApp. Paid later? The order link you get lets you send the screenshot whenever you are ready.",
  },
  {
    q: "Is sales tax included in those figures?",
    a: "Prices are quoted before tax. Federal sales tax on services is added on your invoice at the prevailing rate, and we issue a proper tax invoice with our NTN and STRN so your accountant can claim it.",
  },
  {
    q: "Is there a contract?",
    a: "Monthly billing, cancel at the end of any period, and your data exports in full whenever you ask — including on the way out.",
  },
];

export default async function PricingPage() {
  const { plans, staff } = await loadPlans();
  const [freePlan, perHead] = planFaqs(plans, staff);
  const faqs = [freePlan, ...FAQS, perHead];

  return (
    <>
      <PageHeader
        eyebrow="Pricing"
        title={
          <>
            {plans.length > 0 ? `${countWord(plans.length)} ${plans.length === 1 ? "plan" : "plans"}` : "Plans"},
            priced <span className="text-gradient">in rupees</span>
          </>
        }
        lede={`${plans.length > 0 ? `${priceList(plans)} a month. ` : ""}Everything on this page is built and running today — and what is not is listed further down, on the same page, before you decide.`}
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
          {plans.length === 0 ? (
            <p className="panel mx-auto max-w-2xl rounded-[22px] p-7 text-center text-[0.875rem] leading-relaxed text-mist-400">
              The plans are being updated. Book a demo and we will quote you on
              the call — in rupees, the same day.
            </p>
          ) : null}

          <div
            className={`mx-auto grid items-start gap-4 ${
              plans.length >= 3 ? "max-w-6xl lg:grid-cols-3" : plans.length === 2 ? "max-w-4xl lg:grid-cols-2" : "max-w-md"
            }`}
          >
            {plans.map((plan, index) => {
              // The last tier is the one drawn lit, when there is more than one
              // — and its badge is only drawn when it states a true difference.
              const featured = plans.length > 1 && index === plans.length - 1;
              const below = index > 0 ? plans[index - 1].counters : null;
              const badge =
                featured && below !== null && (plan.counters === null || plan.counters > below)
                  ? `More than ${countWord(below).toLowerCase()} ${below === 1 ? "till" : "tills"}`
                  : null;

              return (
              <Reveal
                key={plan.code}
                className={`relative flex flex-col overflow-hidden rounded-[22px] p-7 ${
                  featured
                    ? "border border-iris-200/30 bg-gradient-to-br from-iris-500 via-iris-600 to-iris-700 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.28),0_34px_80px_-38px_rgb(79_70_229/0.9)] lg:-mt-4 lg:pb-9"
                    : "panel card-lift spotlight"
                }`}
                delay={index * 110}
                y={32}
              >
                {featured ? (
                  <div
                    aria-hidden
                    className="absolute -right-14 -top-16 h-52 w-52 rounded-full bg-white/20 blur-3xl"
                  />
                ) : null}
                {badge ? (
                  <span className="relative mb-4 self-start rounded-full border border-white/30 bg-white/15 px-3 py-1 font-display text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-white">
                    {badge}
                  </span>
                ) : null}

                <h2
                  className={`relative font-display text-[1.25rem] font-bold ${
                    featured ? "text-white" : ""
                  }`}
                >
                  {plan.name}
                </h2>

                <p
                  className={`relative mt-1 text-[0.8125rem] leading-relaxed ${
                    featured ? "text-white/80" : "text-mist-400"
                  }`}
                >
                  {plan.pitch}
                </p>

                <p className="relative mt-6 flex items-baseline gap-2">
                  <span
                    className={`font-display text-[2.4rem] font-bold leading-none tracking-tight ${
                      featured ? "text-white" : "text-mist-50"
                    }`}
                  >
                    {rupees(plan.price)}
                  </span>
                  <span
                    className={`text-[0.75rem] ${
                      featured ? "text-white/75" : "text-mist-500"
                    }`}
                  >
                    per month
                  </span>
                </p>

                <Link
                  href={`/checkout?plan=${encodeURIComponent(plan.code)}`}
                  className={`relative mt-6 w-full ${
                    featured
                      ? "btn btn-ghost border-white/40 bg-white/12 text-white"
                      : "btn btn-primary"
                  }`}
                >
                  Get started
                </Link>

                <ul
                  className={`relative mt-7 grid gap-2.5 border-t pt-5 ${
                    featured ? "border-white/20" : "border-ink-700"
                  }`}
                >
                  {plan.lines.map((feature) => (
                    <li
                      key={feature}
                      className={`flex items-start gap-2.5 text-[0.8125rem] leading-relaxed ${
                        featured ? "text-white/85" : "text-mist-300"
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
                          stroke={featured ? "#fff" : "var(--color-iris-600)"}
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
              );
            })}
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
            {faqs.map((faq, index) => (
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
