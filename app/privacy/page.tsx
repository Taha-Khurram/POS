import type { Metadata } from "next";
import Link from "next/link";

import { Reveal } from "@/components/motion/reveal";
import { PageHeader } from "@/components/site/page-header";

export const metadata: Metadata = {
  title: "Privacy & Policy",
  description:
    "What Flo collects, why we hold it, how long we keep it, and the rights you have over it.",
};

const UPDATED = "1 March 2026";

const SECTIONS = [
  {
    id: "what-we-collect",
    title: "What we collect",
    body: [
      "Account data you give us: the names, work email addresses, and phone numbers of the people who administer your Flo account, plus your business details and billing address.",
      "Transaction data produced by your registers: line items, totals, taxes, tips, refunds, timestamps, and the register and staff PIN that recorded each sale. Card numbers never touch our servers — the reader tokenises them and we store only the token, the last four digits, and the card brand.",
      "Customer data you choose to hold in Flo: names, contact details, loyalty balances, and order history, entered either by your staff or by a customer at checkout.",
      "Product and site data: pages viewed on this website, device and browser type, and in-app events such as which reports are opened. We use this to work out which parts of the product need attention.",
    ],
  },
  {
    id: "why-we-hold-it",
    title: "Why we hold it",
    body: [
      "To run the service you pay for — processing payments, syncing catalogs, producing reports, and keeping registers working offline and back in sync.",
      "To meet legal obligations, including tax records, anti-money-laundering checks, and the retention periods our payment partners require.",
      "To support you: diagnosing a failed payment or a stock discrepancy sometimes means looking at the records behind it.",
      "To improve the product, using aggregated and de-identified data. We do not sell personal data, and we do not use your customers' data to advertise to them.",
    ],
  },
  {
    id: "who-sees-it",
    title: "Who else sees it",
    body: [
      "Payment partners, who receive what they need to authorise and settle a card payment.",
      "Infrastructure providers who host the service under contract and are barred from using the data for anything else.",
      "Authorities, where a valid legal request compels disclosure. Where we are permitted to tell you about such a request, we will.",
      "Nobody else. We do not share or sell data to advertisers, data brokers, or list resellers.",
    ],
  },
  {
    id: "how-long",
    title: "How long we keep it",
    body: [
      "Transaction records are held for seven years, which is the period our financial and tax obligations require.",
      "Customer records you create are yours: delete them in the back office and they are removed from live systems immediately and from backups within 35 days.",
      "If you close your account, we delete or de-identify everything not covered by a legal retention period within 90 days, and export your data in full on request before then.",
    ],
  },
  {
    id: "your-rights",
    title: "Your rights",
    body: [
      "You can ask for a copy of the personal data we hold about you, ask us to correct it, or ask us to delete it. Where you are a customer of a business running Flo, that business is the controller of your data — we will pass your request to them and help them act on it.",
      "You can object to processing based on our legitimate interests, and withdraw consent where we relied on it, without affecting anything done beforehand.",
      "You can complain to your local data protection authority. We would rather hear from you first so we can put it right.",
    ],
  },
  {
    id: "security",
    title: "Security",
    body: [
      "Data is encrypted in transit and at rest. Access to production systems is limited to staff who need it, granted for a fixed period, and logged.",
      "We are PCI DSS Level 1 compliant and assessed annually. Penetration tests are run twice a year by an external firm, and material findings are summarised in the trust report available to customers on request.",
    ],
  },
  {
    id: "cookies",
    title: "Cookies",
    body: [
      "This site uses cookies that keep you signed in and remember your preferences, plus a small set of analytics cookies that tell us which pages are read. You can decline the analytics cookies without losing any functionality.",
    ],
  },
  {
    id: "contact",
    title: "Contact",
    body: [
      "Write to privacy@flopos.example, or to the Data Protection Officer, Flo, 14 Anchor Yard, London EC1V 9BW. We answer privacy requests within 30 days.",
      "If this policy changes materially, we will tell account administrators by email at least 14 days before it takes effect.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <>
      <PageHeader
        eyebrow="Legal"
        title="Privacy & Policy"
        lede={`How Flo handles the data you and your customers trust us with. Last updated ${UPDATED}.`}
      />

      <section className="section pt-4">
        <div className="shell">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,0.32fr)_minmax(0,1fr)] lg:gap-12">
            {/* Contents — sticky on desktop, a plain list on mobile */}
            <Reveal
              as="nav"
              aria-label="On this page"
              className="lg:sticky lg:top-28 lg:self-start"
              y={20}
            >
              <h2 className="eyebrow">On this page</h2>
              <ul className="mt-4 grid gap-2">
                {SECTIONS.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className="text-[0.8125rem] text-mist-400 transition-colors duration-300 hover:text-mist-50"
                    >
                      {section.title}
                    </a>
                  </li>
                ))}
              </ul>
            </Reveal>

            <div className="grid gap-10">
              {SECTIONS.map((section, index) => (
                <Reveal
                  key={section.id}
                  as="section"
                  id={section.id}
                  className="scroll-mt-28"
                  delay={index * 60}
                  y={24}
                >
                  <h2 className="font-display text-[1.35rem] font-bold">
                    {section.title}
                  </h2>
                  <div className="mt-4 grid gap-4">
                    {section.body.map((paragraph) => (
                      <p
                        key={paragraph.slice(0, 40)}
                        className="text-[0.9375rem] leading-relaxed text-mist-300"
                      >
                        {paragraph}
                      </p>
                    ))}
                  </div>
                </Reveal>
              ))}

              <Reveal className="panel rounded-2xl p-6" y={20}>
                <p className="text-[0.8125rem] leading-relaxed text-mist-400">
                  This page describes how Flo handles data. For the commercial
                  terms of the service, see your order form, or{" "}
                  <Link
                    href="/demo"
                    className="font-medium text-iris-300 transition-colors duration-300 hover:text-iris-200"
                  >
                    ask us for a copy
                  </Link>
                  .
                </p>
              </Reveal>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
