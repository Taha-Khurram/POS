import type { Metadata } from "next";
import Link from "next/link";

import { Reveal } from "@/components/motion/reveal";
import { PageHeader } from "@/components/site/page-header";
import { AlsoInTheBox, ProductTour } from "@/components/site/product-tour";
import { Capabilities } from "@/components/site/capabilities";
import { Foundation } from "@/components/site/foundation";
import { Cta } from "@/components/site/cta";

export const metadata: Metadata = {
  title: "Products",
  description:
    "The six screens of Flo: the register, sales history, products and stock, customers, staff and permissions, and the dashboard. Everything on this page is photographed from the working software.",
};

/**
 * Six modules, and they are the six a signed-in shop actually sees in the rail.
 * The seventh card names what is not built rather than leaving a shopkeeper to
 * find out on the day they tap it.
 */
const MODULES = [
  {
    name: "Register",
    tag: "On the counter",
    copy: "Scan a barcode, or type three letters of the English or Urdu name. One line per item, a running total, and a receipt off the roll.",
    points: [
      "Loose goods by weight, packets and cartons by the piece",
      "Cash with change worked out, or card",
      "Rs 20 off or ten per cent, up to the ceiling you set",
      "Put a bill down and pick it up when they come back",
      "A regular attached to the bill — always optional",
    ],
  },
  {
    name: "Sales history",
    tag: "After the sale",
    copy: "Every bill the shop has rung up, searchable by number, customer, phone or amount — and a day-close view that counts one drawer against one row.",
    points: [
      "Narrow by counter, by cashier, by cash or card",
      "Open a bill, look at its lines, print it again marked DUPLICATE",
      "Take a return against it, line by line, and print the slip",
      "An opening float, a counted drawer and the over-or-short",
      "Export what is on screen to CSV",
    ],
  },
  {
    name: "Products & stock",
    tag: "In the store",
    copy: "Your own item list: barcode, SKU, Urdu name, unit, supplier, tax rate, what it costs you and what you sell it for — with the margin worked out beside them.",
    points: [
      "The count goes down with every sale and back up with a return",
      "Every change written down with its reason and its receipt",
      "A low-stock alert set per item, not one number for the shop",
      "Departments and categories you name yourself",
      "Bring a rate list in as CSV, checked row by row",
    ],
  },
  {
    name: "Customers",
    tag: "For regulars",
    copy: "The register book, kept properly. A name, a number, and every bill they have been on — so you can tell a regular from a walk-in without remembering a face.",
    points: [
      "The phone is the identity, so one number is one person",
      "Found at the till mid-queue",
      "Their own page shows what they have actually bought",
    ],
  },
  {
    name: "Staff",
    tag: "Behind the till",
    copy: "Add a cashier or a store manager and Flo mints a work email and a password to read out. Every bill records who rang it up.",
    points: [
      "Assign somebody to a counter",
      "Suspend an account the day somebody leaves",
      "One owner per shop, and this screen cannot make a second",
    ],
  },
  {
    name: "Settings",
    tag: "Once, at setup",
    copy: "Your currency and how it prints, your timezone, and the hour your trading day ends — so a shop that shuts at 1am keeps its last hour on the right day.",
    points: [
      "A counter each for the front and the back, with its own receipt series",
      "What a cashier may do, and the discount ceiling they stop at",
      "A line of your own at the foot of every receipt",
    ],
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
            <span className="text-gradient">and nothing it doesn&rsquo;t</span>
          </>
        }
        lede="Six screens sharing one item list, one customer list, and one set of numbers — so the register, the store room and the owner&rsquo;s phone never disagree."
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

                <ul className="mt-5 grid gap-2 border-t border-ink-700 pt-4">
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

            {/* The card that says what is missing. It is on the products page
                on purpose: a shopkeeper who was going to ask on the call should
                find the answer before it. */}
            <Reveal
              className="relative flex min-h-[220px] flex-col justify-between overflow-hidden rounded-[22px] border border-iris-200/25 bg-gradient-to-br from-iris-500 via-iris-600 to-iris-700 p-6 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.28),0_30px_70px_-34px_rgb(79_70_229/0.85)]"
              delay={MODULES.length * 90}
              y={28}
            >
              <div
                aria-hidden
                className="absolute -right-12 -top-14 h-48 w-48 rounded-full bg-white/20 blur-3xl"
              />
              <div className="relative">
                <h2 className="font-display text-[1.25rem] font-bold leading-tight text-white">
                  What is not here yet
                </h2>
                <p className="mt-3 text-[0.8125rem] leading-relaxed text-white/85">
                  The reports module, billing while the internet is down, and
                  purchase orders against your suppliers. They are being built
                  in that order, and none of them are on this page pretending
                  otherwise.
                </p>
              </div>
              <Link
                href="/roadmap"
                className="btn btn-ghost btn-sm relative mt-5 self-start border-white/40 bg-white/10 text-white"
              >
                See the roadmap
              </Link>
            </Reveal>
          </div>
        </div>
      </section>

      <ProductTour />
      <AlsoInTheBox />
      <Capabilities />
      <Foundation />
      <Cta />
    </>
  );
}
