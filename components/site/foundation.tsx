import { Reveal } from "@/components/motion/reveal";

type Glyph = "insights" | "catalog" | "integrations" | "workflows" | "ai";

type Pillar = {
  glyph: Glyph;
  title: string;
  copy: string;
  /** Resting rotation, straightened on hover. */
  tilt: number;
  accent?: boolean;
};

const ROW_ONE: Pillar[] = [
  {
    glyph: "insights",
    title: "Insights",
    copy: "See which hours and which items pay the rent.",
    tilt: -7,
  },
  {
    glyph: "catalog",
    title: "Catalog",
    copy: "Rates, deals, sizes, and units in one place.",
    tilt: 7,
  },
];

const ROW_TWO: Pillar[] = [
  {
    glyph: "integrations",
    title: "Integrations",
    copy: "FBR, Raast, Easypaisa, JazzCash, Foodpanda.",
    tilt: -6,
    accent: true,
  },
  {
    glyph: "workflows",
    title: "Workflows",
    copy: "Automate deals, returns, and day-end closing.",
    tilt: 0,
  },
  {
    glyph: "ai",
    title: "AI",
    copy: "Knows your season, from Ramadan to Eid.",
    tilt: 6,
  },
];

export function Foundation() {
  return (
    <section className="section">
      <div
        aria-hidden
        className="glow left-1/2 top-1/3 h-80 w-[40rem] -translate-x-1/2 bg-iris-700/12"
      />

      <div className="shell relative">
        <Reveal as="h2" className="heading text-center">
          Built for how Pakistan sells
        </Reveal>

        <div className="mt-14 flex flex-col items-center lg:mt-20">
          {/* Back row carries extra bottom padding, so the front row overlaps
              empty space rather than clipping its copy. */}
          <div className="flex flex-wrap justify-center gap-4 sm:gap-0">
            {ROW_ONE.map((pillar, index) => (
              <Card
                key={pillar.title}
                pillar={pillar}
                delay={index * 120}
                padClass="sm:pb-16"
                className={index > 0 ? "sm:-ml-5" : ""}
              />
            ))}
          </div>

          <div className="mt-4 flex flex-wrap justify-center gap-4 sm:-mt-10 sm:gap-0">
            {ROW_TWO.map((pillar, index) => (
              <Card
                key={pillar.title}
                pillar={pillar}
                delay={240 + index * 120}
                className={index > 0 ? "sm:-ml-5" : ""}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Card({
  pillar,
  delay,
  className = "",
  padClass = "",
}: {
  pillar: Pillar;
  delay: number;
  className?: string;
  padClass?: string;
}) {
  return (
    <Reveal
      delay={delay}
      y={40}
      scale={0.94}
      className={`relative w-[calc(50%-0.5rem)] max-w-[212px] sm:w-[212px] ${className}`}
      style={{ zIndex: pillar.accent ? 3 : 1 }}
    >
      <div
        className={`fan-card group relative flex h-full flex-col items-center overflow-hidden rounded-[22px] p-5 text-center sm:min-h-[214px] sm:p-6 ${padClass} ${
          pillar.accent
            ? "border border-iris-200/30 bg-gradient-to-br from-iris-500 to-iris-700 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.3),0_28px_60px_-28px_rgb(79_70_229/0.9)]"
            : "border border-ink-700 bg-gradient-to-b from-ink-900 to-ink-750 shadow-[0_28px_60px_-34px_rgb(33_21_102/0.22)]"
        }`}
        style={{
          // Rotation applied via CSS var so hover can straighten it.
          ["--tilt" as string]: `${pillar.tilt}deg`,
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-iris-500/35 to-transparent"
        />

        <FoundationGlyph kind={pillar.glyph} accent={pillar.accent} />

        <h3
          className={`mt-4 font-display text-[0.9375rem] font-semibold ${
            pillar.accent ? "text-white" : "text-mist-50"
          }`}
        >
          {pillar.title}
        </h3>
        <p
          className={`mt-1.5 text-[0.75rem] leading-relaxed ${
            pillar.accent ? "text-white/80" : "text-mist-400"
          }`}
        >
          {pillar.copy}
        </p>
      </div>
    </Reveal>
  );
}

/**
 * Two stacked plates — a rotated "side" behind a lit front face — reads as a
 * chunky 3D icon without shipping any raster art.
 */
function FoundationGlyph({
  kind,
  accent,
}: {
  kind: Glyph;
  accent?: boolean;
}) {
  const stroke = {
    fill: "none",
    stroke: "#fff",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  return (
    <span className="relative grid h-14 w-14 place-items-center">
      {/* Back plate gives the icon its thickness */}
      <span
        aria-hidden
        className={`absolute inset-1 rotate-[14deg] rounded-[30%] ${
          accent
            ? "bg-iris-200/35"
            : "bg-gradient-to-br from-iris-400/45 to-iris-700/40"
        } blur-[1px]`}
      />

      {/* Front face */}
      <span
        className={`relative grid h-12 w-12 -rotate-[8deg] place-items-center rounded-[30%] transition-transform duration-500 ease-[var(--ease-out-back)] group-hover:rotate-0 group-hover:scale-110 ${
          accent
            ? "bg-gradient-to-br from-iris-600 to-iris-700 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.45)]"
            : "bg-gradient-to-br from-iris-300 via-iris-500 to-iris-700 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.45),0_10px_22px_-10px_rgb(79_70_229/0.9)]"
        }`}
      >
        <span
          aria-hidden
          className="absolute inset-0 rounded-[30%] bg-[radial-gradient(circle_at_28%_20%,rgb(255_255_255/0.5),transparent_58%)]"
        />

        <svg viewBox="0 0 24 24" className="relative h-6 w-6" aria-hidden>
          {kind === "insights" && (
            <>
              <path d="M6 17V11M12 17V7M18 17v-4" {...stroke} />
              <path d="M4 20h16" {...stroke} strokeOpacity="0.6" />
            </>
          )}
          {kind === "catalog" && (
            <>
              <path
                d="M7 4h7l4 4v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"
                {...stroke}
              />
              <path d="M13.5 4v4.5H18M9 13h6M9 16.5h4" {...stroke} />
            </>
          )}
          {kind === "integrations" && (
            <>
              <path d="M12 4v10" {...stroke} />
              <path d="M8 10.5 12 14.5 16 10.5" {...stroke} />
              <path d="M5 18.5h14" {...stroke} strokeOpacity="0.7" />
            </>
          )}
          {kind === "workflows" && (
            <>
              <circle cx="7" cy="7.5" r="2.6" {...stroke} />
              <circle cx="17" cy="16.5" r="2.6" {...stroke} />
              <path d="M9.6 7.5h3.4a3 3 0 0 1 3 3v3.4" {...stroke} />
            </>
          )}
          {kind === "ai" && (
            <>
              <path
                d="M12 4.5l1.7 4.3 4.3 1.7-4.3 1.7L12 16.5l-1.7-4.3L6 10.5l4.3-1.7L12 4.5Z"
                {...stroke}
              />
              <path d="M18 17.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8.8-1.9Z" {...stroke} />
            </>
          )}
        </svg>
      </span>
    </span>
  );
}
