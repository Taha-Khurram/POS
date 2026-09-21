import Image from "next/image";

import { Reveal } from "@/components/motion/reveal";

/**
 * The product, photographed.
 *
 * Every frame below is a file in `public/shots/`, written by `npm run shots`
 * from the running console — not a mock, not a redraw. That is the whole point:
 * a hand-built picture of your own product drifts the moment the product moves,
 * and drifts silently, because nothing links the two files. This cannot.
 *
 * It follows that **a claim on this page must be visible in the frame beside
 * it.** If a sentence here describes something the screenshot does not show,
 * one of the two is wrong, and it is usually the sentence.
 */

/** Viewport 1280×820 at 2x, straight from `scripts/shots.mjs`. */
const SHOT = { width: 2560, height: 1640 };

type Screen = {
  src: string;
  eyebrow: string;
  title: string;
  copy: string;
  points: string[];
  alt: string;
};

const SCREENS: Screen[] = [
  {
    src: "/shots/register.png",
    eyebrow: "The counter",
    title: "Scan it, or type three letters of the Urdu name",
    copy: "One box finds an item by barcode, English name, Urdu name or SKU. A USB scanner just works — it types digits and presses Enter. No scanner yet? The tablet's own camera reads the barcode.",
    points: [
      "Loose goods by the quarter kilo, packets by the piece",
      "Sales tax already inside the price, the way a customer pays it",
      "A regular attached to the bill by name or phone — always optional",
    ],
    alt: "The Flo register: five items on the bill with their Urdu names, quantities in packets and kilos, a customer attached, and a running total of Rs 3,825.",
  },
  {
    src: "/shots/sales-history.png",
    eyebrow: "Every bill",
    title: "Find last Tuesday's receipt while the customer waits",
    copy: "A whole window of trading days arrives in one read, then searching and filtering happen in the browser — so a bill number, a phone, or an amount finds the bill without another round trip over shop 3G.",
    points: [
      "Narrow by counter, by who rang it up, by cash or card",
      "The totals above the table are the totals of the rows under it",
      "Reprints are stamped DUPLICATE, so a copy is never mistaken for the original",
    ],
    alt: "Flo's sales history: eighty bills for one trading day with the total taken, cash and card split out, and a searchable table showing each bill number, counter, cashier, customer and amount.",
  },
  {
    src: "/shots/inventory.png",
    eyebrow: "The shop's list",
    title: "What it costs you, beside what you sell it for",
    copy: "Cost, price and the margin between them on every line, with the Urdu name the shelf label carries and a low-stock alert set per item — not one number for the whole shop.",
    points: [
      "Barcode, SKU, supplier, tax rate and unit on each item",
      "Bring your rate list in as CSV — the import checks every row the way the form does",
      "Switch a seasonal line off instead of deleting its history",
    ],
    alt: "Flo's product list: fifty-two items with Urdu names, categories, cost, price, margin and stock on hand, with three items flagged as running low.",
  },
  {
    src: "/shots/purchasing.png",
    eyebrow: "The other side of the counter",
    title: "What you ordered, what came in, and what it really cost",
    copy: "An order is what you asked for and a delivery is what turned up — and how much of an order has arrived is counted off the deliveries against it rather than stored in a column, so “one of two in” cannot drift from what is on the shelf.",
    points: [
      "Carriage spread across the lines, so a Rs 2,400 bhaara is in what the carton cost",
      "What you owe, across every distributor, on one line",
      "A delivery is recorded even when no order came before it — which is most of them",
    ],
    alt: "Flo's buying screen: three orders still open worth Rs 179,950, Rs 196,070 owed across four suppliers, Rs 4,200 of carriage on Rs 183,570 of stock, and five purchase orders listed with how much of each has been delivered.",
  },
  {
    src: "/shots/customers.png",
    eyebrow: "The regulars",
    title: "The register book, kept properly",
    copy: "A name, a number, and every bill they have been on. The phone is the identity, not the name — two brothers are both called Bilal, and one number is one person.",
    points: [
      "Found at the till by name or by phone, mid-queue",
      "Their own page shows what they have actually bought",
      "The note you would have written in the margin",
    ],
    alt: "Flo's customer list: twenty regulars with phone numbers, addresses and notes such as “Wholesale rate agreed on daal”.",
  },
  {
    src: "/shots/day-close.png",
    eyebrow: "Eleven at night",
    title: "Count one drawer against one row",
    copy: "Each counter's bills, cash, card and total for the trading day — plus the last receipt number it issued, so a cashier can check their own drawer against the screen.",
    points: [
      "The trading day is yours: a shop that shuts at 1am keeps its last hour",
      "Walk back a day at a time",
      "Export what is on screen to CSV — money as numbers a spreadsheet can add",
    ],
    alt: "Flo's day close: Rs 129,305 taken across two counters, split into cash and card, with each counter's bill count and last receipt number.",
  },
  {
    src: "/shots/reports.png",
    eyebrow: "The accountant's question",
    title: "Every figure says where it came from",
    copy: "Five tabs over one period: what the shop took, which items made it, which half of the shop made it, how it was paid for, and what is on the shelves. Hover any figure and it explains itself in the shop's own words — the same sentence the exported file carries.",
    points: [
      "Sales, cost of goods, profit and margin, each against the period before it",
      "An item you never costed reads as pure profit, and the screen says so rather than quietly flattering the total",
      "Bills, the average bill, lines per bill, and the best day in the period",
    ],
    alt: "Flo's reports: Rs 2,988,889 of sales over 30 trading days against Rs 2,567,868 of cost, leaving Rs 421,021 of profit at a 14.1% margin, with each line captioned by where its figure came from and a note that an item with no cost price reads as pure profit.",
  },
  {
    src: "/shots/permissions.png",
    eyebrow: "Who can do what",
    title: "A cashier sees the till. Not the margins.",
    copy: "Switches per access level, set once by the owner. A screen somebody may not use is not greyed out for them — it is not there, and typing the address does not find it either.",
    points: [
      "Discounts up to a ceiling you set",
      "Profit and margins are a separate switch from today's sales total",
      "Staff and Settings stay with the owner, with no switch that could hide them",
    ],
    alt: "Flo's permissions screen: per-role switches for discounts, the customer list, returns, the drawer, shift close, editing items, changing prices and seeing reports.",
  },
];

