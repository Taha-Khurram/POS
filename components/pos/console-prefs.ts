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

export type ConsoleTheme = "light" | "dark";

/** A year, path-wide, lax: these are display preferences, not sessions. */
export const rememberPref = (name: string, value: string) => {
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
};
