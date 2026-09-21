import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";

import { AdminShell } from "@/components/admin/admin-shell";
import {
  RAIL_COOKIE,
  THEME_COOKIE,
  type ConsoleTheme,
} from "@/components/pos/console-prefs";
import { requirePlatform } from "@/lib/platform/access";
import { getOverview } from "@/lib/platform/console";

export const metadata: Metadata = {
  title: {
    default: "Platform",
    template: "%s — Flo platform",
  },
  // Nothing here should ever be indexed, and the console is 404 to everybody
  // else anyway — but a crawler that followed a pasted link would otherwise put
  // "Clients — Flo platform" in a search result.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#3020a4",
  colorScheme: "light dark",
};

/**
 * The owner console.
 *
 * Its own route group so it inherits neither the marketing site's `Nav` and
 * `Footer` nor `/app`'s tenant chrome — the same reason `(auth)` is a group of
 * its own. `app/layout.tsx` above it is still html, body and fonts only.
 *
 * `requirePlatform()` is the gate and it 404s rather than refusing, so a
 * shopkeeper who types `/admin` learns nothing. It runs here *and* in every
 * page, because a layout is not a guarantee: Next renders a page and its layout
 * in parallel, so a layout that redirects does not stop the page beneath it
 * from having already read the database.
 *
 * The rail's two counts come off the same `platform_overview` call the home
 * page makes. That is one extra RPC per navigation and it buys the thing this
 * console is for: an operator can see that four payment proofs are waiting
 * without opening the screen they are waiting on.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const session = await requirePlatform();
  const overview = await getOverview();

  const jar = await cookies();
  const initialTight = jar.get(RAIL_COOKIE)?.value === "1";
  const theme: ConsoleTheme =
    jar.get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";

  return (
    <div className="pos-root" data-theme={theme}>
      <AdminShell
        email={session.email}
        role={session.platformRole}
        counts={{
          ordersToVerify: overview.ordersToVerify,
          leadsNew: overview.leadsNew,
          // Everything already over, plus everything about to be. One number,
          // because the answer to both is the same phone call.
          expiring: overview.expiring7 + overview.expired,
        }}
        initialTight={initialTight}
        theme={theme}
      >
        {children}
      </AdminShell>
    </div>
  );
}
