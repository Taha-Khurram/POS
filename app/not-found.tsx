import Link from "next/link";

import { Footer } from "@/components/site/footer";
import { Nav } from "@/components/site/nav";
import { Starfield } from "@/components/site/starfield";

const LINKS = [
  { label: "Products", href: "/products" },
  { label: "Solutions", href: "/solutions" },
  { label: "Pricing", href: "/pricing" },
  { label: "Resources", href: "/resources" },
];

const entrance = (delay: number) => ({
  animation: `fade-up 1s var(--ease-out-soft) ${delay}ms both`,
});

/**
 * The global 404. It sits above the route groups, so it carries the site chrome
 * itself for routes that do not exist.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-full flex-col">
      <Nav />
      <main className="flex-1">
        <section className="relative isolate flex min-h-[calc(100vh-4rem)] items-center overflow-hidden py-28">
          <div aria-hidden className="absolute inset-0 -z-10">
            <div className="absolute inset-0 bg-[radial-gradient(110%_80%_at_50%_0%,#12132b_0%,#08080f_50%,#04040a_100%)]" />
            <Starfield className="absolute inset-0 h-full w-full" />
            <div className="glow left-1/2 top-[18%] h-64 w-[32rem] -translate-x-1/2 animate-breathe bg-iris-600/22" />
          </div>

          <div className="shell text-center">
            <p
              className="font-display text-[clamp(4rem,14vw,8rem)] font-extrabold leading-none tracking-tight"
              style={entrance(60)}
            >
              <span className="text-gradient">404</span>
            </p>

            <h1 className="heading mt-4" style={entrance(160)}>
              This one did not ring up
            </h1>

            <p className="lede mx-auto mt-4 max-w-md" style={entrance(260)}>
              This page has moved or never existed. Here is the rest of the
              counter.
            </p>

            <div
              className="mt-9 flex flex-wrap items-center justify-center gap-3"
              style={entrance(360)}
            >
              <Link href="/" className="btn btn-primary">
                Back to home
              </Link>
              <Link href="/demo" className="btn btn-ghost">
                Book a demo
              </Link>
            </div>

            <ul
              className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-2"
              style={entrance(460)}
            >
              {LINKS.map((link) => (
                <li key={link.label}>
                  <Link href={link.href} className="nav-link text-[0.875rem]">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
