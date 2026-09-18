import type { Metadata } from "next";
import Link from "next/link";

import { Reveal } from "@/components/motion/reveal";
import { PageHeader } from "@/components/site/page-header";
import { Capabilities } from "@/components/site/capabilities";
import { Foundation } from "@/components/site/foundation";
import { Cta } from "@/components/site/cta";

export const metadata: Metadata = {
  title: "Products",
  description:
    "Billing, payments, stock, customers, staff, FBR compliance, and reporting — the modules that run a Pakistani counter and everything behind it.",
};

const MODULES = [
  {
    name: "Billing",
    tag: "On the counter",
    copy: "A register your staff picks up in one shift. Fast item search in English or Urdu, weight and carton sales, returns, and holds — without hunting through menus.",
    points: [
      "Works offline through power cuts",
      "Sell by piece, kilo, carton, or plate",
      "Kitchen and bakery print routing",
    ],
  },
  {
    name: "Payments",
    tag: "At the counter",
    copy: "Cash, card, Raast QR, Easypaisa, and JazzCash settle into one day-end figure, so the drawer and the bank statement finally agree.",
    points: [
      "Raast and wallet QR on the receipt",
      "Card terminals via 1LINK acquirers",
      "Split a bill across cash and wallet",
    ],
  },
  {
    name: "Stock",
    tag: "In the store",
    copy: "Counts that stay honest between deliveries, with wastage, expiry, and supplier rates tracked per branch.",
    points: [
      "Recipe and BOM depletion",
      "Expiry and batch tracking",
      "Supplier rate history per item",
    ],
  },
  {
    name: "Customers",
    tag: "For regulars",
    copy: "The register book, kept properly. A name, a number, and every bill they have been on — so the new rate list goes to the people who actually buy from you.",
    points: [
      "Found by name or phone at the till",
      "Every bill attached to the customer",
      "The note you would have written in the margin",
    ],
  },
  {
    name: "Staff",
    tag: "On the roster",
    copy: "Attendance, permissions, and shift-wise cash accountability that match how the day actually ran.",
    points: [
      "PIN-level permissions and discount limits",
      "Attendance and overtime records",
      "Shift-wise cash and short reports",
    ],
  },
  {
    name: "FBR & tax",
    tag: "For compliance",
    copy: "Fiscal invoice numbers and verification QR codes printed on every bill, filed as you sell — plus the provincial service-tax returns for restaurants.",
    points: [
      "FBR POS integration with IRIS",
      "Offline invoices queue and post later",
      "PRA, SRB, and KPRA service tax",
    ],
  },
  {
    name: "Reporting",
    tag: "After closing",
    copy: "One number per question. Sales by hour, by item, by cashier, and by branch — on your phone before you reach home.",
    points: [
      "Hour-by-hour sales heatmap",
      "Branch comparisons across cities",
      "Daily WhatsApp closing summary",
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
            <span className="text-gradient">nothing it doesn&rsquo;t</span>
          </>
        }
        lede="Seven modules sharing one catalog, one customer list, and one set of numbers — so the register, the store, the tax file, and the owner&rsquo;s phone never disagree."
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

            <Reveal
              className="relative flex min-h-[220px] flex-col justify-between overflow-hidden rounded-[22px] border border-iris-200/25 bg-gradient-to-br from-iris-500 via-iris-600 to-iris-700 p-6 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.28),0_30px_70px_-34px_rgb(79_70_229/0.85)]"
              delay={MODULES.length * 90}
              y={28}
            >
              <div
                aria-hidden
                className="absolute -right-12 -top-14 h-48 w-48 rounded-full bg-white/20 blur-3xl"
              />
              <h2 className="relative font-display text-[1.25rem] font-bold leading-tight text-white">
                Use the hardware
                <br />
                you already have.
              </h2>
              <p className="relative mt-3 text-[0.8125rem] leading-relaxed text-white/80">
                Flo runs on any Android tablet, billing terminal, or shop
                computer. Need the full counter kit with printer, scanner, and
                drawer? We ship it configured anywhere in Pakistan.
              </p>
              <Link
                href="/demo"
                className="btn btn-ghost btn-sm relative mt-5 self-start border-white/40 bg-white/10 text-white"
              >
                Talk to us
              </Link>
            </Reveal>
          </div>
        </div>
      </section>

      <Capabilities />
      <Foundation />
      <Cta />
    </>
  );
}
