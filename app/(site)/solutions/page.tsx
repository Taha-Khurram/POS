import type { Metadata } from "next";
import Link from "next/link";

import { Reveal } from "@/components/motion/reveal";
import { PageHeader } from "@/components/site/page-header";
import { Cta } from "@/components/site/cta";

export const metadata: Metadata = {
  title: "Solutions",
  description:
    "Who Flo suits today — kiryana and general stores, bakery counters, hardware and cosmetics retail — and which shop types are not ready for it yet, with what each one is waiting on.",
};

/**
 * Four shop types Flo genuinely serves, and then four it does not.
 *
 * The second list is the important one. A page that claims six verticals on one
 * vertical's feature set is a page that books demos which end in silence, and
 * the shopkeeper who drove across Lahore for it does not come back.
 */
const SUITED = [
  {
    name: "Kiryana & general store",
    lede: "Two hundred regulars, four hundred lines, and everybody is in a hurry.",
    copy: "Barcode or Urdu-name search, sugar and daal off the scale by the quarter kilo, packets and cartons by the piece, and a customer list that knows your regulars by phone number.",
    wins: ["Sale by weight", "Regulars by phone", "Your own aisles"],
    accent: true,
  },
  {
    name: "Bakery & confectionery counter",
    lede: "Biscuits by the packet, mithai off the scale, one queue for both.",
    copy: "The same bill takes a 350 g box and 1.75 kg of loose barfi. Each line prints its own unit, and the total is right without a calculator on the counter.",
    wins: ["Weight and piece on one bill", "Counter-wise takings", "Reprint a receipt"],
  },
  {
    name: "Hardware, paint & electrical",
    lede: "Nine hundred SKUs and nothing has a barcode on it.",
    copy: "Give an item your own SKU or let Flo suggest one, print an internal barcode, and file it under departments you named yourself — not somebody else's idea of an aisle.",
    wins: ["SKU search", "Internal barcodes", "Supplier on the item"],
  },
  {
    name: "Cosmetics & general retail",
    lede: "Margins vary line by line, and that is the whole business.",
    copy: "Cost beside price on every item, the margin worked out, and the profit on a month's sales taken from what each line actually cost when it sold.",
    wins: ["Cost and margin", "Profit by department", "Low-stock alerts"],
  },
];

/** Named, with what each is waiting on, so a demo is never a wasted trip. */
const NOT_YET = [
  {
    name: "Restaurants, cafés & dhabas",
    waiting: "Tables, kitchen printing, modifiers and split bills. Flo can ring up a counter sale today, but it cannot run a dining room.",
  },
  {
    name: "Pharmacies & medical stores",
    waiting: "Batch numbers and expiry dates. Selling medicine without them is not something we are going to pretend to support.",
  },
  {
    name: "Clothing & footwear",
    waiting: "Size and colour variants. One item, nine sizes and three colours is three rows of work in Flo today, and it should be one.",
  },
  {
    name: "Multi-branch chains",
    waiting: "A second branch. Flo runs as many counters as your plan allows in one shop; comparing Karachi against Lahore is not built.",
  },
];

const STEPS = [
  {
    title: "Send your rate list",
    copy: "A spreadsheet, an old software export, or photos of the price board. We turn it into the CSV Flo imports, and the import checks every row the way the form does.",
  },
  {
    title: "It builds your aisles",
    copy: "The departments and categories your own file names are the ones you get. No template to delete first, and you see the list before anything is saved.",
  },
  {
    title: "Set up the counters",
    copy: "Name each till, give it a receipt prefix, say whether it takes card, and add your staff with their own sign-in. Usually inside an hour, in Urdu if that is easier.",
  },
  {
    title: "Run one day side by side",
    copy: "Keep your register book on the counter for a day and check Flo's day close against what is in the drawer. That is the test that matters.",
  },
];

const NEEDS = [
  {
    title: "Any screen you already have",
    copy: "An Android tablet, a billing terminal, a laptop, or the shop computer. Flo runs in the browser — there is nothing to install.",
  },
  {
    title: "A thermal printer",
    copy: "Receipts print through the browser at 80 mm. Any printer your device can already print to will do.",
  },
  {
    title: "A scanner, or the camera",
    copy: "A USB scanner needs no setup at all — it types the digits. No scanner yet? The tablet's own camera reads barcodes.",
  },
  {
    title: "A working connection",
    copy: "Flo needs the internet to record a sale today. Offline billing is being built; until it is, we say so rather than finding out together at 7pm.",
  },
];

