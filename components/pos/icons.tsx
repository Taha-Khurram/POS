/**
 * The console's icon set, hand-drawn on a 24-unit grid.
 *
 * An icon library is 40-plus KB of JavaScript to draw twenty shapes that never
 * change, and the register runs on Rs 25,000 tablets over patchy 3G — the same
 * reasoning that keeps the charts hand-rolled. These are pure SVG, so they
 * render on the server with the rest of the page.
 *
 * All of them inherit `currentColor` and size off the wrapper, so an icon is
 * coloured by the thing it sits inside and never carries its own palette.
 */

export type IconProps = {
  className?: string;
};

function Glyph({
  className = "h-[18px] w-[18px]",
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export const IconDashboard = (props: IconProps) => (
  <Glyph {...props}>
    <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
    <rect x="13.5" y="3" width="7.5" height="5" rx="1.6" />
    <rect x="13.5" y="11" width="7.5" height="10" rx="1.6" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
  </Glyph>
);

export const IconRegister = (props: IconProps) => (
  <Glyph {...props}>
    <rect x="3" y="9" width="18" height="12" rx="2" />
    <path d="M7 9V5.5A1.5 1.5 0 0 1 8.5 4h7A1.5 1.5 0 0 1 17 5.5V9" />
    <path d="M7 14h4M7 17.5h2" />
    <path d="M15 13.5h2.5v4H15z" />
  </Glyph>
);

export const IconInventory = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M21 8v8a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.73l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8Z" />
    <path d="m3.4 7 8.6 5 8.6-5" />
    <path d="M12 22V12" />
  </Glyph>
);

export const IconSales = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M5 2.5v19l2.3-1.4 2.3 1.4 2.4-1.4 2.4 1.4 2.3-1.4 2.3 1.4v-19l-2.3 1.4-2.3-1.4-2.4 1.4-2.4-1.4L7.3 3.9Z" />
    <path d="M9 9h6M9 13h6" />
  </Glyph>
);

export const IconCustomers = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="9" cy="8" r="3.4" />
    <path d="M2.8 20a6.2 6.2 0 0 1 12.4 0" />
    <path d="M16.5 5.2a3.4 3.4 0 0 1 0 6.6" />
    <path d="M18 14.3a6.2 6.2 0 0 1 3.2 5.7" />
  </Glyph>
);

export const IconEmployees = (props: IconProps) => (
  <Glyph {...props}>
    <rect x="3" y="5" width="18" height="15" rx="2.5" />
    <path d="M9 3v3" />
    <circle cx="9.5" cy="11.5" r="2.2" />
    <path d="M6 17.2a3.6 3.6 0 0 1 7 0" />
    <path d="M15.5 10.5h3.2M15.5 14h3.2" />
  </Glyph>
);

export const IconReports = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M3 3v16.5A1.5 1.5 0 0 0 4.5 21H21" />
    <path d="M7.5 16V11M12 16V6.5M16.5 16v-7" />
  </Glyph>
);

export const IconSettings = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M4 7h16M4 17h16" />
    <circle cx="9.5" cy="7" r="2.3" />
    <circle cx="15" cy="17" r="2.3" />
  </Glyph>
);

export const IconSearch = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m20 20-4.8-4.8" />
  </Glyph>
);

export const IconBell = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 8 2.5 8h-17S6 15 6 9Z" />
    <path d="M10.2 20.5a2 2 0 0 0 3.6 0" />
  </Glyph>
);

export const IconStore = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M3.5 9.5V20a1 1 0 0 0 1 1h15a1 1 0 0 0 1-1V9.5" />
    <path d="M2 9.5h20l-2-6H4Z" />
    <path d="M9.5 21v-5.5h5V21" />
  </Glyph>
);

export const IconChevron = (props: IconProps) => (
  <Glyph {...props}>
    <path d="m6 9.5 6 6 6-6" />
  </Glyph>
);

export const IconMenu = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Glyph>
);

export const IconClose = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Glyph>
);

export const IconPlus = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M12 5v14M5 12h14" />
  </Glyph>
);

export const IconRail = (props: IconProps) => (
  <Glyph {...props}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M9.5 4v16" />
  </Glyph>
);

export const IconSignOut = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M9.5 21H5.5A2 2 0 0 1 3.5 19V5a2 2 0 0 1 2-2h4" />
    <path d="m16 16.5 4.5-4.5L16 7.5" />
    <path d="M20.5 12h-11" />
  </Glyph>
);

export const IconUser = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M4.8 20.5a7.2 7.2 0 0 1 14.4 0" />
  </Glyph>
);

export const IconCalendar = (props: IconProps) => (
  <Glyph {...props}>
    <rect x="3" y="5" width="18" height="16" rx="2.5" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Glyph>
);

export const IconClock = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 1.8" />
  </Glyph>
);

export const IconCheck = (props: IconProps) => (
  <Glyph {...props}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </Glyph>
);

/**
 * The delta marker on a KPI. A triangle rather than a coloured word, because it
 * has to survive being a 10px glyph next to a number — but it never travels
 * without the percentage beside it, so direction is never colour alone.
 */
export const IconTrend = ({
  className = "h-3 w-3",
  direction,
}: IconProps & { direction: "up" | "down" | "flat" }) => (
  <svg viewBox="0 0 12 12" fill="currentColor" className={className} aria-hidden>
    {direction === "flat" ? (
      <rect x="1.5" y="5" width="9" height="2" rx="1" />
    ) : (
      <path d={direction === "up" ? "M6 2l4.5 7h-9z" : "M6 10 1.5 3h9z"} />
    )}
  </svg>
);
