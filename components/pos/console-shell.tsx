"use client";

import { useEffect, useState } from "react";

import { ConsoleHeader, type Branch, type Notice } from "./console-header";
import { RAIL_COOKIE, rememberPref, type ConsoleTheme } from "./console-prefs";
import { ConsoleSidebar } from "./console-sidebar";

/**
 * The console's chrome, and the only client component in the layout.
 *
 * It holds two booleans and nothing else. `children` arrives as an already
 * rendered server tree, so wrapping the app in a client component costs no
 * interactivity budget: the pages inside stay server components and ship no JS
 * of their own.
 *
 * The shell is one grid: a full-width topbar, then the rail and the work
 * surface side by side beneath it.
 *
 * The collapse preference travels in a cookie rather than `localStorage`, and
 * the layout reads it on the server. Storage would have meant rendering an
 * expanded rail, then snapping it shut a frame after hydration — a visible
 * jump on every navigation, on the cheapest device we support. The cookie is
 * read before the first byte, so the rail is simply the right width.
 *
 * The two states are deliberately separate rather than one "is the nav
 * showing" flag. Collapsing is a preference on a wide screen; the drawer is a
 * mode on a narrow one. Merging them gives you a tablet that remembers the
 * drawer was open and boots with the nav covering the till.
 */
export function ConsoleShell({
  shopName,
  subtitle,
  email,
  branches,
  notices,
  initialTight,
  theme,
  children,
}: {
  shopName: string;
  subtitle: string;
  email: string | null;
  branches: Branch[];
  notices: Notice[];
  initialTight: boolean;
  /** Read from the cookie by the layout, so the first paint is already right. */
  theme: ConsoleTheme;
  children: React.ReactNode;
}) {
  const [tight, setTight] = useState(initialTight);
  const [drawer, setDrawer] = useState(false);

  // A drawer over the page must not leave the page scrolling behind it.
  useEffect(() => {
    if (!drawer) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawer]);

  const toggleRail = () => {
    const next = !tight;
    setTight(next);
    rememberPref(RAIL_COOKIE, next ? "1" : "0");
  };

  return (
    <div
      className="pos-shell"
      style={
        {
          "--rail": tight ? "var(--pos-rail-tight)" : "var(--pos-rail)",
        } as React.CSSProperties
      }
    >
      {/* The bar comes first in the DOM as well as on the screen: it spans
          both columns, so the rail begins under it and the wordmark lives in
          the bar rather than at the top of the navigation. */}
      <ConsoleHeader
        shopName={shopName}
        subtitle={subtitle}
        email={email}
        branches={branches}
        notices={notices}
        tight={tight}
        theme={theme}
        onToggleRail={toggleRail}
        onOpenDrawer={() => setDrawer(true)}
      />

      <ConsoleSidebar
        open={drawer}
        tight={tight}
        shopName={shopName}
        email={email}
        onNavigate={() => setDrawer(false)}
        onClose={() => setDrawer(false)}
      />

      {/* Fixed, so it is out of flow and never takes a grid cell of its own. */}
      {drawer ? (
        <div
          className="pos-scrim lg:hidden"
          onClick={() => setDrawer(false)}
          aria-hidden
        />
      ) : null}

      <main className="pos-canvas px-3 py-4 sm:px-5 sm:py-6">{children}</main>
    </div>
  );
}
