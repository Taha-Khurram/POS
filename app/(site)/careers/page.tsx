import type { Metadata } from "next";
import Link from "next/link";

import { Reveal } from "@/components/motion/reveal";
import { PageHeader } from "@/components/site/page-header";

export const metadata: Metadata = {
  title: "Careers",
  description:
    "Open roles at Flo — engineering, design, support, and sales in Lahore, Karachi, and Islamabad, building POS software for Pakistani shops and restaurants.",
};

const VALUES = [
  {
    title: "Ship where it is used",
    copy: "Every new joiner spends a shift behind a real counter in their first month — a kiryana store in Anarkali, or a karahi place after 9pm. You cannot design a register from a desk in Gulberg.",
  },
  {
    title: "Peak is the spec",
    copy: "Anything that only works on a quiet Tuesday does not work. We test against iftar hour, Eid week, and a 3G connection that keeps dropping.",
  },
  {
    title: "Small teams, whole problems",
    copy: "Two or three people own a surface end to end — research, build, release, and the support messages that follow on WhatsApp.",
  },
  {
    title: "Write it down",
    copy: "We are spread across three cities and work with shopkeepers who cannot take a call mid-rush. A clear note beats a meeting nobody can attend.",
  },
];

const PERKS = [
  "Offices in Lahore and Karachi, remote across Pakistan",
  "Health cover for you, your spouse, and your parents",
  "Equity in every offer",
  "EOBI and provident fund handled properly",
  "Laptop and home internet paid for",
  "Fourteen days off, plus every notified public holiday",
];

const ROLES = [
  {
    title: "Senior Product Engineer, Billing",
    team: "Engineering",
    location: "Lahore or remote — Pakistan",
    type: "Full-time",
  },
  {
    title: "Payments & Integrations Engineer",
    team: "Engineering",
    location: "Karachi or Lahore",
    type: "Full-time",
  },
  {
    title: "Product Designer, Back Office",
    team: "Design",
    location: "Remote — Pakistan",
    type: "Full-time",
  },
  {
    title: "Support Lead, Restaurants",
    team: "Support",
    location: "Lahore",
    type: "Full-time",
  },
  {
    title: "Field Sales Executive",
    team: "Sales",
    location: "Karachi · Lahore · Faisalabad",
    type: "Full-time",
  },
  {
    title: "Onboarding Specialist (Urdu & English)",
    team: "Success",
    location: "Islamabad or remote",
    type: "Contract to hire",
  },
];

export default function CareersPage() {
  return (
    <>
      <PageHeader
        eyebrow="Careers"
        title={
          <>
            Build the software{" "}
            <span className="text-gradient">the rush runs on</span>
          </>
        }
        lede="Flo is twenty-six people in Lahore, Karachi, and Islamabad building one product for the busiest two hours of somebody else's day. If that sounds like a good constraint, we are hiring."
      >
        <Link href="#open-roles" className="btn btn-primary">
          See open roles
        </Link>
      </PageHeader>

      {/* ---------- Values ---------- */}
      <section className="section pt-4">
        <div className="shell">
          <div className="grid gap-4 sm:grid-cols-2">
            {VALUES.map((value, index) => (
              <Reveal
                key={value.title}
                className="panel card-lift spotlight relative overflow-hidden rounded-[22px] p-7"
                delay={index * 100}
                y={28}
              >
                <div
                  aria-hidden
                  className="glow -right-16 -top-20 h-52 w-52 bg-iris-600/18"
                />
                <h2 className="relative font-display text-[1.15rem] font-bold">
                  {value.title}
                </h2>
                <p className="relative mt-2.5 text-[0.8125rem] leading-relaxed text-mist-400">
                  {value.copy}
                </p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Perks ---------- */}
      <section className="section pt-0">
        <div className="shell">
          <Reveal className="panel rim relative overflow-hidden rounded-[24px] p-8 sm:p-12">
            <div aria-hidden className="stars absolute inset-0 opacity-60" />
            <div
              aria-hidden
              className="glow -left-12 -top-20 h-64 w-64 animate-breathe bg-iris-600/20"
            />

            <div className="relative grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div>
                <h2 className="heading">How we work</h2>
                <p className="lede mt-4 max-w-sm">
                  Two offices, remote when it suits you, and deliberate about
                  the weeks we spend in the same room.
                </p>
              </div>

              <ul className="grid gap-2.5 sm:grid-cols-2">
                {PERKS.map((perk, index) => (
                  <Reveal
                    key={perk}
                    as="li"
                    className="glass flex items-start gap-2.5 rounded-2xl px-4 py-3 text-[0.8125rem] leading-relaxed text-mist-300"
                    delay={index * 70}
                    x={20}
                    y={10}
                  >
                    <span
                      aria-hidden
                      className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-iris-400"
                    />
                    {perk}
                  </Reveal>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------- Open roles ---------- */}
      <section id="open-roles" className="section pt-0">
        <div className="shell">
          <div className="mx-auto max-w-2xl text-center">
            <Reveal as="h2" className="heading">
              Open roles
            </Reveal>
            <Reveal as="p" className="lede mx-auto mt-4 max-w-lg" delay={120}>
              Nothing here that fits? Write to us anyway — tell us which part
              of the counter you would fix first.
            </Reveal>
          </div>

          <ul className="mt-12 grid gap-3">
            {ROLES.map((role, index) => (
              <Reveal
                key={role.title}
                as="li"
                delay={index * 70}
                y={22}
                className="panel card-lift group rounded-2xl"
              >
                <a
                  href={`mailto:careers@flo.pk?subject=${encodeURIComponent(
                    role.title,
                  )}`}
                  className="flex flex-col gap-3 px-6 py-5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <h3 className="font-display text-[1rem] font-semibold">
                      {role.title}
                    </h3>
                    <p className="mt-1 text-[0.75rem] text-mist-500">
                      {role.team} · {role.location} · {role.type}
                    </p>
                  </div>

                  <span className="flex shrink-0 items-center gap-2 font-display text-[0.8125rem] font-semibold text-iris-600">
                    Apply
                    <svg
                      viewBox="0 0 16 16"
                      className="h-3.5 w-3.5 transition-transform duration-500 ease-[var(--ease-out-back)] group-hover:translate-x-1"
                      aria-hidden
                    >
                      <path
                        d="M3 8h10M9 4l4 4-4 4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </a>
              </Reveal>
            ))}
          </ul>

          <Reveal className="mt-10 text-center" delay={120}>
            <a
              href="mailto:careers@flo.pk"
              className="btn btn-ghost"
            >
              careers@flo.pk
            </a>
          </Reveal>
        </div>
      </section>
    </>
  );
}
