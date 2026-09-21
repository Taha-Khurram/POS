import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { IconTables } from "@/components/pos/icons";
import { requireModule } from "@/lib/pos/access";
import { getTillAccess } from "@/lib/pos/access";
import { listSellableProducts } from "@/lib/pos/items";
import { moneyFormatter } from "@/lib/pos/counter";
import { listActiveCustomers } from "@/lib/pos/customers";
import type { ShopProfile } from "@/lib/pos/shop";
import { getShopProfile, getShopSettings, listCounters } from "@/lib/pos/shop";
import { listStaff } from "@/lib/pos/staff";
import {
  floorSummary,
  getTableOrder,
  listCounterOrders,
  listTables,
  modifiersByItem,
} from "@/lib/pos/tables";
import { variantsByItem } from "@/lib/pos/variants";
import { FloorMap } from "./floor-map";
import { OrderScreen } from "./order-screen";

export const metadata: Metadata = {
  title: "Tables",
  description: "The floor: who is sitting where, what they have ordered, and what it comes to.",
};

/**
 * The floor.
 *
 * Two screens behind one route, the way Customers does it: without
 * `?order=<id>` it is the map, and with one it is that bill. The page stays a
 * server component either way — the map is HTML on first paint, and one order
 * needs a query per order that has no business running in the browser.
 *
 * `requireModule("tables")` is the gate, and it is not a permission: it reads
 * `tenant_settings.restaurant_mode`, so a kiryana typing the path gets a 404
 * rather than an empty floor. That is the same `notFound()` every other module
 * gate uses, and for the same reason — a screen that says "not for your shop"
 * has confirmed the screen exists.
 */
export default async function TablesPage({
  searchParams,
}: PageProps<"/app/tables">) {
  const session = await requireModule("tables");

  if (!session.tenantId) return <NotAttached />;
  const tenantId = session.tenantId;

  const asked = (await searchParams).order;
  const orderId = typeof asked === "string" ? asked : null;

  // The roster first, because every reader below resolves "who opened this"
  // against it — the browser is handed a name and never the list of everybody
  // who could have opened a table. The same call `/app/register` makes.
  const staff = await listStaff(tenantId);
  const names = staff.map((person) => ({ id: person.id, name: person.name }));

  const settings = await getShopSettings(tenantId);
  const money = moneyFormatter(settings);

  if (orderId) {
    const order = await getTableOrder(tenantId, orderId, names);
    if (!order) notFound();

    const [products, variants, modifiers, counters, till, shop] =
      await Promise.all([
        listSellableProducts(tenantId),
        variantsByItem(tenantId),
        modifiersByItem(tenantId),
        listCounters(tenantId),
        getTillAccess(session),
        getShopProfile(tenantId),
      ]);

    // `getShopProfile` falls back rather than failing, like every other reader
    // in `shop.ts` — but it is typed nullable, and the kitchen ticket needs a
    // name at the top. The shop's own, or the words that say there isn't one.
    const named = shop ?? { shopName: "This shop", shopType: "restaurant" };

    return (
      <OrderScreen
        order={order}
        products={products}
        variants={variants}
        modifiers={modifiers}
        counters={counters.filter((counter) => counter.isActive)}
        access={till}
        settings={settings}
        shop={named as ShopProfile}
        money={money}
      />
    );
  }

  const [tables, counterOrders] = await Promise.all([
    listTables(tenantId, names),
    listCounterOrders(tenantId, names),
  ]);

  const summary = floorSummary(tables, counterOrders);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-[1.5rem] leading-tight font-bold">Tables</h1>
        <p className="mt-1 text-[0.8125rem] text-graphite-500">
          Who is sitting where, what they have ordered, and what it comes to.
        </p>
      </header>

      <section
        aria-label="The floor at a glance"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <Tile
          label="Tables in use"
          value={`${summary.occupied} of ${summary.tables}`}
          note={summary.occupied === 0 ? "The floor is empty" : "With a bill open"}
        />
        <Tile
          label="People sitting"
          value={summary.covers.toLocaleString("en-PK")}
          note="Covers across every open bill"
        />
        <Tile
          label="On the floor"
          value={money(summary.onFloor)}
          note="Ordered and not yet settled"
        />
        <Tile
          label="Not sent to the kitchen"
          value={summary.unsent.toLocaleString("en-PK")}
          // The one figure here that is a problem rather than a fact: lines
          // typed at a table that no cook has seen.
          note={
            summary.unsent > 0
              ? "Lines nobody is cooking yet"
              : "Everything ordered is in the kitchen"
          }
          alert={summary.unsent > 0}
        />
      </section>

      <FloorMap
        tables={tables}
        counterOrders={counterOrders}
        customers={await listActiveCustomers(tenantId)}
        money={money}
      />
    </div>
  );
}

function Tile({
  label,
  value,
  note,
  alert = false,
}: {
  label: string;
  value: string;
  note: string;
  alert?: boolean;
}) {
  return (
    <article className={`pos-card p-4 ${alert ? "border-signal-warn" : ""}`}>
      <h2 className="font-display text-[0.8125rem] leading-tight font-semibold text-graphite-500">
        {label}
      </h2>
      <p
        className={`mt-2.5 font-display text-[1.75rem] leading-none font-bold tracking-tight tabular-nums ${
          alert ? "text-signal-warn" : "text-graphite-900"
        }`}
      >
        {value}
      </p>
      <p className="mt-2.5 text-[0.75rem] text-graphite-500">{note}</p>
    </article>
  );
}

/** Same words as every other module's gate — it is one problem. */
function NotAttached() {
  return (
    <div className="pos-card mx-auto max-w-lg p-6">
      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-orchid-50 text-orchid-700">
        <IconTables className="h-5 w-5" />
      </span>

      <h1 className="mt-4 font-display text-[1.375rem] font-bold">
        Account not attached yet
      </h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-graphite-700">
        You are signed in, but this login is not linked to a shop, so there is no
        floor to show. Message us on the same WhatsApp number you arranged Flo on
        and we will attach it.
      </p>
    </div>
  );
}
