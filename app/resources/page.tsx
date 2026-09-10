import type { Metadata } from "next";
import Link from "next/link";

import { Reveal } from "@/components/motion/reveal";
import { PageHeader } from "@/components/site/page-header";
import { Cta } from "@/components/site/cta";

export const metadata: Metadata = {
  title: "Resources",
  description:
    "Guides, benchmarks, and help-centre material for running a faster counter — from menu design to close-out routines.",
};

const FEATURED = {
  kind: "Playbook",
  title: "The ninety-minute rush playbook",
  copy: "Twelve changes that shortened peak-hour tickets for the cafés we work with — menu layout, modifier order, prep staging, and the two reports worth reading every morning.",
  meta: "18 min read · Updated March 2026",
};

const ARTICLES = [
  {
    kind: "Guide",
    title: "Designing a menu your register can keep up with",
    copy: "Why the first six buttons decide your ticket time, and how to pick them from last month's data.",
    meta: "9 min read",
  },
  {
    kind: "Benchmark",
    title: "What good looks like: 2026 hospitality benchmarks",
    copy: "Ticket times, void rates, and stock variance across 1,200 counters, split by format and size.",
    meta: "12 min read",
  },
  {
    kind: "Guide",
    title: "Stock counts that take twenty minutes",
    copy: "A weekly routine that fits between deliveries, plus the par-level maths behind it.",
    meta: "7 min read",
  },
  {
    kind: "Template",
    title: "Close-out checklist for multi-site managers",
    copy: "One page per site, the four numbers to reconcile, and what to escalate the same night.",
    meta: "Download",
  },
  {
    kind: "Case study",
    title: "Saltbox: nine stores, one catalog",
    copy: "How a regional grocer cut price-change work from two days to one afternoon.",
    meta: "6 min read",
  },
  {
    kind: "Guide",
    title: "Migrating your catalog without a closed day",
    copy: "The import format, the dry run, and the checks to make before the first live shift.",
    meta: "11 min read",
  },
];

const HELP = [
  { title: "Help centre", copy: "Setup, hardware, and day-to-day how-tos." },
  { title: "Developer docs", copy: "REST API, webhooks, and export formats." },
  { title: "System status", copy: "Live payment and sync availability." },
  { title: "Release notes", copy: "What shipped, every second Thursday." },
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
        lede="Guides, benchmarks, and templates from the teams running Flo — written for operators, not for search engines."
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
                <p className="mt-5 border-t border-white/6 pt-4 text-[0.75rem] text-mist-500">
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
