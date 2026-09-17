/**
 * The console's two display preferences and the cookies they travel in.
 *
 * A plain module, deliberately. Both names are read by the server layout and
 * written by a client component, and a `"use client"` module cannot supply the
 * server half: when a Server Component imports one, Next replaces every export
 * with a client reference, so `RAIL_COOKIE` arrived in the layout as a throwing
 * stub rather than "flo_rail". `cookies().get()` then looked up a key no
 * browser has ever sent and fell through to the default — silently, which is
 * why nobody noticed the rail had stopped remembering it was collapsed.
 *
 * Both preferences are cookies rather than `localStorage` for the same reason:
 * the layout reads them before the first byte, so the console renders at the
 * right width and in the right palette instead of correcting itself a frame
 * after hydration. On the cheapest tablet we support, that correction is a
 * visible flash on every navigation — a white one, at night, for the theme.
 */

export const RAIL_COOKIE = "flo_rail";

export const THEME_COOKIE = "flo_theme";

/**
 * Which counter this tablet bills from.
 *
 * A device preference and not a user one, which is why it is here beside the
 * rail and the theme rather than on `profiles`: the till by the door is the
 * till by the door whoever is standing at it, and a manager who signs in to
 * cover a break must not drag counter 1's receipt series onto counter 2.
 *
 * Read by the register on the server, so it has to be a cookie — the same
 * reason the theme is one.
 */
export const COUNTER_COOKIE = "flo_counter";

/**
 * The last set of notices this device looked at.
 *
 * Holds the signature `lib/pos/notices.ts` computes, not a date and not a list
 * of ids: the bell has nothing to mark read on the server — every notice is
 * derived from rows that are already there — so "seen" can only mean "the
 * shop's worries were these when somebody last opened it". The badge comes back
 * by itself the moment one of them changes.
 *
 * A cookie rather than storage for the same reason as the rest of this file:
 * the layout decides whether the badge is lit before the first byte, so it does
 * not light up and then go out a frame after hydration.
 */
export const NOTICES_COOKIE = "flo_seen";

export type ConsoleTheme = "light" | "dark";

/** A year, path-wide, lax: these are display preferences, not sessions. */
export const rememberPref = (name: string, value: string) => {
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
};
