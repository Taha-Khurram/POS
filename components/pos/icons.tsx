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

/* A funnel, not three sliders: the sliders glyph reads as "settings" to
   anybody who has used a phone, and this button narrows a list. */
export const IconFilter = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M3.5 5h17l-6.6 7.6v5.7l-3.8 2.2v-7.9Z" />
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

/** A row's actions menu — three dots, the one glyph everybody already reads
 *  as "more things you can do here". */
export const IconMore = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="5" cy="12" r="1.3" fill="currentColor" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" />
    <circle cx="19" cy="12" r="1.3" fill="currentColor" />
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

export const IconMinus = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M5 12h14" />
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

/** A key on its side, so the bit reads at 16 px rather than closing into a blob. */
export const IconKey = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="7.5" cy="12" r="3.8" />
    <path d="M11.3 12H21" />
    <path d="M18 12v3.2M15 12v2.2" />
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

export const IconSun = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.6v2.2M12 19.2v2.2M4.1 4.1l1.6 1.6M18.3 18.3l1.6 1.6M2.6 12h2.2M19.2 12h2.2M4.1 19.9l1.6-1.6M18.3 5.7l1.6-1.6" />
  </Glyph>
);

export const IconMoon = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M20.5 14.2A8.6 8.6 0 0 1 9.8 3.5a8.7 8.7 0 1 0 10.7 10.7Z" />
  </Glyph>
);

export const IconBarcode = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M3 6.5V5a2 2 0 0 1 2-2h1.5M17.5 3H19a2 2 0 0 1 2 2v1.5M21 17.5V19a2 2 0 0 1-2 2h-1.5M6.5 21H5a2 2 0 0 1-2-2v-1.5" />
    <path d="M7 8v8M10 8v8M13.5 8v8M17 8v8" />
  </Glyph>
);

export const IconCamera = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M3 8.5A2 2 0 0 1 5 6.5h1.8l1.3-2h7.8l1.3 2H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    <circle cx="12" cy="13" r="3.4" />
  </Glyph>
);

export const IconUpload = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M3.5 15.5V19a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-3.5" />
    <path d="M12 3.5v12M7.5 8 12 3.5 16.5 8" />
  </Glyph>
);

/** The same arrow as `IconUpload`, turned round. Export, never import — the
 *  two live side by side on the history's toolbar and a mirrored glyph is the
 *  only thing that tells them apart at 16px. */
export const IconDownload = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M3.5 15.5V19a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-3.5" />
    <path d="M12 3.5v12M7.5 11 12 15.5 16.5 11" />
  </Glyph>
);

export const IconCopy = (props: IconProps) => (
  <Glyph {...props}>
    <rect x="8.5" y="8.5" width="12" height="12" rx="2.2" />
    <path d="M15.5 5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2" />
  </Glyph>
);

export const IconTag = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M11.6 3H5a2 2 0 0 0-2 2v6.6a2 2 0 0 0 .6 1.4l7.4 7.4a2 2 0 0 0 2.8 0l6.6-6.6a2 2 0 0 0 0-2.8L13 3.6a2 2 0 0 0-1.4-.6Z" />
    <circle cx="7.9" cy="7.9" r="1.4" />
  </Glyph>
);

export const IconTrash = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M4 6.5h16M9.5 6.5V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" />
    <path d="M6.5 6.5 7.3 19a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12.5" />
    <path d="M10.5 10.5v6M13.5 10.5v6" />
  </Glyph>
);

export const IconAlert = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M10.3 3.9 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4.5M12 17.2v.1" />
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

/* ---------------- The counter ---------------- */

export const IconCash = (props: IconProps) => (
  <Glyph {...props}>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.6" />
    <path d="M6 9.5v5M18 9.5v5" />
  </Glyph>
);

export const IconCard = (props: IconProps) => (
  <Glyph {...props}>
    <rect x="2.5" y="5" width="19" height="14" rx="2.4" />
    <path d="M2.5 9.5h19" />
    <path d="M6 14.5h3.5" />
  </Glyph>
);

