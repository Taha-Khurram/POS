import type { Metadata } from "next";
import Link from "next/link";

import { IconCash, IconSales } from "@/components/pos/icons";
import { getModuleAccess, requireModule } from "@/lib/pos/access";
import { listBills } from "@/lib/pos/bills";
import { currentBusinessDay } from "@/lib/pos/counter";
import {
  isDay,
  isRangeId,
  resolveWindow,
  type RangeId,
} from "@/lib/pos/history";
import { getShopProfile, getShopSettings, listCounters } from "@/lib/pos/shop";
import { listStaff } from "@/lib/pos/staff";
import { getDayTakings } from "@/lib/pos/takings";
import { DayClose } from "./day-close";
import { HistoryPanel } from "./history-panel";

export const metadata: Metadata = {
  title: "Sales",
  description: "Every bill the shop has rung up, and what each counter took.",
};

const TABS = [
  { id: "history", label: "Bills", icon: IconSales },
  { id: "day", label: "Day close", icon: IconCash },
] as const;

type TabId = (typeof TABS)[number]["id"];

const isTab = (value: unknown): value is TabId =>
  TABS.some((tab) => tab.id === value);

const asString = (value: unknown) =>
  typeof value === "string" ? value : undefined;

/**
 * Sales.
 *
 * Two questions, two tabs, one screen — and they are genuinely two questions.
 * **Bills** is asked with a customer standing at the counter holding a receipt:
 * find it, look at what was on it, print it again. **Day close** is asked at
 * 11 pm with a drawer of notes in one hand: what should be in counter 1.
 *
 * Bills leads, because it is the one asked twenty times a day. Both live in the
 * URL — the tab, the window, the day — so the page stays a server component,
 * the list is HTML on first paint, and last Tuesday can be sent to an
 * accountant as a link.
 *
 * Everything is windowed on `sales.business_day`, never on a timestamp: the
 * register stamped it once from the shop's own `day_ends_at`, so a dhaba that
 * shuts at 1 am gets its last hour on the day it opened and no screen here
 * re-derives that.
 */
export default async function SalesPage({
  searchParams,
}: PageProps<"/app/sales">) {
  const session = await requireModule("sales");

  if (!session.tenantId) return <NotAttached />;

  const params = await searchParams;
  const tab: TabId = isTab(params.tab) ? params.tab : "history";

  const [settings, counters, access] = await Promise.all([
    getShopSettings(session.tenantId),
    listCounters(session.tenantId),
    // Whether the bill sheet may link a customer's name into their record. The
    // name shows either way — it was on the bill — but a cashier without the
    // module gets no link into a screen that would 404 on them.
    getModuleAccess(session),
  ]);

  const today = currentBusinessDay(settings);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-[1.5rem] leading-tight font-bold">Sales</h1>
        <p className="mt-1 text-[0.8125rem] text-graphite-500">
          Every bill the shop has rung up, and what each counter took.
        </p>
      </header>

      <nav className="pos-tabs" aria-label="Sales sections">
        {TABS.map((item) => (
          <Link
            key={item.id}
            href={`/app/sales?tab=${item.id}`}
            className="pos-tab"
            aria-current={item.id === tab ? "page" : undefined}
            scroll={false}
          >
            <item.icon className="pos-tab-icon h-4 w-4" />
            {item.label}
          </Link>
        ))}
      </nav>

      {tab === "day" ? (
        <DayCloseTab
          tenantId={session.tenantId}
          day={isDay(params.day) ? params.day : today}
          counters={counters}
          settings={settings}
        />
      ) : (
        <BillsTab
          tenantId={session.tenantId}
          today={today}
          range={isRangeId(params.range) ? params.range : "today"}
          custom={{ from: asString(params.from), to: asString(params.to) }}
          // What the search box opens with. It is how the Customers screen
          // links straight at one of their bills, and it makes a search worth
          // sending to somebody as a link.
          query={asString(params.q) ?? ""}
          counters={counters}
          settings={settings}
          canSeeCustomers={access.customers}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The searchable history.
 *
 * The window is resolved here, on the server, and it is the only thing about
 * this list that costs a round trip. Everything the panel does afterwards —
 * search, counter, cashier, payment method, paging — runs on rows the browser
 * already holds, which is what makes finding a bill feel instant on a shop's 3G.
 */
async function BillsTab({
  tenantId,
  today,
  range,
  custom,
  query,
  counters,
  settings,
  canSeeCustomers,
}: {
  tenantId: string;
  today: string;
  range: RangeId;
  custom: { from?: string; to?: string };
  query: string;
  counters: Awaited<ReturnType<typeof listCounters>>;
  settings: Awaited<ReturnType<typeof getShopSettings>>;
  canSeeCustomers: boolean;
}) {
  const window = resolveWindow(range, today, custom);

  const [staff, shop] = await Promise.all([
    listStaff(tenantId),
    // The shop that prints at the top of a reprinted receipt. Null is an
    // account whose `tenants` row RLS will not return — the list still draws,
    // and the roll falls back to a name rather than failing.
    getShopProfile(tenantId),
  ]);

  const page = await listBills(tenantId, window, { counters, staff });

  return (
    <HistoryPanel
      page={page}
      range={range}
      today={today}
      openingQuery={query}
      counters={counters}
      staff={staff.map((member) => ({ id: member.id, name: member.name }))}
      settings={settings}
      shop={shop}
      canSeeCustomers={canSeeCustomers}
    />
  );
}

async function DayCloseTab({
  tenantId,
  day,
  counters,
  settings,
}: {
  tenantId: string;
  day: string;
  counters: Awaited<ReturnType<typeof listCounters>>;
  settings: Awaited<ReturnType<typeof getShopSettings>>;
}) {
  const takings = await getDayTakings(
    tenantId,
    day,
    counters.map((counter) => ({ id: counter.id, name: counter.name })),
  );

  return (
    <DayClose day={day} takings={takings} counters={counters} settings={settings} />
  );
}

/** Same words as the register's gate, because it is the same problem. */
function NotAttached() {
  return (
    <div className="pos-card mx-auto max-w-lg p-6">
      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-orchid-50 text-orchid-700">
        <IconSales className="h-5 w-5" />
      </span>

      <h1 className="mt-4 font-display text-[1.375rem] font-bold">
        Account not attached yet
      </h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-graphite-700">
        You are signed in, but this login is not linked to a shop, so there are
        no sales to show. Message us on the same WhatsApp number you arranged
        Flo on and we will attach it.
      </p>
    </div>
  );
}
