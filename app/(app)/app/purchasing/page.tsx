import type { Metadata } from "next";
import Link from "next/link";

import { IconBox, IconTag, IconTruck } from "@/components/pos/icons";
import { requireModule } from "@/lib/pos/access";
import { moneyFormatter } from "@/lib/pos/counter";
import { listProducts } from "@/lib/pos/items";
import { getShopSettings } from "@/lib/pos/shop";
import { listSuppliers } from "@/lib/pos/suppliers";
import type { GoodsReceipt, PurchaseOrder } from "@/lib/pos/purchase";
import {
  listGoodsReceipts,
  listOpenOrders,
  listPurchaseOrders,
  purchaseTotals,
} from "@/lib/pos/purchases";
import { OrdersPanel } from "./orders-panel";
import { ReceiptsPanel } from "./receipts-panel";
import { SuppliersPanel } from "./suppliers-panel";

export const metadata: Metadata = {
  title: "Buying",
  description: "Who the shop buys from, what it ordered, and what it paid.",
};

/**
 * Buying: three tabs over one route, because they are three questions.
 *
 * `?tab=orders` — the default — is asked with a distributor on the phone: what
 * am I still owed. `?tab=deliveries` is asked when a margin looks wrong: what
 * did this actually cost me, carriage and all. `?tab=suppliers` is asked when
 * the shelf is empty on a Friday: who do I ring.
 *
 * The section lives in the URL the same way Settings' and the item list's do:
 * the page stays a server component, the tables are HTML on first paint, and
 * the tab somebody is looking at survives a reload on a tablet that lost the
 * network mid-tap.
 *
 * Gated by `can_manage_purchasing` — not `can_edit_items` — because taking a
 * delivery in writes `items.cost_price`, and that is the number every margin on
 * Reports is worked out from.
 */

const TABS = [
  { id: "orders", label: "Orders", icon: IconBox },
  { id: "deliveries", label: "Deliveries", icon: IconTruck },
  { id: "suppliers", label: "Suppliers", icon: IconTag },
] as const;

type TabId = (typeof TABS)[number]["id"];

const isTab = (value: unknown): value is TabId =>
  TABS.some((tab) => tab.id === value);

export default async function PurchasingPage({
  searchParams,
}: PageProps<"/app/purchasing">) {
  const session = await requireModule("purchasing");

  const raw = (await searchParams).tab;
  const tab: TabId = isTab(raw) ? raw : "orders";

  if (!session.tenantId) return <NotAttached />;
  const tenantId = session.tenantId;

  const [suppliers, orders, receipts, settings] = await Promise.all([
    listSuppliers(tenantId),
    listPurchaseOrders(tenantId),
    listGoodsReceipts(tenantId),
    getShopSettings(tenantId),
  ]);

  const money = moneyFormatter(settings);

  // The catalog feeds both sheets' line search, and the open orders feed the
  // delivery sheet's picker. Read only for the tabs that draw them: the
  // suppliers tab has no line editor on it, and the item list is the single
  // biggest read on this page.
  const products = tab === "suppliers" ? [] : await listProducts(tenantId);

  const openOrders =
    tab === "deliveries"
      ? (
          await Promise.all(
            // Placed orders with something still owed, per supplier the shop
            // actually buys from. Only the active ones — a distributor who has
            // shut down is not one a delivery is coming from.
            suppliers
              .filter((supplier) => supplier.isActive)
              .map((supplier) => listOpenOrders(tenantId, supplier.id)),
          )
        ).flat()
      : [];

  const pickable = suppliers
    .filter((supplier) => supplier.isActive)
    .map((supplier) => ({ id: supplier.id, name: supplier.name }));

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-[1.5rem] leading-tight font-bold">Buying</h1>
        <p className="mt-1 text-[0.8125rem] text-graphite-500">
          What you ordered, what came in, and what it really cost you.
        </p>
      </header>

      <BuyingStats orders={orders} receipts={receipts} money={money} />

      {/* The count rides in the tab so the switcher answers "is there anything
          in there" without a visit — the same call the item list makes. */}
      <nav className="pos-tabs" aria-label="Buying sections">
        {TABS.map((item) => {
          const count =
            item.id === "orders"
              ? orders.length
              : item.id === "deliveries"
                ? receipts.length
                : suppliers.length;

          return (
            <Link
              key={item.id}
              href={`/app/purchasing?tab=${item.id}`}
              className="pos-tab"
              aria-current={item.id === tab ? "page" : undefined}
              scroll={false}
            >
              <item.icon className="pos-tab-icon h-4 w-4" />
              {item.label}
              <span className="pos-tab-count">{count.toLocaleString("en-PK")}</span>
            </Link>
          );
        })}
      </nav>

      {tab === "orders" ? (
        <OrdersPanel
          orders={orders}
          suppliers={pickable}
          products={products}
          money={money}
        />
      ) : tab === "deliveries" ? (
        <ReceiptsPanel
          receipts={receipts}
          suppliers={pickable}
          products={products}
          openOrders={openOrders}
          money={money}
        />
      ) : (
        <SuppliersPanel suppliers={suppliers} />
      )}
    </div>
  );
}