export function ProductTour() {
  return (
    <section className="section">
      <div className="shell">
        <div className="mx-auto max-w-2xl text-center">
          <Reveal as="h2" className="heading">
            This is the product, not a drawing of it
          </Reveal>
          <Reveal as="p" className="lede mx-auto mt-4 max-w-lg" delay={120}>
            Every screen below is photographed from the running software. What
            you see is what a shop gets on the first day.
          </Reveal>
        </div>

        <div className="mt-14 grid gap-14 lg:mt-20 lg:gap-20">
          {SCREENS.map((screen, index) => (
            <div
              key={screen.src}
              className="grid items-center gap-8 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1fr)] lg:gap-12"
            >
              <Reveal
                className={index % 2 === 1 ? "lg:order-2" : ""}
                x={index % 2 === 1 ? 26 : -26}
                y={18}
              >
                <span className="eyebrow">{screen.eyebrow}</span>
                <h3 className="mt-3 font-display text-[1.5rem] leading-tight font-bold sm:text-[1.75rem]">
                  {screen.title}
                </h3>
                <p className="mt-4 text-[0.9375rem] leading-relaxed text-mist-400">
                  {screen.copy}
                </p>

                <ul className="mt-6 grid gap-2.5 border-t border-ink-700 pt-5">
                  {screen.points.map((point) => (
                    <li
                      key={point}
                      className="flex items-start gap-2.5 text-[0.8125rem] leading-relaxed text-mist-300"
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

              <Reveal
                className="relative"
                delay={110}
                x={index % 2 === 1 ? -26 : 26}
                y={18}
                scale={0.97}
              >
                <div
                  aria-hidden
                  className="glow inset-x-6 -bottom-8 top-12 bg-iris-600/18 blur-[70px]"
                />
                <div className="panel rim relative overflow-hidden rounded-[18px] shadow-[0_40px_100px_-48px_rgb(33_21_102/0.28)] sm:rounded-[22px]">
                  <Image
                    src={screen.src}
                    width={SHOT.width}
                    height={SHOT.height}
                    sizes="(min-width: 1024px) 620px, 100vw"
                    className="block h-auto w-full"
                    alt={screen.alt}
                  />
                </div>
              </Reveal>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

const ALSO: { src: string; title: string; copy: string; alt: string }[] = [
  {
    src: "/shots/categories.png",
    title: "Your aisles, not ours",
    copy: "Departments and categories you name yourself. A new shop starts empty, because a supermarket's aisle list is not a head start for a cloth house.",
    alt: "Flo's category screen: six departments a shop named itself, each with its own categories and item counts.",
  },
  {
    src: "/shots/staff.png",
    title: "Staff with their own sign-in",
    copy: "Add a cashier and Flo mints a work email and password to read out. Every bill records who rang it up.",
    alt: "Flo's staff screen: the owner plus a store manager and a cashier, each with a work email and an assigned counter.",
  },
  {
    src: "/shots/dashboard-dark.png",
    title: "A night mode that is the same palette",
    copy: "The counter is light, because dark glass is unreadable under a tube light at 2pm. After closing, one tap turns it down.",
    alt: "The Flo dashboard in its dark theme, showing the same sales, profit, cost and margin figures.",
  },
];

export function AlsoInTheBox() {
  return (
    <section className="section pt-0">
      <div className="shell">
        <div className="grid gap-4 lg:grid-cols-3">
          {ALSO.map((item, index) => (
            <Reveal
              key={item.src}
              className="panel card-lift relative flex flex-col overflow-hidden rounded-[22px] p-6"
              delay={index * 100}
              y={26}
            >
              <h3 className="font-display text-[1.0625rem] font-semibold">
                {item.title}
              </h3>
              <p className="mt-2 flex-1 text-[0.8125rem] leading-relaxed text-mist-400">
                {item.copy}
              </p>

              <div className="mt-5 overflow-hidden rounded-xl border border-ink-700">
                <Image
                  src={item.src}
                  width={SHOT.width}
                  height={SHOT.height}
                  sizes="(min-width: 1024px) 360px, 100vw"
                  className="block h-auto w-full"
                  alt={item.alt}
                />
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
