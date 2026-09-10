"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FloMark } from "./flo-mark";

const LINKS = [
  { label: "Solutions", href: "#solutions" },
  { label: "Products", href: "#products" },
  { label: "Pricing", href: "#pricing" },
  { label: "Careers", href: "#careers" },
  { label: "Resources", href: "#resources" },
];

export function Nav() {
  const [condensed, setCondensed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setCondensed(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Don't let the page scroll behind the open mobile sheet.
  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <header className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4 sm:pt-5">
      <nav
        aria-label="Main"
        className="glass relative w-full max-w-[1120px] transition-[padding,box-shadow,border-radius] duration-500 ease-[var(--ease-out-soft)]"
        style={{
          padding: condensed ? "0.5rem 0.75rem" : "0.6875rem 0.9375rem",
          // A pill while collapsed; a rounded sheet once the menu expands,
          // since a 50% radius on a tall box renders as an ellipse.
          borderRadius: menuOpen ? "1.75rem" : "999px",
          boxShadow: condensed
            ? "0 18px 50px -24px rgb(4 4 10 / 0.9), inset 0 1px 0 0 rgb(255 255 255 / 0.06)"
            : "0 10px 34px -26px rgb(4 4 10 / 0.7)",
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <Link
            href="#top"
            className="group flex shrink-0 items-center gap-2.5 rounded-full pl-2 pr-3 py-1"
          >
            <FloMark className="h-7 w-7 transition-transform duration-500 ease-[var(--ease-out-back)] group-hover:rotate-[-8deg] group-hover:scale-110" />
            <span className="font-display text-[1.0625rem] font-bold tracking-tight text-mist-50">
              Flo
            </span>
          </Link>

          <ul className="hidden items-center gap-8 lg:flex">
            {LINKS.map((link) => (
              <li key={link.label}>
                <a href={link.href} className="nav-link">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-2">
            <a href="#login" className="btn btn-primary btn-sm hidden sm:inline-flex">
              Log in
            </a>

            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              className="relative grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/5 transition-colors duration-300 hover:border-iris-300/40 lg:hidden"
            >
              <span className="sr-only">Menu</span>
              <span
                className="absolute h-[1.5px] w-4 rounded bg-mist-200 transition-transform duration-400 ease-[var(--ease-out-back)]"
                style={{
                  transform: menuOpen
                    ? "translateY(0) rotate(45deg)"
                    : "translateY(-3.5px) rotate(0deg)",
                }}
              />
              <span
                className="absolute h-[1.5px] w-4 rounded bg-mist-200 transition-transform duration-400 ease-[var(--ease-out-back)]"
                style={{
                  transform: menuOpen
                    ? "translateY(0) rotate(-45deg)"
                    : "translateY(3.5px) rotate(0deg)",
                }}
              />
            </button>
          </div>
        </div>

        {/* Mobile sheet — max-height transition so it slides rather than pops */}
        <div
          id="mobile-menu"
          inert={!menuOpen}
          aria-hidden={!menuOpen}
          className="overflow-hidden transition-[max-height,opacity] duration-500 ease-[var(--ease-out-soft)] lg:hidden"
          style={{
            maxHeight: menuOpen ? "24rem" : "0rem",
            opacity: menuOpen ? 1 : 0,
          }}
        >
          <ul className="mt-3 grid gap-1 border-t border-white/8 px-2 pt-3 pb-2">
            {LINKS.map((link, index) => (
              <li key={link.label}>
                <a
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-2xl px-4 py-3 font-display text-[0.9375rem] text-mist-300 transition-colors duration-300 hover:bg-white/5 hover:text-mist-50"
                  style={{
                    animation: `float-in 0.5s var(--ease-out-soft) ${
                      index * 55
                    }ms both`,
                  }}
                >
                  {link.label}
                </a>
              </li>
            ))}
            <li className="px-2 pt-2 pb-1 sm:hidden">
              <a
                href="#login"
                onClick={() => setMenuOpen(false)}
                className="btn btn-primary w-full"
              >
                Log in
              </a>
            </li>
          </ul>
        </div>
      </nav>
    </header>
  );
}
