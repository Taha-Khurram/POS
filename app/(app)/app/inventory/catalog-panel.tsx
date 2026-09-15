"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import { DataTable, type Column } from "@/components/pos/data-table";
import {
  IconBarcode,
  IconPlus,
  IconSearch,
  IconTag,
  IconUpload,
} from "@/components/pos/icons";
import {
  DEPARTMENTS,
  marginOf,
  stockState,
  unitShort,
  type Product,
} from "@/lib/pos/catalog";
import { rupees } from "@/lib/format";
import { ProductSheet } from "./product-sheet";

/**
 * The item list.
 *
 * Client, and it is the one screen in the console where that is the right call:
 * a shopkeeper adding stock searches, corrects, searches again, ten times a
 * minute, and a round trip per keystroke over shop 3G would make the search box
 * feel broken. Five thousand rows filter in a frame; when the real table
 * arrives this narrows to a server query with the same box in front of it.
 *
 * Search deliberately matches the barcode too — the fastest way to find out
 * whether an item is already in the list is to scan it, and a cashier standing
 * at the counter will do exactly that.
 */

const STOCK_FILTERS = [
  { id: "all", label: "Everything" },
  { id: "low", label: "Running low" },
  { id: "out", label: "Out of stock" },
  { id: "nocode", label: "No barcode" },
] as const;

type StockFilter = (typeof STOCK_FILTERS)[number]["id"];

const COLUMNS: Column<Product>[] = [
  {
    key: "item",
    header: "Item",
    cell: (item) => (
      <span className="flex items-center gap-2.5">
        <span
          className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-orchid-50 text-orchid-700"
          aria-hidden
        >
          {item.barcode ? (
            <IconBarcode className="h-4 w-4" />
          ) : (
            <IconTag className="h-4 w-4" />
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium text-graphite-900">
            {item.name}
          </span>
          <span className="block truncate font-mono text-[0.6875rem] text-graphite-500">
            {item.sku}
            {item.variants ? ` · ${item.variants} variants` : ""}
          </span>
        </span>
      </span>
    ),
  },
  {
    key: "urdu",
    header: "Urdu",
    hideBelow: "lg",
    cell: (item) => (
      <span dir="rtl" className="text-graphite-700">
        {item.urdu}
      </span>
    ),
  },
  {
    key: "category",
    header: "Category",
    hideBelow: "md",
    cell: (item) => (
      <span className="text-graphite-700">
        <span className="block text-[0.75rem] text-graphite-500">
          {item.department}
        </span>
        {item.category}
      </span>
    ),
  },
  {
    key: "cost",
    header: "Cost",
    align: "end",
    hideBelow: "sm",
    cell: (item) => rupees(item.cost),
  },
  {
    key: "price",
    header: "Price",
    align: "end",
    cell: (item) => (
      <>
        {rupees(item.price)}
        <span className="block text-[0.6875rem] font-normal text-graphite-500">
          per {unitShort(item.unit)}
        </span>
      </>
    ),
  },
  {
    key: "margin",
    header: "Margin",
    align: "end",
    hideBelow: "md",
    cell: (item) => {
      const money = marginOf(item.cost, item.price);
      if (!money) return <span className="text-graphite-500">—</span>;

      return (
        <>
          {money.marginPct.toFixed(1)}%
          <span className="block text-[0.6875rem] font-normal text-graphite-500">
            {rupees(money.profit)} a {unitShort(item.unit)}
          </span>
        </>
      );
    },
  },
  {
    key: "stock",
    header: "In stock",
    align: "end",
    cell: (item) => {
      const state = stockState(item);

      return (
        <span className="inline-flex flex-col items-end gap-1">
          <span>
            {item.stock.toLocaleString("en-PK")} {unitShort(item.unit)}
          </span>
          {state === "out" ? (
            <span className="pos-badge pos-badge-bad">Out</span>
          ) : state === "low" ? (
            <span className="pos-badge pos-badge-warn">Low</span>
          ) : (
            <span className="text-[0.6875rem] font-normal text-graphite-500">
              alerts at {item.lowAt}
            </span>
          )}
        </span>
      );
    },
  },
];

export function CatalogPanel({ items }: { items: Product[] }) {
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("all");
  const [filter, setFilter] = useState<StockFilter>("all");
  const [adding, setAdding] = useState(false);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return items.filter((item) => {
      if (department !== "all" && item.department !== department) return false;

      const state = stockState(item);
      if (filter === "low" && state !== "low") return false;
      if (filter === "out" && state !== "out") return false;
      if (filter === "nocode" && item.barcode) return false;

      if (!needle) return true;

      // Urdu is matched as typed rather than lowercased — the script has no
      // case, and `toLowerCase` on it is a no-op that only looks reassuring.
      return (
        item.name.toLowerCase().includes(needle) ||
        item.sku.toLowerCase().includes(needle) ||
        item.supplier.toLowerCase().includes(needle) ||
        item.category.toLowerCase().includes(needle) ||
        (item.barcode?.includes(needle) ?? false) ||
        item.urdu.includes(query.trim())
      );
    });
  }, [items, query, department, filter]);

  return (
    <>
      <ChartCard
        title="Items"
        caption={
          rows.length === items.length
            ? `${items.length} in the list`
            : `${rows.length} of ${items.length}`
        }
        bleed
        actions={
          <>
            <Link href="/app/inventory?tab=import" className="pos-btn pos-btn-soft">
              <IconUpload className="h-4 w-4" />
              <span className="hidden sm:inline">Import</span> CSV
            </Link>
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="pos-btn pos-btn-primary"
            >
              <IconPlus className="h-4 w-4" />
              Add product
            </button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
          <label className="relative min-w-[13rem] flex-1">
            <span className="sr-only">Search the catalog</span>
            <IconSearch className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-graphite-500" />
            <input
              className="pos-field pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, Urdu, SKU — or scan a barcode"
              autoComplete="off"
            />
          </label>

          <select
            className="pos-field w-auto"
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
            aria-label="Department"
          >
            <option value="all">All departments</option>
            {DEPARTMENTS.map((item) => (
              <option key={item.id} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>

          <div className="flex flex-wrap gap-1.5">
            {STOCK_FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                aria-pressed={filter === item.id}
                className={`pos-btn pos-btn-sm ${
                  filter === item.id ? "pos-btn-primary" : "pos-btn-soft"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <DataTable
          columns={COLUMNS}
          rows={rows}
          rowKey={(item) => item.id}
          empty={
            query
              ? `Nothing matches “${query.trim()}”. Check the spelling, or add it as a new product.`
              : "No items under this filter."
          }
        />
      </ChartCard>

      {adding ? <ProductSheet onClose={() => setAdding(false)} /> : null}
    </>
  );
}