export default function SolutionsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Solutions"
        title={
          <>
            Built for your floor,{" "}
            <span className="text-gradient">and honest about whose</span>
          </>
        }
        lede="Flo runs a counter that sells packaged goods and loose weight — a 7pm kiryana queue in Johar Town, a bakery counter on a Saturday, a hardware shop with nine hundred lines and no barcodes. Some shops it is not ready for, and those are named below too."
      >
        <Link href="/demo" className="btn btn-primary">
          Book a demo
        </Link>
        <Link href="/products" className="btn btn-ghost">
          See the products
        </Link>
      </PageHeader>

      {/* ---------- Who it suits ---------- */}
      <section className="section pt-4">
        <div className="shell">
          <div className="grid gap-4 lg:grid-cols-2">
            {SUITED.map((shop, index) => (
              <Reveal
                key={shop.name}
                className={`card-lift relative flex flex-col overflow-hidden rounded-[22px] p-7 ${
                  shop.accent
                    ? "border border-iris-200/25 bg-gradient-to-br from-iris-500 via-iris-600 to-iris-700 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.28),0_30px_70px_-34px_rgb(79_70_229/0.85)]"
                    : "panel spotlight"
                }`}
                delay={index * 100}
                y={30}
              >
                <div
                  aria-hidden
                  className={
                    shop.accent
                      ? "absolute -left-12 -top-16 h-52 w-52 rounded-full bg-white/20 blur-3xl"
                      : "glow -right-16 -top-20 h-56 w-56 bg-iris-600/20"
                  }
                />

                <div className="relative">
                  <h2
                    className={`font-display text-[1.35rem] font-bold ${
                      shop.accent ? "text-white" : ""
                    }`}
                  >
                    {shop.name}
                  </h2>
                  <p
                    className={`mt-2 font-display text-[0.9375rem] font-medium ${
                      shop.accent ? "text-white/85" : "text-iris-600"
                    }`}
                  >
                    {shop.lede}
                  </p>
                  <p
                    className={`mt-3 text-[0.8125rem] leading-relaxed ${
                      shop.accent ? "text-white/80" : "text-mist-400"
                    }`}
                  >
                    {shop.copy}
                  </p>
                </div>

                <ul className="relative mt-6 flex flex-wrap gap-2">
                  {shop.wins.map((win) => (
                    <li
                      key={win}
                      className={`rounded-full px-3 py-1.5 font-display text-[0.6875rem] font-medium ${
                        shop.accent
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

      {/* ---------- Who it is not for yet ---------- */}
      <section className="section pt-0">
        <div className="shell">
          <div className="mx-auto max-w-2xl text-center">
            <Reveal as="h2" className="heading">
              And who it is not for yet
            </Reveal>
            <Reveal as="p" className="lede mx-auto mt-4 max-w-lg" delay={120}>
              Rather than find this out on the call. If your shop is on this
              list, tell us — it is how the order below gets decided.
            </Reveal>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2">
            {NOT_YET.map((shop, index) => (
              <Reveal
                key={shop.name}
                className="glass rounded-2xl p-6"
                delay={index * 90}
                y={22}
              >
                <h3 className="flex items-center gap-2.5 font-display text-[0.9375rem] font-semibold text-mist-50">
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-sun-400"
                  />
                  {shop.name}
                </h3>
                <p className="mt-2 text-[0.8125rem] leading-relaxed text-mist-400">
                  {shop.waiting}
                </p>
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
              whatever you run today — register book, Excel, or an old
              programme — one step at a time.
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

      {/* ---------- What the shop needs ---------- */}
      <section className="section pt-0">
        <div className="shell">
          <Reveal className="panel rim relative overflow-hidden rounded-[24px] p-8 sm:p-12">
            <div aria-hidden className="stars absolute inset-0 opacity-60" />
            <div
              aria-hidden
              className="glow -left-10 -top-20 h-64 w-64 animate-breathe bg-iris-600/22"
            />

            <div className="relative mx-auto max-w-2xl text-center">
              <h2 className="heading">What you need on the counter</h2>
              <p className="lede mx-auto mt-4 max-w-lg">
                Probably what is already there. Flo is a web page, not a box you
                buy.
              </p>
            </div>

            <dl className="relative mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {NEEDS.map((need) => (
                <div key={need.title}>
                  <dt className="font-display text-[0.9375rem] font-semibold text-mist-50">
                    {need.title}
                  </dt>
                  <dd className="mt-2 text-[0.8125rem] leading-relaxed text-mist-400">
                    {need.copy}
                  </dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </div>
      </section>

      <Cta />
    </>
  );
}
