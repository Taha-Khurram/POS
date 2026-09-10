const LEFT = [
  { label: "Solutions", href: "#solutions" },
  { label: "Products", href: "#products" },
  { label: "Pricing", href: "#pricing" },
];

const RIGHT = [
  { label: "Careers", href: "#careers" },
  { label: "Resources", href: "#resources" },
  { label: "Privacy & Policy", href: "#privacy" },
];

export function Footer() {
  return (
    <footer
      id="resources"
      className="relative border-t border-white/6 bg-ink-950/60 py-8"
    >
      <div className="shell flex flex-col items-center justify-between gap-6 sm:flex-row">
        <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2">
          {LEFT.map((link) => (
            <li key={link.label}>
              <a href={link.href} className="nav-link text-[0.875rem]">
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2">
          {RIGHT.map((link) => (
            <li key={link.label}>
              <a href={link.href} className="nav-link text-[0.875rem]">
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </div>

      <p className="shell mt-6 text-center text-[0.75rem] text-mist-500">
        © {new Date().getFullYear()} Flo. Point of sale for the rush.
      </p>
    </footer>
  );
}
