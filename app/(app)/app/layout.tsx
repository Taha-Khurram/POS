import type { Viewport } from "next";
import { cookies } from "next/headers";

import { ConsoleShell, RAIL_COOKIE } from "@/components/pos/console-shell";
import type { Branch, Notice } from "@/components/pos/console-header";
import { requireSession } from "@/lib/auth";

export const viewport: Viewport = {
  themeColor: "#1b4965",
  colorScheme: "light",
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

  // The rail's collapse preference, read before the first byte so the shell
  // renders at the right width instead of snapping shut after hydration.
  const initialTight = (await cookies()).get(RAIL_COOKIE)?.value === "1";

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
    <div className="pos-root">
      <ConsoleShell
        shopName={SHOP_NAME}
        subtitle="Flo dashboard"
        email={session.email}
        branches={BRANCHES}
        notices={notices}
        initialTight={initialTight}
      >
        {children}
      </ConsoleShell>
    </div>
  );
}
