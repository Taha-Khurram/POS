import type { Metadata } from "next";
import Link from "next/link";

import { Reveal } from "@/components/motion/reveal";
import { PageHeader } from "@/components/site/page-header";
import { Cta } from "@/components/site/cta";

export const metadata: Metadata = {
  title: "Roadmap",
  description:
    "What Flo does today, what is being built next, and what is not being built at all — for Pakistani shopkeepers deciding whether to switch.",
};

/**
 * This route replaced a "Resources" page holding six guides, a benchmark report
 * and a template library, none of which existed. A library of things nobody has
 * written is a worse look than an empty shelf, and a roadmap is the page a
 * shopkeeper deciding whether to switch actually wants.
 *
 * Keep it true. A line that moves from "next" to "now" moves here in the same
 * week the code ships, and a date that slips is corrected rather than quietly
 * deleted.
 */

const NOW = [
  {
    title: "The register",
    copy: "Scan or search by English name, Urdu name or SKU. Loose goods by weight, packets by the piece. Cash with change worked out, or card. A numbered receipt off the roll, one series per counter.",
  },
  {
    title: "Sales history",
    copy: "Every bill, searchable by number, customer, phone or amount, and narrowed by counter, cashier or payment. Open one, look at its lines, reprint it marked DUPLICATE, or export the lot to CSV.",
  },
  {
    title: "Day close",
    copy: "What each counter took in cash and card for the trading day, with its last receipt number — so a drawer is counted against its own row.",
  },
  {
    title: "Products & stock",
    copy: "Your item list with cost, price, margin, barcode, SKU, supplier, tax rate and a low-stock alert set per item. Departments and categories you name yourself. Bulk import from CSV, checked row by row.",
  },
  {
    title: "Customers",
    copy: "Name, phone, address and a note. The phone is the identity, so one number is one person. Their own page shows the bills they have been on.",
  },
  {
    title: "Staff & permissions",
    copy: "A sign-in each for a cashier or a store manager, assigned to a counter. Switches for discounts, the customer list, editing items, and who may see profit.",
  },
  {
    title: "The dashboard",
    copy: "Sales, profit, cost of goods and margin for any window you pick, against the window before it, with the trend by day, the split by department and the top sellers.",
  },
  {
    title: "Stock that moves when you sell",
    copy: "Every sale takes the count down and every return puts it back, inside the same transaction that records the bill. Each change is written down with its reason, its receipt and what the count read afterwards — so a shelf that disagrees with the screen is a list to read, not an argument.",
  },
  {
    title: "Returns",
    copy: "Against the original receipt, line by line, refunded at what was actually paid after any discount. The slip prints marked REFUND. You choose whether the goods go back on the shelf, because a burst bag of atta does not.",
  },
  {
    title: "Discounts at the till",
    copy: "Rupees off, a percentage, or “make it 470” in one tap. Capped by the ceiling you set per role, checked again on the server, and spread across the lines so your reports still add up.",
  },
  {
    title: "Held bills",
    copy: "Put a bill down, name it something you will recognise, and pick it up again. Nothing is sold and no stock moves; the prices come off your list again when it is settled.",
  },
  {
    title: "Shift open and close",
    copy: "An opening float, a counted drawer and the over-or-short — per person, not per day. The cashier counts and only the owner sees the difference, because a cashier shown the expected figure can count to it.",
  },
];

const NEXT = [
  {
    title: "The reports module",
    why: "Sales by item, by category, by cashier, by hour. Profit by line. The dashboard answers the owner's first question; this answers the accountant's.",
    order: 1,
  },
  {
    title: "Offline billing",
    why: "The register queues the sale on the tablet and posts it when the line comes back. Hard to do correctly, which is why it is not being claimed before it works.",
    order: 2,
  },
  {
    title: "Purchasing",
    why: "An order to a supplier, goods received against it, and the cost updated from what you actually paid — which is what turns the margin column from a guess into a fact.",
    order: 3,
  },
  {
    title: "Stock by batch",
    why: "The ledger records every movement today, and what it cannot yet do is tell one delivery of the same item from another. That is the gate for anything with a date on it.",
    order: 4,
  },
];

const LATER = [
  {
    title: "FBR digital invoicing",
    copy: "Fiscal invoice numbers and a verification QR on the receipt. Required for some outlets and irrelevant to most corner shops, so it lands when a customer is actually blocked on it — not before.",
  },
  {
    title: "Raast and wallet payments",
    copy: "Recording them is easy; settling them means an integration and an acquirer. Cash and card are what Flo records honestly today.",
  },
  {
    title: "Batch numbers and expiry",
    copy: "The gate for pharmacies and most perishables.",
  },
  {
    title: "Size and colour variants",
    copy: "The gate for cloth and footwear. One item, nine sizes, three colours — one row of work, not twenty-seven.",
  },
  {
    title: "Restaurant mode",
    copy: "Tables, kitchen printing, modifiers and split bills. A different product from a retail counter, and it will be built like one.",
  },
  {
    title: "More than one branch",
    copy: "A central item list, per-branch staff, and one report over all of them. The day a Flo shop opens its second outlet.",
  },
];

