"use client";

import Link from "next/link";

import { signOut } from "@/app/(app)/app/actions";
import {
  IconBell,
  IconChevron,
  IconMenu,
  IconPlus,
  IconRail,
  IconSearch,
  IconSignOut,
  IconStore,
  IconUser,
} from "./icons";
import { useDismiss } from "./use-dismiss";

export type Branch = { id: string; label: string };

export type Notice = {
  id: string;
  title: string;
  detail: string;
  at: string;
  tone: "info" | "warn";
};

/**
 * The fixed top bar: find something, pick a branch, see what needs attention,
 * and start a sale.
 *
 * The "New sale" button is the only primary-weight control on the whole screen.
 * That is deliberate — on a counter, the dashboard is what you look at between
 * customers, and the moment one arrives there should be exactly one obvious
 * thing to press, reachable without reading anything.
 */
export function ConsoleHeader({
  shopName,
  subtitle,
  email,
  branches,
  notices,
  tight,
  onToggleRail,
  onOpenDrawer,
}: {
  shopName: string;
  subtitle: string;
  email: string | null;
  branches: Branch[];
  notices: Notice[];
  tight: boolean;
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

  const {
    ref: profileRef,
    open: profileOpen,
    setOpen: setProfileOpen,
  } = useDismiss<HTMLDivElement>();

  const unread = notices.length;
  const initial = (shopName.trim()[0] ?? "F").toUpperCase();

  return (
    <header className="pos-topbar">
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

      {/* Search. Grows into the space the branch picker gives up on tablets. */}
      <form
        role="search"
        className="relative min-w-0 flex-1 md:max-w-sm"
        onSubmit={(event) => event.preventDefault()}
      >
        <IconSearch className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-azure-500" />
        <input
          type="search"
          name="q"
          className="pos-field pl-9"
          placeholder="Search items, receipts, customers…"
          aria-label="Search the shop"
        />
      </form>

      <div className="ml-auto flex items-center gap-1.5">
        {/* Branch selector. A single-branch shop gets a label, not a control
            it can never change — a dead dropdown is worse than no dropdown. */}
        {branches.length > 1 ? (
          <label className="hidden sm:block">
            <span className="sr-only">Branch</span>
            <select className="pos-field w-auto" defaultValue={branches[0].id}>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="hidden items-center gap-1.5 px-2 text-[0.8125rem] text-graphite-700 sm:flex">
            <IconStore className="h-4 w-4 text-azure-500" />
            {branches[0]?.label ?? "Main counter"}
          </p>
        )}

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
              <span className="absolute top-1.5 right-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-signal-bad px-1 text-[0.5625rem] font-bold text-white">
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
                    className="rounded-[9px] px-2.5 py-2 hover:bg-azure-50"
                  >
                    <p className="flex items-center gap-2 text-[0.8125rem] font-medium text-graphite-900">
                      <span
                        className={`h-1.5 w-1.5 flex-none rounded-full ${
                          notice.tone === "warn"
                            ? "bg-signal-warn"
                            : "bg-azure-500"
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

        <div className="relative" ref={profileRef}>
          <button
            type="button"
            onClick={() => setProfileOpen(!profileOpen)}
            className="pos-btn pos-btn-quiet gap-2 px-1.5"
            aria-expanded={profileOpen}
          >
            <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-azure-700 font-display text-[0.75rem] font-bold text-white">
              {initial}
            </span>
            <span className="hidden max-w-32 truncate text-left text-[0.8125rem] font-medium md:block">
              {shopName}
            </span>
            <IconChevron className="hidden h-3.5 w-3.5 md:block" />
          </button>

          {profileOpen ? (
            <div className="pos-menu" role="menu">
              <div className="border-b border-azure-100 px-2.5 pt-1.5 pb-2.5">
                <p className="truncate font-display text-[0.875rem] font-semibold text-graphite-900">
                  {shopName}
                </p>
                <p className="truncate text-[0.75rem] text-graphite-500">
                  {email ?? subtitle}
                </p>
              </div>

              <div className="pt-1">
                <Link href="/app/settings" className="pos-menu-item" role="menuitem">
                  <IconUser className="h-4 w-4" />
                  Shop profile
                </Link>

                {/* A plain form posting to a Server Action, so signing out
                    works even if this bundle has not hydrated yet. */}
                <form action={signOut}>
                  <button
                    type="submit"
                    className="pos-menu-item text-signal-bad hover:bg-signal-bad/10 hover:text-signal-bad"
                    role="menuitem"
                  >
                    <IconSignOut className="h-4 w-4" />
                    Sign out
                  </button>
                </form>
              </div>
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