/**
 * Four figures that answer what an owner opens this screen to ask.
 *
 * "Spent" is over the deliveries that were *read*, which is every one of them
 * up to the cap — and it is deliveries and not orders deliberately: an order is
 * an intention and nobody owes anybody anything for one. The caption says so,
 * for the reason every windowed figure in this console says what it covers.
 */
function BuyingStats({
  orders,
  receipts,
  money,
}: {
  orders: PurchaseOrder[];
  receipts: GoodsReceipt[];
  money: (value: number) => string;
}) {
  const totals = purchaseTotals(receipts);

  const awaiting = orders.filter(
    (order) => order.status === "placed" && order.receivedLines < order.lines,
  );

  const owed = awaiting.reduce((total, order) => total + order.total, 0);

  const tiles = [
    {
      label: "Orders still open",
      value: awaiting.length.toLocaleString("en-PK"),
      note: awaiting.length === 0 ? "Nothing on its way" : `${money(owed)} of goods`,
    },
    {
      label: "Deliveries taken in",
      value: totals.deliveries.toLocaleString("en-PK"),
      note: "Every one on record",
    },
    {
      label: "Spent on stock",
      value: money(totals.spent),
      note: "Across those deliveries, carriage included",
    },
    {
      label: "Of that, carriage",
      value: money(totals.freight),
      note:
        totals.spent > 0
          ? `${((totals.freight / totals.spent) * 100).toFixed(1)}% on top of the goods`
          : "Freight and the rest",
    },
  ];

  // There is no supplier tile: that count is already on the tab two inches
  // away, and a figure shown twice is a figure somebody checks twice.

  return (
    <section
      aria-label="Buying at a glance"
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      {tiles.map((tile) => (
        <article key={tile.label} className="pos-card p-4">
          <h2 className="font-display text-[0.8125rem] leading-tight font-semibold text-graphite-500">
            {tile.label}
          </h2>

          <p className="mt-2.5 font-display text-[1.75rem] leading-none font-bold tracking-tight text-graphite-900 tabular-nums">
            {tile.value}
          </p>

          <p className="mt-2.5 text-[0.75rem] text-graphite-500">{tile.note}</p>
        </article>
      ))}
    </section>
  );
}

/** Same words as the register's, Settings' and Products & stock's gate — it is
 *  one problem. */
function NotAttached() {
  return (
    <div className="pos-card mx-auto max-w-lg p-6">
      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-orchid-50 text-orchid-700">
        <IconTruck className="h-5 w-5" />
      </span>

      <h1 className="mt-4 font-display text-[1.375rem] font-bold">
        Account not attached yet
      </h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-graphite-700">
        You are signed in, but this login is not linked to a shop, so there is
        nothing to buy for. Message us on the same WhatsApp number you arranged
        Flo on and we will attach it.
      </p>
    </div>
  );
}
