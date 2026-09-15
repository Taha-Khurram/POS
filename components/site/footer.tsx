import Link from "next/link";
import { FloMark } from "./flo-mark";

const COLUMNS = [
  {
    heading: "Platform",
    links: [
      { label: "Products", href: "/products" },
      { label: "Solutions", href: "/solutions" },
      { label: "Pricing", href: "/pricing" },
      { label: "Book a demo", href: "/demo" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "Careers", href: "/careers" },
      { label: "Resources", href: "/resources" },
      { label: "Log in", href: "/login" },
    ],
  },
  {
    heading: "Legal",
    links: [{ label: "Privacy & Policy", href: "/privacy" }],
  },
];

export function Footer() {
  return (
    <footer className="relative border-t border-ink-700 bg-ink-950/60 py-12">
      <div className="shell">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
          <div>
            <Link href="/" className="flex items-center gap-2.5">
              <FloMark className="h-7 w-auto" />
            </Link>
            <p className="mt-3 max-w-[18rem] text-[0.8125rem] leading-relaxed text-mist-400">
              Point of sale for Pakistani shops and restaurants — FBR-ready
              billing, udhaar khata, and stock that adds up. Lahore and Karachi.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2 className="font-display text-[0.8125rem] font-semibold text-mist-50">
                {column.heading}
              </h2>
              <ul className="mt-3 grid gap-2">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href} className="nav-link text-[0.875rem]">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <p className="mt-10 border-t border-ink-700 pt-6 text-center text-[0.75rem] text-mist-500">
          © {new Date().getFullYear()} Flo. Point of sale for Pakistani retail
          and hospitality.
        </p>
      </div>
    </footer>
  );
}
