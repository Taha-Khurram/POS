"use client";

import Link from "next/link";

import { FloMark } from "@/components/site/flo-mark";
import {
  IconBell,
  IconMenu,
  IconPlus,
  IconRail,
  IconSearch,
} from "./icons";
import type { ConsoleTheme } from "./console-prefs";
import { ThemeToggle } from "./theme-toggle";
import { useDismiss } from "./use-dismiss";

export type Notice = {
  id: string;
  title: string;
  detail: string;
  at: string;
  tone: "info" | "warn";
};

/**
 * The fixed top bar: the wordmark, find something, see what needs attention,
 * and start a sale. It spans the full width of the shell, so the rail hangs
 * beneath it.
 *
 * The "New sale" button is the only primary-weight control on the whole screen.
 * That is deliberate — on a counter, the dashboard is what you look at between
 * customers, and the moment one arrives there should be exactly one obvious
 * thing to press, reachable without reading anything.
 *
 * Who is signed in, and which shop, is not up here. The foot of the rail says
 * both and has the sign-out beside them; a second copy in the corner was one
 * more place for the two to disagree.
 *
 * Nor is there a branch tag. It read "Main counter" off a constant for every
 * shop in the country; the picker comes back when a shop can actually have a
 * second counter to pick.
 */
export function ConsoleHeader({
  notices,
  tight,
  theme,
  onToggleRail,
  onOpenDrawer,
}: {
  notices: Notice[];
  tight: boolean;
  theme: ConsoleTheme;
  onToggleRail: () => void;
  onOpenDrawer: () => void;
}) {
  // Destructured at the call site: the lint rule that guards against reading
  // a ref during render cannot see through a `.ref` property on a returned
  // object, and reads every access on it as a ref access.
  const {
    ref: bellRef,
    open: bellOpen,
    setOpen: setBellOpen,
  } = useDismiss<HTMLDivElement>();

  const unread = notices.length;

  return (
    <header className="pos-topbar">
      {/* The artwork is white with a transparent ground, so on a white bar it
          sits on a plate rather than being recoloured. */}
      <Link href="/app" className="pos-logo-plate hidden sm:grid" aria-label="Flo">
        <FloMark className="h-4 w-auto" priority />
      </Link>

      {/* Below lg the rail is a drawer, so the same corner does two jobs. */}
      <button
        type="button"
        onClick={onOpenDrawer}
        className="pos-icon-btn lg:hidden"
        aria-label="Open navigation"
        aria-controls="pos-rail"
      >
        <IconMenu />
      </button>

      <button
        type="button"
        onClick={onToggleRail}
        className="pos-icon-btn hidden lg:grid"
        aria-label={tight ? "Expand navigation" : "Collapse navigation"}
        aria-expanded={!tight}
        aria-controls="pos-rail"
      >
        <IconRail />
      </button>

      {/* Search. Takes the width the bar has left after the wordmark. */}
      <form
        role="search"
        className="relative min-w-0 flex-1 md:max-w-sm"
        onSubmit={(event) => event.preventDefault()}
      >
        <IconSearch className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-graphite-500" />
        <input
          type="search"
          name="q"
          className="pos-field pl-9"
          placeholder="Search items, receipts, customers…"
          aria-label="Search the shop"
        />
      </form>

      <div className="ml-auto flex items-center gap-1.5">
        <ThemeToggle initial={theme} />

        <div className="relative" ref={bellRef}>
          <button
            type="button"
            onClick={() => setBellOpen(!bellOpen)}
            className="pos-icon-btn relative"
            aria-expanded={bellOpen}
            aria-label={
              unread > 0 ? `Notifications, ${unread} waiting` : "Notifications"
            }
          >
            <IconBell />
            {unread > 0 ? (
              <span className="pos-count absolute top-1.5 right-1.5 h-4 min-w-4 rounded-full px-1">
                {unread}
              </span>
            ) : null}
          </button>

          {bellOpen ? (
            <div className="pos-menu w-80" role="dialog" aria-label="Notifications">
              <p className="px-2.5 py-2 font-display text-[0.8125rem] font-semibold text-graphite-900">
                Needs a look
              </p>

              <ul className="max-h-80 overflow-y-auto">
                {notices.map((notice) => (
                  <li
                    key={notice.id}
                    className="rounded-[9px] px-2.5 py-2 hover:bg-orchid-50"
                  >
                    <p className="flex items-center gap-2 text-[0.8125rem] font-medium text-graphite-900">
                      <span
                        className={`h-1.5 w-1.5 flex-none rounded-full ${
                          notice.tone === "warn"
                            ? "bg-signal-warn"
                            : "bg-orchid-600"
                        }`}
                      />
                      {notice.title}
                    </p>
                    <p className="mt-0.5 pl-3.5 text-[0.75rem] leading-snug text-graphite-500">
                      {notice.detail} · {notice.at}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <Link href="/app/register" className="pos-btn pos-btn-primary">
          <IconPlus className="h-4 w-4" />
          <span className="hidden sm:inline">New sale</span>
        </Link>
      </div>
    </header>
  );
}
