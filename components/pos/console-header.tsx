"use client";

import Link from "next/link";
import { useState } from "react";

import { FloMark } from "@/components/site/flo-mark";
import type { Notice } from "@/lib/pos/notices";
import {
  IconBell,
  IconCheck,
  IconMenu,
  IconRail,
  IconSearch,
} from "./icons";
import {
  NOTICES_COOKIE,
  rememberPref,
  type ConsoleTheme,
} from "./console-prefs";
import { ThemeToggle } from "./theme-toggle";
import { useDismiss } from "./use-dismiss";

/**
 * The fixed top bar: the wordmark, find something, and see what needs
 * attention. It spans the full width of the shell, so the rail hangs beneath
 * it.
 *
 * **There is no "New sale" button up here any more.** It was the one
 * primary-weight control on the screen and it went to `/app/register` — which
 * is Register, the second row of the rail, already drawn and already one tap
 * away. Two routes to one screen, one of them shouting, is the same mistake
 * `/admin/clients` made with its activate button: a primary belongs with the
 * thing it does, and the rail is where a cashier looks for a screen. What is
 * left in the corner is the two things that are *not* screens — the theme and
 * the bell.
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
  signature,
  unseen,
  tight,
  theme,
  onToggleRail,
  onOpenDrawer,
}: {
  /** Already filtered to what this person may be told — see `visibleNotices`. */
  notices: Notice[];
  /** What this exact set of notices hashes to, written to the cookie on open. */
  signature: string;
  /** Whether the shop's worries have changed since this device last looked. */
  unseen: boolean;
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

  // Starts at what the server worked out from the cookie, then follows the
  // person: opening the bell is what "seen" means, so the badge goes out on the
  // press rather than on the next navigation.
  const [seen, setSeen] = useState(!unseen);

  const waiting = notices.length;
  const lit = waiting > 0 && !seen;

  const openBell = (next: boolean) => {
    setBellOpen(next);

    if (next && !seen) {
      setSeen(true);
      rememberPref(NOTICES_COOKIE, signature);
    }
  };

  return (
    <header className="pos-topbar">
      {/* The plate is the console's deep violet in both themes, so this is one
          of the few places that still wants the white cut of the wordmark. */}
      <Link href="/app" className="pos-logo-plate hidden sm:grid" aria-label="Flo">
        <FloMark className="h-4 w-auto" priority tone="white" />
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
            onClick={() => openBell(!bellOpen)}
            className="pos-icon-btn relative"
            aria-expanded={bellOpen}
            aria-label={
              lit
                ? `Notifications, ${waiting} waiting`
                : waiting > 0
                  ? `Notifications, ${waiting}`
                  : "Notifications, nothing waiting"
            }
          >
            <IconBell />
            {lit ? (
              <span className="pos-count absolute top-1.5 right-1.5 h-4 min-w-4 rounded-full px-1">
                {waiting}
              </span>
            ) : null}
          </button>

          {bellOpen ? (
            <div className="pos-menu w-80" role="dialog" aria-label="Notifications">
              <p className="px-2.5 py-2 font-display text-[0.8125rem] font-semibold text-graphite-900">
                Needs a look
              </p>

              {/* Nothing wrong is a state worth drawing. An empty popover reads
                  as a screen that failed to load. */}
              {waiting === 0 ? (
                <p className="flex items-center gap-2 px-2.5 pt-1 pb-3 text-[0.8125rem] text-graphite-500">
                  <IconCheck className="h-4 w-4 flex-none text-signal-good" />
                  Nothing needs a look. Shukriya.
                </p>
              ) : (
                <ul className="max-h-80 overflow-y-auto">
                  {notices.map((notice) => (
                    <li key={notice.id}>
                      <NoticeRow notice={notice} onFollow={() => setBellOpen(false)} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

/**
 * One line of the bell.
 *
 * A notice that has somewhere to go is a link, because the first thing anybody
 * does with "4 items are out of stock" is try to press it. One without — there
 * are none today, but there will be — stays plain text rather than becoming a
 * button that does nothing.
 */
function NoticeRow({
  notice,
  onFollow,
}: {
  notice: Notice;
  onFollow: () => void;
}) {
  const body = (
    <>
      <p className="flex items-center gap-2 text-[0.8125rem] font-medium text-graphite-900">
        <span
          className={`h-1.5 w-1.5 flex-none rounded-full ${
            notice.tone === "bad"
              ? "bg-signal-bad"
              : notice.tone === "warn"
                ? "bg-signal-warn"
                : "bg-orchid-600"
          }`}
        />
        {notice.title}
      </p>
      <p className="mt-0.5 pl-3.5 text-[0.75rem] leading-snug text-graphite-500">
        {notice.detail} · {notice.at}
      </p>
    </>
  );

  if (!notice.href) {
    return <div className="rounded-[9px] px-2.5 py-2">{body}</div>;
  }

  return (
    <Link
      href={notice.href}
      onClick={onFollow}
      className="block rounded-[9px] px-2.5 py-2 hover:bg-orchid-50"
    >
      {body}
    </Link>
  );
}
