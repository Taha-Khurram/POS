import type { Metadata } from "next";
import Link from "next/link";

import { notFound } from "next/navigation";

import { IconBox, IconCash, IconTag, IconTruck } from "@/components/pos/icons";
import { requireModule } from "@/lib/pos/access";
import { currentBusinessDay, moneyFormatter } from "@/lib/pos/counter";
import { listProducts } from "@/lib/pos/items";
import { getShopSettings } from "@/lib/pos/shop";
import { foldName } from "@/lib/pos/supplier";
import { getSupplier, listSuppliers } from "@/lib/pos/suppliers";
import { balanceState, type SupplierBalance } from "@/lib/pos/ledger";
import { getSupplierStatement, listSupplierBalances, listSupplierPayments } from "@/lib/pos/ledgers";
import type { GoodsReceipt, PurchaseOrder } from "@/lib/pos/purchase";
import {
  listGoodsReceipts,
  listOpenOrders,
  listPurchaseOrders,
  purchaseTotals,
} from "@/lib/pos/purchases";
import { OrdersPanel } from "./orders-panel";
import { PaymentsPanel } from "./payments-panel";
import { ReceiptsPanel } from "./receipts-panel";
import { SupplierRecord } from "./supplier-record";
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
 * did this actually cost me, carriage and all. `?tab=payments` is asked with a
 * bank statement in the other hand: what went out this month. `?tab=suppliers`
 * is asked when the shelf is empty on a Friday: who do I ring — and
 * `&supplier=<id>` is one distributor's account, the way `?customer=<id>` is
 * one person's record.
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
  { id: "payments", label: "Payments", icon: IconCash },
  { id: "suppliers", label: "Suppliers", icon: IconTag },
] as const;

type TabId = (typeof TABS)[number]["id"];

const isTab = (value: unknown): value is TabId =>
  TABS.some((tab) => tab.id === value);

