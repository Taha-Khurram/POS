import type { Metadata } from "next";
import Link from "next/link";

import {
  IconAlert,
  IconInventory,
  IconTag,
  IconUpload,
} from "@/components/pos/icons";
import { requireModule } from "@/lib/pos/access";
import { rupees } from "@/lib/format";
import { stockState, type Product } from "@/lib/pos/catalog";
import { listProducts } from "@/lib/pos/items";
import { CatalogPanel } from "./catalog-panel";
import { CategoriesPanel } from "./categories-panel";
import { ImportPanel } from "./import-panel";

export const metadata: Metadata = {
  title: "Products & stock",
  description: "Your item list, cost and retail prices, and what is running low.",
};

const TABS = [
  { id: "items", label: "Items", icon: IconInventory },
  { id: "tree", label: "Categories", icon: IconTag },
  { id: "import", label: "Bulk import", icon: IconUpload },
] as const;

type TabId = (typeof TABS)[number]["id"];

const isTab = (value: unknown): value is TabId =>
  TABS.some((tab) => tab.id === value);

/**
 * Catalog and inventory setup.
 *
 * The section lives in the URL, the same way Settings does: the page stays a
 * server component, the item table is HTML on first paint, and the tab someone
 * is looking at survives a reload on a tablet that lost the network mid-tap.
 *
 * The rows are the shop's own `items`, read through its JWT. Which item is open
 * in the editor is *not* in the URL, unlike Settings' counter and Staff's
 * person: the sheet is a modal over a list somebody has usually filtered and
 * searched their way to, and a navigation per row would throw that away between
 * every correction.
 */
export default async function InventoryPage({
  searchParams,
}: PageProps<"/app/inventory">) {
  const session = await requireModule("inventory");

  const raw = (await searchParams).tab;
  const tab: TabId = isTab(raw) ? raw : "items";

  if (!session.tenantId) return <NotAttached />;

  const items = await listProducts(session.tenantId);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-[1.5rem] leading-tight font-bold">
          Products &amp; stock
        </h1>
        <p className="mt-1 text-[0.8125rem] text-graphite-500">
          Everything the register can ring up, and what it costs you.
        </p>
      </header>

      <nav className="pos-tabs" aria-label="Catalog sections">
        {TABS.map((item) => (
          <Link
            key={item.id}
            href={`/app/inventory?tab=${item.id}`}
            className="pos-tab"
            aria-current={item.id === tab ? "page" : undefined}
            scroll={false}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        ))}
      </nav>

      {tab === "items" ? (
        <>
          <CatalogStats items={items} />
          <CatalogPanel items={items} nextSerial={nextSerial(items)} />
        </>
      ) : tab === "tree" ? (
        <CategoriesPanel items={items} />
      ) : (
        <ImportPanel
          // The codes the shop already carries, so the preview can say row 214
          // is a bottle you already stock before anything is sent. The action
          // checks again on its own side — this list is stale the moment
          // somebody else adds an item.
          knownBarcodes={
            items.map((item) => item.barcode).filter(Boolean) as string[]
          }
          knownSkus={items.map((item) => item.sku).filter(Boolean)}
        />
      )}

      <p className="px-1 pb-2 text-[0.75rem] text-graphite-500">
        Goods receipt, wastage, branch transfers and the stock-count session are
        still to come — stock moves when a sale is rung up and when you correct
        it here, and nowhere else yet.
      </p>
    </div>
  );
}

/**
 * The serial the next in-store barcode is cut from.
 *
 * Read off the codes the shop already minted rather than off the number of
 * items, because deleting one would otherwise hand the next item a code that is
 * already on a shelf label. A shop that has never minted one starts at 1.
 *
 * It is a suggestion either way. The unique index on `(tenant_id, barcode)` is
 * what actually guarantees the code, and the action turns its refusal into a
 * sentence.
 */
function nextSerial(items: Product[]): number {
  const highest = items.reduce((top, item) => {
    const code = item.barcode;
    if (!code || !/^200\d{10}$/.test(code)) return top;

    // Digits 4–12 of the EAN-13: the 200 prefix and the check digit are not
    // part of the count.
    return Math.max(top, Number(code.slice(3, 12)));
  }, 0);

  return highest + 1;
}

/**
 * Four figures that answer what an owner opens this screen to ask: how big is
 * my list, how much money is sitting on the shelves, and what do I have to buy
 * today. Stock value is at cost, not at retail — retail is what it is worth if
 * every single unit sells, which is not a number anyone should plan against.
 */
function CatalogStats({ items }: { items: Product[] }) {
  const value = items.reduce((total, item) => total + item.cost * item.stock, 0);
  const low = items.filter((item) => stockState(item) === "low").length;
  const out = items.filter((item) => stockState(item) === "out").length;
  const uncoded = items.filter((item) => !item.barcode).length;

  const tiles = [
    {
      label: "Items in the list",
      value: items.length.toLocaleString("en-PK"),
      note:
        items.length === 0
          ? "Nothing in the list yet"
          : `${uncoded} without a manufacturer barcode`,
      alert: false,
    },
    {
      label: "Stock value at cost",
      value: rupees(value),
      note: "What is sitting on the shelves",
      alert: false,
    },
    {
      label: "Running low",
      value: String(low),
      note: "Below the alert you set per item",
      alert: low > 0,
    },
    {
      label: "Out of stock",
      value: String(out),
      note: "The register will still list them",
      alert: out > 0,
    },
  ];

  return (
    <section
      aria-label="Catalog at a glance"
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      {tiles.map((tile) => (
        <article key={tile.label} className="pos-card p-4">
          <h2 className="flex items-center gap-1.5 font-display text-[0.8125rem] leading-tight font-semibold text-graphite-500">
            {tile.label}
            {tile.alert ? (
              <IconAlert className="h-3.5 w-3.5 text-signal-warn" />
            ) : null}
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

/** Same words as the register's, Settings' and Staff's gate — it is one problem. */
function NotAttached() {
  return (
    <div className="pos-card mx-auto max-w-lg p-6">
      <h1 className="font-display text-[1.375rem] font-bold">
        Account not attached yet
      </h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-graphite-700">
        You are signed in, but this login is not linked to a shop, so there is no
        item list to show. Message us on the same WhatsApp number you arranged
        Flo on and we will attach it.
      </p>
    </div>
  );
}
