"use client";

import { useEffect, useState } from "react";

import { ConsoleHeader, type Branch, type Notice } from "./console-header";
import { ConsoleSidebar } from "./console-sidebar";

export const RAIL_COOKIE = "flo_rail";

/**
 * The console's chrome, and the only client component in the layout.
 *
 * It holds two booleans and nothing else. `children` arrives as an already
 * rendered server tree, so wrapping the app in a client component costs no
 * interactivity budget: the pages inside stay server components and ship no JS
 * of their own.
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
  children,
}: {
  shopName: string;
  subtitle: string;
  email: string | null;
  branches: Branch[];
  notices: Notice[];
  initialTight: boolean;
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
    // A year, path-wide, lax: it is a layout preference, not a session.
    document.cookie = `${RAIL_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
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
      <ConsoleSidebar
        open={drawer}
        tight={tight}
        shopName={shopName}
        onNavigate={() => setDrawer(false)}
        onClose={() => setDrawer(false)}
      />

      {drawer ? (
        <div
          className="pos-scrim lg:hidden"
          onClick={() => setDrawer(false)}
          aria-hidden
        />
      ) : null}

      <div className="pos-canvas flex min-h-dvh flex-col">
        <ConsoleHeader
          shopName={shopName}
          subtitle={subtitle}
          email={email}
          branches={branches}
          notices={notices}
          tight={tight}
          onToggleRail={toggleRail}
          onOpenDrawer={() => setDrawer(true)}
        />

        <main className="flex-1 px-3 py-4 sm:px-5 sm:py-6">{children}</main>
      </div>
    </div>
  );
}
