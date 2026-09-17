import type { Viewport } from "next";
import { cookies } from "next/headers";

import {
  NOTICES_COOKIE,
  RAIL_COOKIE,
  THEME_COOKIE,
  type ConsoleTheme,
} from "@/components/pos/console-prefs";
import { ConsoleShell } from "@/components/pos/console-shell";
import { requireSession } from "@/lib/auth";
import { getEntitlements } from "@/lib/entitlements";
import { getModuleAccess } from "@/lib/pos/access";
import { SAMPLE_ITEMS, stockState } from "@/lib/pos/catalog";
import {
  buildNotices,
  noticeSignature,
  visibleNotices,
} from "@/lib/pos/notices";
import { getShopName, listCounters } from "@/lib/pos/shop";

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

  // Everything the chrome is dressed with, in one round of reads:
  //
  //   - The shop name for the rail's account block. One column, read through
  //     the shop's own JWT, falling back to a label rather than failing — an
  //     account with no tenant still lands on the dashboard.
  //   - Which rail rows this person gets. Permissions decide the working
  //     modules and the role decides the two administration screens;
  //     `lib/pos/modules.ts` is the whole of that reasoning, and every page
  //     re-checks it for itself.
  //   - The bell's raw material. It is gathered here because the topbar is in
  //     the layout and there is nowhere later to ask. Both extra reads are
  //     small and neither is allowed to fail the console: a shop whose
  //     subscription cannot be resolved still gets a till, it just gets a
  //     quieter bell.
  const [shopName, access, entitlements, counters] = await Promise.all([
    getShopName(session.tenantId),
    getModuleAccess(session),
    session.tenantId ? getEntitlements(session.tenantId) : null,
    session.tenantId ? listCounters(session.tenantId) : [],
  ]);

  // Both display preferences, read before the first byte so the shell renders
  // at the right width and in the right palette instead of correcting itself a
  // frame after hydration. Light is the default and the fallback: a counter
  // nobody has set a preference on is a light counter.
  const jar = await cookies();
  const initialTight = jar.get(RAIL_COOKIE)?.value === "1";
  const theme: ConsoleTheme =
    jar.get(THEME_COOKIE)?.value === "dark" ? "dark" : "light";

  // What the shop actually has to worry about, then what this person is allowed
  // to be told about it. The stock counts come off `SAMPLE_ITEMS` because that
  // is still what Products & stock draws — the bell and that screen have to
  // agree about what is on the shelf, and they will go on agreeing when the
  // list becomes a query.
  const notices = visibleNotices(
    buildNotices({
      subscription: entitlements
        ? {
            status: entitlements.status,
            planName: entitlements.planName,
            daysUntilExpiry: entitlements.daysUntilExpiry,
            maxRegisters: entitlements.maxRegisters,
          }
        : null,
      counters,
      stock: {
        out: SAMPLE_ITEMS.filter((item) => stockState(item) === "out").length,
        low: SAMPLE_ITEMS.filter((item) => stockState(item) === "low").length,
      },
    }),
    access,
    session.tenantRole,
  );

  // The badge is lit when the shop's worries are not the set this device last
  // opened the bell on — so it clears on a look and comes back on a change,
  // without a read receipt per user anywhere.
  const signature = noticeSignature(notices);
  const unseen = jar.get(NOTICES_COOKIE)?.value !== signature;

  return (
    <div className="pos-root" data-theme={theme}>
      <ConsoleShell
        shopName={shopName}
        email={session.email}
        notices={notices}
        signature={signature}
        unseen={unseen}
        access={access}
        initialTight={initialTight}
        theme={theme}
      >
        {children}
      </ConsoleShell>
    </div>
  );
}
