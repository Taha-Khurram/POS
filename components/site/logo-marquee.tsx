const BRANDS = [
  { name: "Bellwether", glyph: "circle" },
  { name: "Trace", glyph: "compass" },
  { name: "Recharge", glyph: "bolt" },
  { name: "Saltbox", glyph: "square" },
  { name: "Orbitc", glyph: "orbit" },
  { name: "Nordvik", glyph: "diamond" },
] as const;

function Glyph({ kind }: { kind: (typeof BRANDS)[number]["glyph"] }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0" aria-hidden>
      {kind === "circle" && (
        <>
          <circle cx="10" cy="10" r="7.5" {...common} />
          <circle cx="10" cy="10" r="2.6" fill="currentColor" stroke="none" />
        </>
      )}
      {kind === "compass" && (
        <>
          <circle cx="10" cy="10" r="7.5" {...common} />
          <path d="M13 7l-2.4 5.6L7 13l2.4-5.6L13 7Z" {...common} />
        </>
      )}
      {kind === "bolt" && (
        <path d="M11.5 2 5 11h4l-.5 7L15 9h-4l.5-7Z" {...common} />
      )}
      {kind === "square" && (
        <>
          <rect x="2.5" y="2.5" width="15" height="15" rx="4" {...common} />
          <path d="M7 10h6M10 7v6" {...common} />
        </>
      )}
      {kind === "orbit" && (
        <>
          <circle cx="10" cy="10" r="3.2" fill="currentColor" stroke="none" />
          <ellipse
            cx="10"
            cy="10"
            rx="8"
            ry="3.6"
            transform="rotate(-28 10 10)"
            {...common}
          />
        </>
      )}
      {kind === "diamond" && (
        <path d="M10 2.5 17.5 10 10 17.5 2.5 10 10 2.5Z" {...common} />
      )}
    </svg>
  );
}

export function LogoMarquee() {
  // The track holds the list twice so a -50% translate loops seamlessly.
  const track = [...BRANDS, ...BRANDS];

  return (
    <section aria-label="Merchants running on Flo" className="relative py-10 sm:py-14">
      <div className="marquee-mask shell overflow-hidden">
        <div className="marquee-track items-center gap-14 sm:gap-20">
          {track.map((brand, index) => (
            <div
              key={`${brand.name}-${index}`}
              className="flex shrink-0 items-center gap-2.5 text-mist-400 opacity-70 transition-[opacity,color,transform] duration-500 ease-[var(--ease-out-soft)] hover:-translate-y-0.5 hover:text-mist-50 hover:opacity-100"
            >
              <Glyph kind={brand.glyph} />
              <span className="font-display text-lg font-bold tracking-tight whitespace-nowrap sm:text-xl">
                {brand.name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
