"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  RAIL_COOKIE,
  rememberPref,
  type ConsoleTheme,
} from "@/components/pos/console-prefs";
import { IconMenu, IconRail } from "@/components/pos/icons";
import { ThemeToggle } from "@/components/pos/theme-toggle";
import { ToastProvider } from "@/components/pos/toaster";
import { FloMark } from "@/components/site/flo-mark";
import type { PlatformRole } from "@/lib/platform/admin";

import { AdminSidebar, type RailCounts } from "./admin-sidebar";

/**
 * The owner console's chrome.
 *
 * Deliberately the same shell as `/app` — `.pos-shell`, `.pos-rail`,
 * `.pos-topbar`, the same light palette and the same dark cookie — rather than
 * a second design for the same person. Two consoles that look like two products
 * is how an operator ends up unsure which one they are looking at while a
 * shopkeeper waits on the phone, and every widget on both is already built out
 * of the `.pos-*` vocabulary in `globals.css`.
 *
 * What it is not is `ConsoleShell`. That one takes a `ModuleAccess`, a shop
 * name and the bell's notices, all of which are a tenant's; sharing it would
 * have meant every prop on it becoming optional and the rail growing a branch
 * per console. The chrome is small and the duplication is honest.
 *
 * No bell, and no search box. There is nothing standing in a queue here that a
 * notification would beat the rail's own counts to, and cross-shop search is a
 * screen that has to be designed rather than a box dropped in the topbar.
 */
export function AdminShell({
  email,
  role,
  counts,
  initialTight,
  theme,
  children,
}: {
  email: string | null;
  role: PlatformRole;
  /** The two queues, counted by the layout in the same call as the overview. */
  counts: RailCounts;
  initialTight: boolean;
  theme: ConsoleTheme;
  children: React.ReactNode;
}) {
  const [tight, setTight] = useState(initialTight);
  const [drawer, setDrawer] = useState(false);

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
    <ToastProvider>
      <div
        className="pos-shell"
        style={
          {
            "--rail": tight ? "var(--pos-rail-tight)" : "var(--pos-rail)",
          } as React.CSSProperties
        }
      >
        <header className="pos-topbar">
          <Link
            href="/admin"
            className="pos-logo-plate hidden sm:grid"
            aria-label="Flo platform"
          >
            <FloMark className="h-4 w-auto" priority tone="white" />
          </Link>

          <button
            type="button"
            onClick={() => setDrawer(true)}
            className="pos-icon-btn lg:hidden"
            aria-label="Open navigation"
            aria-controls="admin-rail"
          >
            <IconMenu />
          </button>

          <button
            type="button"
            onClick={toggleRail}
            className="pos-icon-btn hidden lg:grid"
            aria-label={tight ? "Expand navigation" : "Collapse navigation"}
            aria-expanded={!tight}
            aria-controls="admin-rail"
          >
            <IconRail />
          </button>

          {/* The one label that says which console this is. Without it the two
              are identical at a glance, which is exactly the mistake worth
              making impossible. */}
          <p className="min-w-0 truncate font-display text-[0.8125rem] font-semibold text-graphite-700">
            Platform
            <span className="hidden text-graphite-500 sm:inline"> · Flo owner console</span>
          </p>

          {/* Activating a shop used to sit here as well as on the Clients
              page, so /admin/clients drew the same primary button twice, one
              above the other. It belongs with the roster it adds a row to. */}
          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle initial={theme} />
          </div>
        </header>

        <AdminSidebar
          open={drawer}
          tight={tight}
          email={email}
          role={role}
          counts={counts}
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

        <main className="pos-canvas px-3 py-4 sm:px-5 sm:py-6">{children}</main>
      </div>
    </ToastProvider>
  );
}