export const IconPrinter = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M7 9V4h10v5" />
    <path d="M7 18H5.5A2.5 2.5 0 0 1 3 15.5v-4A2.5 2.5 0 0 1 5.5 9h13a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-2.5 2.5H17" />
    <rect x="7" y="14" width="10" height="6.5" rx="1.2" />
  </Glyph>
);

export const IconCart = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M3 4h2.2l2.2 10.4a1.8 1.8 0 0 0 1.8 1.4h7.9a1.8 1.8 0 0 0 1.75-1.35L20.5 7.5H6" />
    <circle cx="9.5" cy="19.5" r="1.4" />
    <circle cx="17" cy="19.5" r="1.4" />
  </Glyph>
);

/** The "how is this worked out?" marker on Reports. A lower-case `i` in a ring
 *  rather than a question mark: a question mark reads as "I need help", and
 *  this is a footnote on a number somebody already understands. */
export const IconInfo = (props: IconProps) => (
  <Glyph {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5" />
    <path d="M12 7.6v.1" />
  </Glyph>
);

export const IconBox = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M21 8.2v7.6a1.8 1.8 0 0 1-.95 1.59l-7.2 3.9a1.8 1.8 0 0 1-1.7 0l-7.2-3.9A1.8 1.8 0 0 1 3 15.8V8.2a1.8 1.8 0 0 1 .95-1.59l7.2-3.9a1.8 1.8 0 0 1 1.7 0l7.2 3.9A1.8 1.8 0 0 1 21 8.2Z" />
    <path d="M3.3 7.3 12 12l8.7-4.7M12 12v9.3" />
  </Glyph>
);

/** Edit. Used where a row's name already goes somewhere else, so the chevron
 *  would promise navigation the button does not do. */
export const IconPencil = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M4 16.4V20h3.6L18.1 9.5a1.7 1.7 0 0 0 0-2.4l-1.2-1.2a1.7 1.7 0 0 0-2.4 0Z" />
    <path d="m13.6 6.9 3.5 3.5" />
  </Glyph>
);

/** Buying — a delivery van. Not a second box: the rail already has one for
 *  Products & stock, and two boxes side by side is a rail nobody reads. */
export const IconTruck = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h8a1.5 1.5 0 0 1 1.5 1.5V16H3Z" />
    <path d="M14 10h3.1a1.5 1.5 0 0 1 1.27.7L20.8 14.5a1.5 1.5 0 0 1 .2.75V16h-7Z" />
    <circle cx="7" cy="18" r="1.9" />
    <circle cx="17" cy="18" r="1.9" />
  </Glyph>
);

export const IconLayers = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M12 2.8 2.8 7.5 12 12.2l9.2-4.7L12 2.8Z" />
    <path d="M2.8 12.4 12 17.1l9.2-4.7M2.8 16.9 12 21.6l9.2-4.7" />
  </Glyph>
);

/** A clock with the hand running backwards — the ledger behind a figure. */
export const IconHistory = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
    <path d="M3.2 3.6v4.2h4.2" />
    <path d="M12 7.6V12l3 1.8" />
  </Glyph>
);

/** An arrow turning back on itself: money or goods coming the other way. */
export const IconReturn = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M9 5.5 3.8 10.7 9 15.9" />
    <path d="M3.8 10.7h10.4a6 6 0 0 1 0 12H9" />
  </Glyph>
);

/** Per cent — the discount. */
export const IconPercent = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M19 5 5 19" />
    <circle cx="7.6" cy="7.6" r="2.6" />
    <circle cx="16.4" cy="16.4" r="2.6" />
  </Glyph>
);

/** Two bars: a bill set down on the counter, to be picked up again. */
export const IconPause = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M9.5 5v14M14.5 5v14" />
  </Glyph>
);

/** The cash drawer, open. What a shift begins and ends with. */
export const IconDrawer = (props: IconProps) => (
  <Glyph {...props}>
    <path d="M3 10.5 5.6 4.4A2 2 0 0 1 7.4 3.2h9.2a2 2 0 0 1 1.8 1.2L21 10.5" />
    <rect x="3" y="10.5" width="18" height="9.8" rx="2" />
    <path d="M9.6 14.8h4.8" />
  </Glyph>
);
