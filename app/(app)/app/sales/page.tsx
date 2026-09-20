import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";

import { COUNTER_COOKIE } from "@/components/pos/console-prefs";

import { IconCash, IconDrawer, IconSales } from "@/components/pos/icons";
import { getModuleAccess, getTillAccess, requireModule } from "@/lib/pos/access";
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
import { listShifts } from "@/lib/pos/shifts";
import { getDayTakings } from "@/lib/pos/takings";
import { DayClose } from "./day-close";
import { HistoryPanel } from "./history-panel";
import { ShiftsPanel } from "./shifts-panel";

export const metadata: Metadata = {
  title: "Sales",
  description: "Every bill the shop has rung up, and what each counter took.",
};

const TABS = [
  { id: "history", label: "Bills", icon: IconSales },
  { id: "day", label: "Day close", icon: IconCash },
  // Third rather than second, because it is the one asked weekly and the other
  // two are asked daily. It is also a different question from Day close: that
  // one is what a counter took between opening and midnight, this one is what
  // a person's drawer came to over four hours — which is the one that makes a
  // Rs 300 gap visible at all.
  { id: "shifts", label: "Shifts", icon: IconDrawer },
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

  const [settings, counters, access, till, jar] = await Promise.all([
    getShopSettings(session.tenantId),
    listCounters(session.tenantId),
    // Whether the bill sheet may link a customer's name into their record. The
    // name shows either way — it was on the bill — but a cashier without the
    // module gets no link into a screen that would 404 on them.
    getModuleAccess(session),
    // And whether they may take a return, which is a different question with a
    // different switch behind it: `can_refund`, not a module.
    getTillAccess(session),
    cookies(),
  ]);

  const today = currentBusinessDay(settings);

  // Which drawer a refund would come out of. The device's own counter, the
  // same `flo_counter` cookie the register bills from — money going back
  // belongs to the till it is handed out of, and that till is a property of
  // the tablet by the door rather than of whoever is standing at it.
  //
  // Re-checked against the shop's open counters here, and again by
  // `recordReturn`. Null means the button is not drawn at all: no permission,
  // no open counter, or a tablet nobody has pointed anywhere yet — and there
  // is no sensible default, because guessing which drawer the money left from
  // is how a day-end count stops balancing.
  const open = counters.filter((counter) => counter.isActive);
  const device = jar.get(COUNTER_COOKIE)?.value ?? null;

  const refundCounter = till.canRefund
    ? (open.find((counter) => counter.id === device) ??
      // One open till is not a guess. A shop with a single counter has exactly
      // one drawer the money can come out of.
      (open.length === 1 ? open[0] : null))
    : null;

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

      {tab === "shifts" ? (
        <ShiftsTab
          tenantId={session.tenantId}
          counters={counters}
          settings={settings}
          canSeeVariance={till.canCloseShift}
        />
      ) : tab === "day" ? (
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
          refundCounter={refundCounter}
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
  refundCounter,
}: {
  tenantId: string;
  today: string;
  range: RangeId;
  custom: { from?: string; to?: string };
  query: string;
  counters: Awaited<ReturnType<typeof listCounters>>;
  settings: Awaited<ReturnType<typeof getShopSettings>>;
  canSeeCustomers: boolean;
  refundCounter: Awaited<ReturnType<typeof listCounters>>[number] | null;
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
      refundCounter={refundCounter}
    />
  );
}

/**
 * Every drawer the shop has counted.
 *
 * The variance columns are behind `can_close_shift`, the same switch the
 * closing sheet on the register honours — and for a stronger reason here, since
 * this is every shift the shop has ever run: a cashier who could read it would
 * know what the last four counts came to before doing their own.
 */
async function ShiftsTab({
  tenantId,
  counters,
  settings,
  canSeeVariance,
}: {
  tenantId: string;
  counters: Awaited<ReturnType<typeof listCounters>>;
  settings: Awaited<ReturnType<typeof getShopSettings>>;
  canSeeVariance: boolean;
}) {
  const staff = await listStaff(tenantId);

  const shifts = await listShifts(tenantId, {
    counters: counters.map((counter) => ({ id: counter.id, name: counter.name })),
    staff: staff.map((person) => ({ id: person.id, name: person.name })),
  });

  return (
    <ShiftsPanel
      shifts={shifts}
      settings={settings}
      canSeeVariance={canSeeVariance}
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