export default async function PurchasingPage({
  searchParams,
}: PageProps<"/app/purchasing">) {
  const session = await requireModule("purchasing");

  const params = await searchParams;
  const tab: TabId = isTab(params.tab) ? params.tab : "orders";
  const asked = typeof params.supplier === "string" ? params.supplier : null;

  if (!session.tenantId) return <NotAttached />;
  const tenantId = session.tenantId;

  // One distributor's account is its own screen behind the same route, the way
  // `?customer=<id>` is on the customer list. It needs none of the lists below,
  // so it returns before they are read.
  if (asked) return <Account tenantId={tenantId} supplierId={asked} />;

  const [suppliers, orders, receipts, settings] = await Promise.all([
    listSuppliers(tenantId),
    listPurchaseOrders(tenantId),
    listGoodsReceipts(tenantId),
    getShopSettings(tenantId),
  ]);

  const money = moneyFormatter(settings);
  const today = currentBusinessDay(settings);

  // One call for every supplier's balance, grouped in Postgres. It feeds the
  // Suppliers column, the payment sheet's picker and the tile above them — and
  // it is one read rather than three, so those three cannot disagree.
  const balances = await listSupplierBalances(
    tenantId,
    suppliers.map((supplier) => ({
      id: supplier.id,
      opening: supplier.opening,
      openingOn: supplier.openingOn,
    })),
  );

  const payments = tab === "payments" ? await listSupplierPayments(tenantId) : [];

  // The catalog feeds both sheets' line search, and the open orders feed the
  // delivery sheet's picker. Read only for the tabs that draw them: the
  // suppliers tab has no line editor on it, and the item list is the single
  // biggest read on this page.
  const products =
    tab === "orders" || tab === "deliveries" ? await listProducts(tenantId) : [];

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

      <BuyingStats
        orders={orders}
        receipts={receipts}
        balances={balances}
        money={money}
      />

      {/* The count rides in the tab so the switcher answers "is there anything
          in there" without a visit — the same call the item list makes. */}
      <nav className="pos-tabs" aria-label="Buying sections">
        {TABS.map((item) => {
          const count =
            item.id === "orders"
              ? orders.length
              : item.id === "deliveries"
                ? receipts.length
                : item.id === "payments"
                  ? // Not read unless the tab is open, so the count would be a
                    // nought that lies. Left off instead: an absent count says
                    // "go and look", a wrong one says "nothing in here".
                    undefined
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
              {count === undefined ? null : (
                <span className="pos-tab-count">{count.toLocaleString("en-PK")}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {tab === "orders" ? (
        <OrdersPanel
          orders={orders}
          suppliers={pickable}
          products={products}
          settings={settings}
        />
      ) : tab === "deliveries" ? (
        <ReceiptsPanel
          receipts={receipts}
          suppliers={pickable}
          products={products}
          openOrders={openOrders}
          settings={settings}
        />
      ) : tab === "payments" ? (
        <PaymentsPanel
          payments={payments}
          suppliers={pickable}
          balances={balances}
          today={today}
          settings={settings}
        />
      ) : (
        <SuppliersPanel suppliers={suppliers} balances={balances} settings={settings} />
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
  balances,
  money,
}: {
  orders: PurchaseOrder[];
  receipts: GoodsReceipt[];
  balances: Map<string, SupplierBalance>;
  money: (value: number) => string;
}) {
  const totals = purchaseTotals(receipts);

  const awaiting = orders.filter(
    (order) => order.status === "placed" && order.receivedLines < order.lines,
  );

  const onOrder = awaiting.reduce((total, order) => total + order.total, 0);

  const debits = [...balances.values()].filter(
    (balance) => balanceState(balance.balance) === "owed",
  );

  const owed = debits.reduce((total, balance) => total + balance.balance, 0);
  const inDebit = debits.length;

  const tiles = [
    {
      label: "Orders still open",
      value: awaiting.length.toLocaleString("en-PK"),
      note:
        awaiting.length === 0 ? "Nothing on its way" : `${money(onOrder)} of goods`,
    },
    {
      // The one figure an owner opens this screen for, and the reason `0029`
      // exists. Only the accounts actually in debit are added up: a shop in
      // advance with one distributor is not owed money by them, and netting it
      // off would understate what has to be found on Friday.
      label: "Owed to suppliers",
      value: money(owed),
      note:
        inDebit === 0
          ? "Every account is square"
          : `Across ${inDebit} ${inDebit === 1 ? "supplier" : "suppliers"}`,
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

/**
 * One supplier's account.
 *
 * `notFound()` for an id that is not this shop's, rather than a message — the
 * same call `requireModule` and the customer record make, and for the same
 * reason: a screen that says "that supplier is not yours" has confirmed the
 * supplier exists.
 *
 * The balance is read through the same `listSupplierBalances` the list uses, so
 * the figure on this screen and the figure in that column come from one place
 * and cannot disagree.
 */
async function Account({
  tenantId,
  supplierId,
}: {
  tenantId: string;
  supplierId: string;
}) {
  const [supplier, settings] = await Promise.all([
    getSupplier(tenantId, supplierId),
    getShopSettings(tenantId),
  ]);

  if (!supplier) notFound();

  const [balances, statement, everyone] = await Promise.all([
    listSupplierBalances(tenantId, [
      { id: supplier.id, opening: supplier.opening, openingOn: supplier.openingOn },
    ]),
    getSupplierStatement(tenantId, supplier.id, {
      amount: supplier.opening,
      on: supplier.openingOn,
    }),
    // Only so the edit sheet can warn on a name that clashes with somebody
    // else's. It is the same courtesy the list gives; the unique index is still
    // the control.
    listSuppliers(tenantId),
  ]);

  const balance = balances.get(supplier.id) ?? {
    supplierId: supplier.id,
    opening: supplier.opening,
    openingOn: supplier.openingOn,
    invoiced: 0,
    paid: 0,
    balance: supplier.opening,
    deliveries: 0,
    payments: 0,
    lastInvoicedOn: null,
    lastPaidOn: null,
  };

  return (
    <SupplierRecord
      supplier={supplier}
      balance={balance}
      statement={statement}
      today={currentBusinessDay(settings)}
      settings={settings}
      taken={everyone.map((one) => foldName(one.name))}
    />
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
