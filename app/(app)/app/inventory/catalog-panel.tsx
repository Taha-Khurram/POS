"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import { DataTable, type Column } from "@/components/pos/data-table";
import {
  IconBarcode,
  IconCheck,
  IconChevron,
  IconClose,
  IconFilter,
  IconPlus,
  IconSearch,
  IconTag,
  IconUpload,
} from "@/components/pos/icons";
import { Select, type SelectOption } from "@/components/pos/select-field";
import { useDismiss } from "@/components/pos/use-dismiss";
import {
  DEPARTMENTS,
  marginOf,
  matchesProduct,
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
 * feel broken. Five thousand rows filter in a frame; when the list outgrows
 * that this narrows to a server query with the same box in front of it.
 *
 * Search deliberately matches the barcode too — the fastest way to find out
 * whether an item is already in the list is to scan it, and a cashier standing
 * at the counter will do exactly that. The matching itself is
 * `matchesProduct`, shared with the till, so an item the owner can find is an
 * item the cashier can find.
 */

/**
 * The states worth narrowing to, each with the test that decides it.
 *
 * The predicate lives beside the label rather than in a switch inside the
 * filter, so counting how many items are in a state and showing only that state
 * cannot drift apart — the menu says "Running low 7" and pressing it gives
 * seven rows, by construction.
 */
const STOCK_FILTERS = [
  {
    id: "all",
    label: "Everything",
    note: "No stock filter",
    match: () => true,
  },
  {
    id: "low",
    label: "Running low",
    note: "Under the alert you set per item",
    match: (item: Product) => stockState(item) === "low",
  },
  {
    id: "out",
    label: "Out of stock",
    note: "The register still lists them",
    match: (item: Product) => stockState(item) === "out",
  },
  {
    id: "nocode",
    label: "No barcode",
    note: "Nothing to scan at the till",
    match: (item: Product) => !item.barcode,
  },
  {
    id: "hidden",
    label: "Hidden",
    note: "Switched off — the cashier cannot find them",
    match: (item: Product) => !item.isActive,
  },
] as const;

type StockFilter = (typeof STOCK_FILTERS)[number]["id"];

const stockFilter = (id: StockFilter) =>
  STOCK_FILTERS.find((entry) => entry.id === id) ?? STOCK_FILTERS[0];

/**
 * A function rather than a const, because the name cell is the control that
 * opens the editor. The button is the name itself: a row of nine columns with
 * one small pencil at the end of it is a target nobody hits on a tablet.
 */
const columnsFor = (onEdit: (item: Product) => void): Column<Product>[] => [
  {
    key: "item",
    header: "Item",
    cell: (item) => (
      <button
        type="button"
        onClick={() => onEdit(item)}
        className="flex w-full items-center gap-2.5 text-left"
      >
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
          <span className="block truncate font-medium text-graphite-900 underline-offset-2 hover:underline">
            {item.name}
            {item.isActive ? null : (
              <span className="pos-badge pos-badge-warn ml-2 align-middle">
                Hidden
              </span>
            )}
          </span>
          <span className="block truncate font-mono text-[0.6875rem] text-graphite-500">
            {item.sku || item.barcode || "no code"}
            {item.variants ? ` · ${item.variants} variants` : ""}
          </span>
        </span>
      </button>
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
  {
    key: "open",
    header: "",
    align: "end",
    cell: (item) => (
      <button
        type="button"
        onClick={() => onEdit(item)}
        className="pos-icon-btn"
        aria-label={`Edit ${item.name}`}
      >
        <IconChevron className="h-4 w-4 -rotate-90" />
      </button>
    ),
  },
];

export function CatalogPanel({
  items,
  nextSerial,
}: {
  items: Product[];
  /** What the next in-store barcode and suggested SKU are cut from. */
  nextSerial: number;
}) {
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("all");
  const [filter, setFilter] = useState<StockFilter>("all");

  // Null is closed, a product is the editor, and `"new"` is the empty sheet.
  // One piece of state rather than two, so the two cannot both be true.
  const [editing, setEditing] = useState<Product | "new" | null>(null);

  // The row the sheet is open on, re-read from the list the server just sent.
  // Without this the sheet would go on showing the values it was opened with
  // after a save, and the owner would correct a price, watch the table update
  // behind the sheet, and see the old one still in the box in front of them.
  //
  // It falls back to the row as it was opened, which is the moment after a
  // delete: the list comes back without it a frame before the sheet closes
  // itself, and without the fallback that frame would redraw the editor as an
  // empty Add-a-product form.
  const open =
    editing && editing !== "new"
      ? (items.find((item) => item.id === editing.id) ?? editing)
      : null;

  // The department cut on its own. The stock menu counts inside it, so
  // "Running low 3" means three in Grocery when Grocery is the department, and
  // not three in the shop — a count that changed the moment you pressed it
  // would be worse than no count.
  const inDepartment = useMemo(
    () =>
      department === "all"
        ? items
        : items.filter((item) => item.department === department),
    [items, department],
  );

  const rows = useMemo(
    () =>
      inDepartment.filter(
        (item) => stockFilter(filter).match(item) && matchesProduct(item, query),
      ),
    [inDepartment, query, filter],
  );

  const columns = useMemo(() => columnsFor(setEditing), []);

  const departmentOptions: SelectOption[] = useMemo(() => {
    const tally = items.reduce<Record<string, number>>((counts, item) => {
      counts[item.department] = (counts[item.department] ?? 0) + 1;
      return counts;
    }, {});

    return [
      {
        id: "all",
        label: "All departments",
        meta: items.length.toLocaleString("en-PK"),
      },
      ...DEPARTMENTS.map((entry) => ({
        id: entry.name,
        label: entry.name,
        meta: (tally[entry.name] ?? 0).toLocaleString("en-PK"),
      })),
    ];
  }, [items]);

  const stockOptions: SelectOption[] = useMemo(
    () =>
      STOCK_FILTERS.map((entry) => ({
        id: entry.id,
        label: entry.label,
        description: entry.note,
        meta: inDepartment.filter(entry.match).length.toLocaleString("en-PK"),
      })),
    [inDepartment],
  );

  // What is actually on, as chips under the bar. Search is not one of them —
  // it has a visible box with the words still in it, and a chip repeating them
  // would be the same filter offered two ways.
  const active = [
    department === "all"
      ? null
      : { key: "Department", label: department, clear: () => setDepartment("all") },
    filter === "all"
      ? null
      : {
          key: "Stock",
          label: stockFilter(filter).label,
          clear: () => setFilter("all"),
        },
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[];

  const clearAll = () => {
    setDepartment("all");
    setFilter("all");
  };

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
              onClick={() => setEditing("new")}
              className="pos-btn pos-btn-primary"
            >
              <IconPlus className="h-4 w-4" />
              Add product
            </button>
          </>
        }
      >
        {/* One line at rest: a search box and a funnel. The department dropdown
            and the five state buttons that used to sit here wrapped onto a
            second row on a 10-inch tablet and pushed the first item under the
            fold — six permanent controls for a screen whose job is the table. */}
        <div className="flex items-center gap-2 px-4 pb-3">
          {/* A div and not a label, because of the × inside it: a click on a
              button nested in a label is forwarded to the labelled control as
              well, and the box would take the focus back off the button that
              had just been pressed. */}
          <div className="relative min-w-0 flex-1">
            <IconSearch className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-graphite-500" />
            <input
              className="pos-field pl-9 pr-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, Urdu, SKU — or scan a barcode"
              aria-label="Search the catalog"
              autoComplete="off"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="pos-filter-tag-x absolute top-1/2 right-2.5 -translate-y-1/2"
                aria-label="Clear the search"
              >
                <IconClose className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>

          <FilterMenu
            count={active.length}
            departmentOptions={departmentOptions}
            stockOptions={stockOptions}
            department={department}
            filter={filter}
            onDepartment={setDepartment}
            onFilter={setFilter}
            onClear={clearAll}
          />
        </div>

        {active.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
            {active.map((chip) => (
              <span key={chip.key} className="pos-filter-tag">
                <span className="pos-filter-tag-key">{chip.key}</span>
                {chip.label}
                <button
                  type="button"
                  onClick={chip.clear}
                  className="pos-filter-tag-x"
                  aria-label={`Remove the ${chip.key.toLowerCase()} filter`}
                >
                  <IconClose className="h-3 w-3" />
                </button>
              </span>
            ))}

            <button
              type="button"
              onClick={clearAll}
              className="pos-btn pos-btn-quiet pos-btn-sm"
            >
              Clear all
            </button>
          </div>
        ) : null}

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(item) => item.id}
          empty={
            items.length === 0
              ? "Nothing in the list yet. Add your first product, or bring the sheet you already keep in through Bulk import."
              : query
                ? `Nothing matches “${query.trim()}”. Check the spelling, or add it as a new product.`
                : "No items under this filter."
          }
        />
      </ChartCard>

      {editing ? (
        <ProductSheet
          item={open}
          nextSerial={nextSerial}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

/**
 * Every way of narrowing the list, behind one button.
 *
 * A popover rather than a row of controls, because on this screen the table is
 * the work and a filter is something you do to it twice an afternoon. The
 * button carries the number of filters that are on, so a shopkeeper who comes
 * back to a short list has the reason in front of them rather than having to
 * open the menu to find it.
 *
 * It closes on Escape and on a press outside, like every other popover in the
 * console. It deliberately does *not* close on a choice: picking a department
 * and then a stock state is one thought, and a menu that shut between them
 * would have to be opened twice.
 */
function FilterMenu({
  count,
  departmentOptions,
  stockOptions,
  department,
  filter,
  onDepartment,
  onFilter,
  onClear,
}: {
  /** How many filters are on — nought hides the badge entirely. */
  count: number;
  departmentOptions: SelectOption[];
  stockOptions: SelectOption[];
  department: string;
  filter: StockFilter;
  onDepartment: (next: string) => void;
  onFilter: (next: StockFilter) => void;
  onClear: () => void;
}) {
  const id = useId();
  const { ref, open, setOpen } = useDismiss<HTMLDivElement>();

  return (
    <div className="relative flex-none" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`pos-btn ${count > 0 ? "pos-btn-primary" : "pos-btn-soft"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <IconFilter className="h-4 w-4" />
        <span className="hidden sm:inline">Filter</span>
        {count > 0 ? <span className="pos-btn-count">{count}</span> : null}
      </button>

      {open ? (
        <div
          className="pos-menu pos-menu-panel"
          role="dialog"
          aria-label="Filter the item list"
        >
          <div className="pos-menu-head">
            <span className="pos-menu-title">Narrow the list</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="pos-filter-tag-x"
              aria-label="Close"
            >
              <IconClose className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <span className="pos-label" id={`${id}-department`}>
                Department
              </span>
              <Select
                value={department}
                onChange={onDepartment}
                options={departmentOptions}
                labelledBy={`${id}-department`}
              />
            </div>

            <div>
              <span className="pos-label" id={`${id}-stock`}>
                Stock and status
              </span>
              <Select
                value={filter}
                onChange={(next) => onFilter(next as StockFilter)}
                options={stockOptions}
                labelledBy={`${id}-stock`}
              />
            </div>
          </div>

          <div className="pos-menu-foot">
            <button
              type="button"
              onClick={onClear}
              disabled={count === 0}
              className="pos-btn pos-btn-quiet pos-btn-sm disabled:opacity-45"
            >
              Clear all
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="pos-btn pos-btn-primary pos-btn-sm"
            >
              <IconCheck className="h-3.5 w-3.5" />
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
