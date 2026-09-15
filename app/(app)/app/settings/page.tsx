import type { Metadata } from "next";
import Link from "next/link";

import { IconEmployees, IconRegister, IconStore } from "@/components/pos/icons";
import { requireSession } from "@/lib/auth";
import { getEntitlements } from "@/lib/entitlements";
import {
  getRolePermissions,
  getShopProfile,
  getShopSettings,
  listCounters,
} from "@/lib/pos/shop";
import { CountersPanel } from "./counters-panel";
import { RolesPanel } from "./roles-panel";
import { StorePanel } from "./store-panel";

export const metadata: Metadata = {
  title: "Settings",
  description:
    "Shop details, currency and clock, the counter, and who can do what.",
};

const TABS = [
  { id: "store", label: "Shop & currency", icon: IconStore },
  { id: "counter", label: "Counter", icon: IconRegister },
  { id: "roles", label: "Roles & permissions", icon: IconEmployees },
] as const;

type TabId = (typeof TABS)[number]["id"];

const isTab = (value: unknown): value is TabId =>
  TABS.some((tab) => tab.id === value);

/**
 * Settings.
 *
 * The section lives in the URL rather than in React state, for the same reason
 * the dashboard's period does: the page stays a server component, and a half
 * filled screen can be sent to whoever actually knows the NTN.
 *
 * Every tab is read through the shop's own JWT and written through a Server
 * Action on the service role. `readOnly` here is presentation only — it greys
 * the forms out for a manager, and the action checks the role again for itself,
 * because a disabled input is a suggestion and not a control.
 */
export default async function SettingsPage({
  searchParams,
}: PageProps<"/app/settings">) {
  const session = await requireSession();

  const query = await searchParams;
  const tab: TabId = isTab(query.tab) ? query.tab : "store";

  if (!session.tenantId) {
    return <NotAttached />;
  }

  const [shop, settings, counters, permissions, entitlements] = await Promise.all([
    getShopProfile(session.tenantId),
    getShopSettings(session.tenantId),
    listCounters(session.tenantId),
    getRolePermissions(session.tenantId),
    getEntitlements(session.tenantId),
  ]);

  // The claim says there is a shop but RLS returned nothing. In practice that
  // is the access-token hook switched off in the project, which is worth
  // saying out loud — it is silent everywhere else.
  if (!shop) return <NotAttached unreadable />;

  const readOnly = session.tenantRole !== "owner";

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-[1.5rem] leading-tight font-bold">
          Settings
        </h1>
        <p className="mt-1 text-[0.8125rem] text-graphite-500">
          {shop.shopName} · {shop.city}
        </p>
      </header>

      <nav className="pos-tabs" aria-label="Settings sections">
        {TABS.map((item) => (
          <Link
            key={item.id}
            href={`/app/settings?tab=${item.id}`}
            className="pos-tab"
            aria-current={item.id === tab ? "page" : undefined}
            scroll={false}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        ))}
      </nav>

      {tab === "store" ? (
        <StorePanel shop={shop} settings={settings} readOnly={readOnly} />
      ) : tab === "counter" ? (
        <CountersPanel
          counters={counters}
          // A counter id in the URL that is not one of this shop's simply falls
          // back to the list, the same way an unknown tab does.
          selected={
            counters.find((item) => item.id === query.counter) ?? null
          }
          maxRegisters={entitlements?.maxRegisters ?? 1}
          atLimit={query.full === "1"}
          readOnly={readOnly}
        />
      ) : (
        <RolesPanel permissions={permissions} readOnly={readOnly} />
      )}

      <p className="px-1 pb-2 text-[0.75rem] text-graphite-500">
        A second counter, the 80 mm printer test page, and your plan and
        invoices arrive in Part 7 — week of 6 October.
      </p>
    </div>
  );
}

/**
 * Signed in, but nothing to show. Same words as the register's gate, because
 * it is the same problem and a shopkeeper should not have to work out that two
 * screens are complaining about one thing.
 */
function NotAttached({ unreadable = false }: { unreadable?: boolean }) {
  return (
    <div className="pos-card mx-auto max-w-lg p-6">
      <h1 className="font-display text-[1.375rem] font-bold">
        Account not attached yet
      </h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-graphite-700">
        You are signed in, but this login is not linked to a shop. Message us on
        the same WhatsApp number you arranged Flo on and we will attach it.
      </p>

      {unreadable ? (
        <p className="pos-hint mt-3">
          Developer note: the session carries a tenant but the shop row came
          back empty, which almost always means the Customize Access Token hook
          is off. Run <code>npm run doctor</code> with your password.
        </p>
      ) : null}
    </div>
  );
}
