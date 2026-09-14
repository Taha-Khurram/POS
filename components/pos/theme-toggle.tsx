"use client";

import { useState } from "react";

import { rememberPref, THEME_COOKIE, type ConsoleTheme } from "./console-prefs";
import { IconMoon, IconSun } from "./icons";

/**
 * Light or dark, for this device.
 *
 * Deliberately not `prefers-color-scheme`. The counter is light on purpose —
 * dark glass under a tube light at 2 pm is why /app has its own palette at all
 * — and a cashier whose Android happens to be in dark mode should not arrive at
 * a dark till having never asked for one. The owner going through the day's
 * figures at 11 pm asks for it once, on their own machine.
 *
 * It follows the rail's collapse preference exactly: a cookie, read by the
 * layout on the server, so the console renders in the right palette in its
 * first byte rather than flashing white and correcting itself a frame after
 * hydration. On the cheapest tablet we support that flash is a third of a
 * second of white screen, at night, every single navigation.
 *
 * Which is also why the flip is written straight onto the DOM node rather than
 * lifted into React state: `data-theme` lives on the server-rendered
 * `.pos-root` wrapper, and re-rendering the whole console to change one
 * attribute would cost a round trip to move a class name.
 */
export function ThemeToggle({ initial }: { initial: ConsoleTheme }) {
  const [theme, setTheme] = useState<ConsoleTheme>(initial);
  const dark = theme === "dark";

  const flip = (event: React.MouseEvent<HTMLButtonElement>) => {
    const next: ConsoleTheme = dark ? "light" : "dark";

    // The button's own ancestor, not a document-wide query: the console is a
    // wrapper the layout renders, and `closest` cannot pick the wrong one.
    event.currentTarget.closest<HTMLElement>(".pos-root")?.setAttribute("data-theme", next);

    setTheme(next);
    rememberPref(THEME_COOKIE, next);
  };

  return (
    <button
      type="button"
      onClick={flip}
      className="pos-icon-btn"
      // The label says what pressing it does, not what is currently on — a
      // screen reader user has no use for "dark mode is on" on a button.
      aria-label={dark ? "Switch to the light counter" : "Switch to dark"}
      title={dark ? "Light" : "Dark"}
    >
      {dark ? <IconSun /> : <IconMoon />}
    </button>
  );
}
