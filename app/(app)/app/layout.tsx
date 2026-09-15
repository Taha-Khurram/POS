import type { Viewport } from "next";
import { cookies } from "next/headers";

import type { Branch, Notice } from "@/components/pos/console-header";
import {
  RAIL_COOKIE,
  THEME_COOKIE,
  type ConsoleTheme,
} from "@/components/pos/console-prefs";
import { ConsoleShell } from "@/components/pos/console-shell";
import { requireSession } from "@/lib/auth";

export const viewport: Viewport = {
  // orchid-800. The one colour that cannot come from a token — the browser
  // paints its own chrome with it before any stylesheet is read.
  themeColor: "#3020a4",
  // Both, because the counter can be switched to the dark palette per device.
  // The element-level `color-scheme` on `.pos-root` is what actually decides;
  // this only stops the UA assuming one and painting form controls to match.
  colorScheme: "light dark",
};

/**
 * The shop the console is dressed as. A fixed label for now: the tenant and
 * branch lookups that used to run here are gone, so the layout makes no
 * database round-trip at all and a signed-in account lands on the dashboard
 * whether or not a shop row exists for it yet. Restore the queries here, not in
 * the pages, when shops come back.
 */
const SHOP_NAME = "Your shop";
const BRANCHES: Branch[] = [{ id: "main", label: "Main counter" }];

/**
 * The client's product. Route protection is a layout-level check, not proxy
 * logic — `proxy.ts` stays a pure `updateSession` call so nothing sits between
 * creating the Supabase client and `getUser()`.
 *
 * Everything below `ConsoleShell` stays a server component. The shell is a
 * client component only because a rail collapses and a drawer opens; `children`
 * is passed through it as an already-rendered tree, so no page inherits a
 * client boundary from the chrome.
 */
export default async function ConsoleLayout({ children }: LayoutProps<"/app">) {
  const session = await requireSession();

  // Both display preferences, read before the first byte so the shell renders
  // at the right width and in the right palette instead of correcting itself a
  // frame after hydration. Light is the default and the fallback: a counter
  // nobody has set a preference on is a light counter.
  const jar = await cookies();
  const initialTight = jar.get(RAIL_COOKIE)?.value === "1";
  const theme: ConsoleTheme =
    jar.get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";

  // Standing in for the alerts the modules will raise once they exist: low
  // stock from `items`, udhaar past its terms from the khata, renewal dates
  // from `subscriptions`. Shaped now so the topbar is not rebuilt later.
  const notices: Notice[] = [
    {
      id: "renewal",
      title: "Plan renews in 12 days",
      detail: "We will send the invoice on WhatsApp",
      at: "Today",
      tone: "info",
    },
    {
      id: "sync",
      title: "All registers synced",
      detail: "Last device checked in a moment ago",
      at: "Today",
      tone: "info",
    },
  ];

  return (
    <div className="pos-root" data-theme={theme}>
      <ConsoleShell
        shopName={SHOP_NAME}
        email={session.email}
        branches={BRANCHES}
        notices={notices}
        initialTight={initialTight}
        theme={theme}
      >
        {children}
      </ConsoleShell>
    </div>
  );
}
