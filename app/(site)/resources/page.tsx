import type { Metadata } from "next";
import Link from "next/link";

import { Reveal } from "@/components/motion/reveal";
import { PageHeader } from "@/components/site/page-header";
import { Cta } from "@/components/site/cta";

export const metadata: Metadata = {
  title: "Resources",
  description:
    "Guides, benchmarks, and templates for running a Pakistani counter — FBR POS integration, udhaar recovery, stock counts, and Ramadan planning.",
};

const FEATURED = {
  kind: "Playbook",
  title: "The Ramadan and Eid rush playbook",
  copy: "How the shops we work with plan for six weeks that carry the year — iftar-hour staffing, sehri menus, advance mithai orders, stock cover for the Eid shutdown, and the two reports worth reading every morning.",
  meta: "20 min read · Updated February 2026",
};

const ARTICLES = [
  {
    kind: "Guide",
    title: "FBR POS integration, step by step",
    copy: "Registering your outlet, getting the fiscal invoice number on your receipt, and what to do when IRIS is unreachable mid-rush.",
    meta: "14 min read",
  },
  {
    kind: "Guide",
    title: "Udhaar without losing money",
    copy: "Limits per customer, ageing you can actually read, and the WhatsApp reminder that gets paid instead of ignored.",
    meta: "10 min read",
  },
  {
    kind: "Benchmark",
    title: "What good looks like: 2026 Pakistan retail benchmarks",
    copy: "Billing times, return rates, stock variance, and udhaar recovery across 900 counters, split by format and city.",
    meta: "12 min read",
  },
  {
    kind: "Guide",
    title: "Stock counts that take twenty minutes",
    copy: "A weekly routine for kiryana and general stores that fits between deliveries, plus the par-level maths behind it.",
    meta: "7 min read",
  },
  {
    kind: "Template",
    title: "Day-end closing sheet for branch managers",
    copy: "One page per branch: cash, card, wallet, udhaar, and the four figures to reconcile before the shutter comes down.",
    meta: "Download",
  },
  {
    kind: "Guide",
    title: "Moving off the register book and Excel",
    copy: "The import format, the dry run, and the checks to make before your first live shift on Flo.",
    meta: "11 min read",
  },
];

const HELP = [
  { title: "Help centre", copy: "Setup and day-to-day how-tos in Urdu and English." },
  { title: "WhatsApp support", copy: "Message the support line, 9am to 9pm PKT." },
  { title: "Developer docs", copy: "REST API, webhooks, and export formats." },
  { title: "System status", copy: "Live payment, sync, and FBR filing status." },
];

export default function ResourcesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Resources"
        title={
          <>
            Everything we learned{" "}
            <span className="text-gradient">behind the counter</span>
          </>
        }
        lede="Guides, benchmarks, and templates from the shops and restaurants running Flo across Pakistan — written for owners, not for search engines."
      />

      {/* ---------- Featured ---------- */}
      <section className="pb-4">
        <div className="shell">
          <Reveal className="panel rim card-lift relative overflow-hidden rounded-[24px] p-8 sm:p-12">
            <div aria-hidden className="stars absolute inset-0 opacity-60" />
            <div
              aria-hidden
              className="glow -right-10 -top-24 h-72 w-72 animate-breathe bg-iris-600/22"
            />

            <div className="relative max-w-2xl">
              <span className="eyebrow">{FEATURED.kind}</span>
              <h2 className="heading mt-3">{FEATURED.title}</h2>
              <p className="lede mt-4">{FEATURED.copy}</p>
              <p className="mt-4 text-[0.75rem] text-mist-500">
                {FEATURED.meta}
              </p>
              <Link href="/demo" className="btn btn-primary mt-8">
                Get the playbook
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------- Library ---------- */}
      <section className="section">
        <div className="shell">
          <Reveal as="h2" className="heading text-center">
            The library
          </Reveal>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ARTICLES.map((article, index) => (
              <Reveal
                key={article.title}
                as="article"
                className="panel card-lift spotlight relative flex flex-col overflow-hidden rounded-[22px] p-6"
                delay={index * 80}
                y={26}
              >
                <span className="eyebrow text-[0.625rem]">{article.kind}</span>
                <h3 className="mt-2 font-display text-[1.0625rem] font-semibold leading-snug">
                  {article.title}
                </h3>
                <p className="mt-2 flex-1 text-[0.8125rem] leading-relaxed text-mist-400">
                  {article.copy}
                </p>
                <p className="mt-5 border-t border-ink-700 pt-4 text-[0.75rem] text-mist-500">
                  {article.meta}
                </p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Help ---------- */}
      <section className="section pt-0">
        <div
          aria-hidden
          className="glow left-1/2 top-8 h-64 w-[34rem] -translate-x-1/2 bg-iris-700/12"
        />

        <div className="shell relative">
          <Reveal as="h2" className="heading text-center">
            Already running Flo?
          </Reveal>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {HELP.map((item, index) => (
              <Reveal
                key={item.title}
                className="glass card-lift rounded-2xl p-6"
                delay={index * 80}
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

      <Cta />
    </>
  );
}
