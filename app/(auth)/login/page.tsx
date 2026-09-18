import type { Metadata } from "next";
import Link from "next/link";

import { FloMark } from "@/components/site/flo-mark";
import { Starfield } from "@/components/site/starfield";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Log in",
  description: "Sign in to your Flo dashboard.",
  // Nothing here should ever land in a search result.
  robots: { index: false, follow: false },
};

const entrance = (delay: number) => ({
  animation: `fade-up 1s var(--ease-out-soft) ${delay}ms both`,
});

/** What the person signing in is about to walk into, in their own terms. */
const INSIDE: { title: string; detail: string }[] = [
  {
    title: "Aaj ka hisaab, on one screen",
    detail:
      "Sales, profit, margin and basket count for today — or any window back to last month — the moment you land.",
  },
  {
    title: "FBR digital invoicing, already filed",
    detail:
      "Every completed receipt carries its invoice number. No separate portal at the end of the month.",
  },
  {
    title: "Your regulars, on the till",
    detail:
      "A name, a number, and every bill they have been on. Found while the shopping is still on the counter.",
  },
  {
    title: "Keeps billing through load-shedding",
    detail:
      "The counter works offline and settles up when the light comes back. A dead UPS is not a closed shop.",
  },
];

/**
 * Why a session ended by itself, in the words of somebody who did not expect
 * it. Neither says more than the person is entitled to know: the owner made a
 * decision about their account, and the owner is who they have to ask.
 */
const ENDED: Record<string, string> = {
  removed:
    "Your account was removed from this shop. Ask the owner if that was not meant to happen.",
  suspended:
    "Your account is suspended for now. The owner can switch it back on.",
};

/** Numbers that mean something at a counter, not vanity metrics. */
const PROOF: { figure: string; label: string }[] = [
  { figure: "< 2s", label: "to ring up a basket" },
  { figure: "9am–2am", label: "support on WhatsApp" },
  { figure: "Rs 0", label: "to switch your data over" },
];

/**
 * The sign-in screen. It lives in `(auth)`, not `(site)`, so it carries no Nav
 * and no Footer — see the layout note.
 *
 * Two panels: what is behind the door on the left, the door itself on the
 * right. Below `lg` the left panel collapses to a short strip rather than
 * disappearing, because a shopkeeper opening this on a phone at 8am still
 * wants to know they are in the right place before typing a password.
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // Set by `/logout` when the console ended the session rather than the person
  // — they are looking at a login screen they did not ask for, and a screen
  // that says nothing about why is a WhatsApp message to the owner either way.
  const { ended } = await searchParams;
  const notice = typeof ended === "string" ? ENDED[ended] : undefined;

  return (
    <div className="relative isolate grid min-h-dvh lg:grid-cols-[1.05fr_minmax(0,0.95fr)]">
      <div aria-hidden className="absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(110%_80%_at_20%_0%,var(--wash-near)_0%,var(--wash-mid)_52%,var(--wash-far)_100%)]" />
        <Starfield className="absolute inset-0 h-full w-full" />
        <div className="glow left-[10%] top-[8%] h-80 w-[36rem] animate-breathe bg-iris-600/20" />
        <div className="glow right-[4%] bottom-[6%] h-72 w-[28rem] bg-iris-500/12" />
      </div>

      {/* ---------------- Left: what Flo is ---------------- */}
      <section className="flex flex-col justify-between gap-12 px-6 py-10 sm:px-10 lg:py-14 xl:px-16">
        <header style={entrance(40)}>
          <Link href="/" className="inline-flex" aria-label="Flo home">
            <FloMark priority className="h-8 w-auto" />
          </Link>
        </header>

        <div className="max-w-xl">
          <p className="eyebrow" style={entrance(100)}>
            Flo back office
          </p>

          <h1
            className="mt-4 font-display text-[clamp(2rem,4.4vw,3.1rem)] leading-[1.06] font-bold"
            style={entrance(160)}
          >
            Your counter,{" "}
            <span className="text-gradient">already counted</span>.
          </h1>

          <p className="lede mt-4" style={entrance(220)}>
            Sign in to the dashboard your shop has been filling all day — from
            Karachi to Sialkot, on the same tablet you bill on.
          </p>

          <ul className="mt-9 grid gap-5 sm:grid-cols-2">
            {INSIDE.map((item, index) => (
              <li key={item.title} style={entrance(300 + index * 70)}>
                <p className="flex items-center gap-2 font-display text-[0.9375rem] font-semibold">
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 flex-none rounded-full bg-iris-400"
                  />
                  {item.title}
                </p>
                <p className="mt-1.5 pl-3.5 text-[0.8125rem] leading-relaxed text-mist-400">
                  {item.detail}
                </p>
              </li>
            ))}
          </ul>
        </div>

        <dl
          className="flex flex-wrap gap-x-10 gap-y-5 border-t border-ink-600 pt-7"
          style={entrance(620)}
        >
          {PROOF.map((item) => (
            <div key={item.label}>
              <dt className="font-display text-[1.375rem] font-bold tabular-nums">
                {item.figure}
              </dt>
              <dd className="mt-0.5 text-[0.75rem] text-mist-400">{item.label}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ---------------- Right: the form ---------------- */}
      <section className="flex items-center justify-center px-6 pb-14 sm:px-10 lg:py-14">
        <div className="w-full max-w-[26rem]">
          <div
            className="panel rim relative overflow-hidden rounded-[24px] p-7 sm:p-8"
            style={entrance(240)}
          >
            <div
              aria-hidden
              className="glow -right-14 -top-20 h-52 w-52 bg-iris-600/18"
            />

            <div className="relative">
              <h2 className="font-display text-[1.5rem] leading-tight font-bold">
                Welcome back
              </h2>
              <p className="mt-1.5 text-[0.875rem] text-mist-400">
                Sign in and we will take you straight to the dashboard.
              </p>

              {notice ? (
                <p
                  role="status"
                  className="mt-5 rounded-2xl border border-sun-400/30 bg-sun-400/10 px-4 py-3 text-[0.8125rem] leading-relaxed text-mist-200"
                >
                  {notice}
                </p>
              ) : null}

              <div className="mt-7">
                <LoginForm />
              </div>
            </div>
          </div>

          <p
            className="mt-6 text-center text-[0.8125rem] leading-relaxed text-mist-400"
            style={entrance(360)}
          >
            Locked out, or not set up yet?{" "}
            <Link
              href="/demo"
              className="font-medium text-iris-600 transition-colors duration-300 hover:text-iris-500"
            >
              Message us
            </Link>{" "}
            and we will sort it on the same WhatsApp number you arranged Flo on.
          </p>

          <p
            className="mt-8 text-center text-[0.75rem] text-mist-500"
            style={entrance(420)}
          >
            <Link
              href="/"
              className="transition-colors duration-300 hover:text-mist-200"
            >
              Back to flo.pk
            </Link>
            <span aria-hidden className="px-2 text-mist-400">
              ·
            </span>
            <Link
              href="/privacy"
              className="transition-colors duration-300 hover:text-mist-200"
            >
              Privacy
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