const NEVER = [
  {
    title: "Udhaar khata",
    copy: "A customer balance, a credit limit and a reminder about money owed were in the plan and have been taken out of the schema, not just off the screen. Flo records what was sold and what was paid. It will not keep the book of what is owed — that is a lending product wearing a register's clothes, and a shopkeeper who wants one deserves to be told rather than sold.",
  },
  {
    title: "A price your cashier can type in",
    copy: "The tablet sends item numbers and quantities. The rate always comes off your own list, on the server, every time. This is not a setting and will not become one.",
  },
];

export default function RoadmapPage() {
  return (
    <>
      <PageHeader
        eyebrow="Roadmap"
        title={
          <>
            What is built,{" "}
            <span className="text-gradient">and what is not</span>
          </>
        }
        lede="Flo is in private preview. Rather than a features page that ages badly, here is the honest state of it — running now, being built next, further out, and never."
      >
        <Link href="/demo" className="btn btn-primary">
          Book a demo
        </Link>
        <Link href="/products" className="btn btn-ghost">
          See the screens
        </Link>
      </PageHeader>

      {/* ---------- Running now ---------- */}
      <section className="section pt-4">
        <div className="shell">
          <Reveal className="flex items-center gap-3">
            <span
              aria-hidden
              className="h-2 w-2 rounded-full bg-mint-400 shadow-[0_0_12px_2px_rgb(52_211_153/0.45)]"
            />
            <h2 className="heading">Running today</h2>
          </Reveal>
          <Reveal as="p" className="lede mt-3 max-w-xl" delay={100}>
            Every one of these has a screenshot behind it on the{" "}
            <Link
              href="/products"
              className="text-iris-600 transition-colors duration-300 hover:text-iris-500"
            >
              products page
            </Link>
            , photographed from the working software.
          </Reveal>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {NOW.map((item, index) => (
              <Reveal
                key={item.title}
                className="panel card-lift spotlight rounded-[22px] p-6"
                delay={index * 70}
                y={24}
              >
                <h3 className="font-display text-[1.0625rem] font-semibold">
                  {item.title}
                </h3>
                <p className="mt-2 text-[0.8125rem] leading-relaxed text-mist-400">
                  {item.copy}
                </p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Being built ---------- */}
      <section className="section pt-0">
        <div
          aria-hidden
          className="glow left-1/2 top-8 h-72 w-[36rem] -translate-x-1/2 bg-iris-700/14"
        />

        <div className="shell relative">
          <Reveal className="flex items-center gap-3">
            <span
              aria-hidden
              className="h-2 w-2 rounded-full bg-iris-400 shadow-[0_0_12px_2px_rgb(129_140_248/0.45)]"
            />
            <h2 className="heading">Being built, in this order</h2>
          </Reveal>
          <Reveal as="p" className="lede mt-3 max-w-xl" delay={100}>
            No dates on this page, because a date invented to fill a page is
            worth less than none. The order is real and it moves when a shop
            tells us it is wrong.
          </Reveal>

          <ol className="mt-10 grid gap-3">
            {NEXT.map((item, index) => (
              <Reveal
                key={item.title}
                as="li"
                className="panel card-lift flex items-start gap-5 rounded-2xl p-6"
                delay={index * 70}
                y={20}
              >
                <span className="grid h-9 w-9 flex-none place-items-center rounded-xl border border-iris-200/35 bg-gradient-to-br from-iris-400 to-iris-700 font-display text-[0.8125rem] font-extrabold text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.3)]">
                  {item.order}
                </span>
                <div>
                  <h3 className="font-display text-[1rem] font-semibold">
                    {item.title}
                  </h3>
                  <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-mist-400">
                    {item.why}
                  </p>
                </div>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------- Further out ---------- */}
      <section className="section pt-0">
        <div className="shell">
          <Reveal className="flex items-center gap-3">
            <span
              aria-hidden
              className="h-2 w-2 rounded-full bg-sun-400 shadow-[0_0_12px_2px_rgb(250_204_21/0.4)]"
            />
            <h2 className="heading">Further out</h2>
          </Reveal>
          <Reveal as="p" className="lede mt-3 max-w-xl" delay={100}>
            Real work, not vapour — but nothing here should be part of why you
            buy Flo this month.
          </Reveal>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {LATER.map((item, index) => (
              <Reveal
                key={item.title}
                className="glass rounded-2xl p-6"
                delay={index * 70}
                y={22}
              >
                <h3 className="font-display text-[0.9375rem] font-semibold">
                  {item.title}
                </h3>
                <p className="mt-2 text-[0.8125rem] leading-relaxed text-mist-400">
                  {item.copy}
                </p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Not being built ---------- */}
      <section className="section pt-0">
        <div className="shell">
          <Reveal className="panel rim relative overflow-hidden rounded-[24px] p-8 sm:p-12">
            <div aria-hidden className="stars absolute inset-0 opacity-60" />
            <div
              aria-hidden
              className="glow -right-10 -top-24 h-72 w-72 animate-breathe bg-iris-600/20"
            />

            <div className="relative">
              <h2 className="heading">Not being built</h2>
              <p className="lede mt-3 max-w-xl">
                Two decisions worth stating out loud, because both get asked on
                every call.
              </p>

              <div className="mt-10 grid gap-8 lg:grid-cols-2">
                {NEVER.map((item) => (
                  <div key={item.title}>
                    <h3 className="font-display text-[1.0625rem] font-semibold text-mist-50">
                      {item.title}
                    </h3>
                    <p className="mt-2 text-[0.8125rem] leading-relaxed text-mist-400">
                      {item.copy}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <Cta />
    </>
  );
}
