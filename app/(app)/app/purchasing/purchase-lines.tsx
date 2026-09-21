"use client";

import { useMemo, useRef, useState } from "react";

import {
  IconClose,
  IconPlus,
  IconSearch,
  IconTrash,
} from "@/components/pos/icons";
import { matchesProduct, unitShort, type Product } from "@/lib/pos/catalog";
import { lineTotalOf, QUANTITY_MAX, COST_MAX } from "@/lib/pos/purchase";

/**
 * The line builder, shared by the order sheet and the delivery sheet.
 *
 * One component rather than two, because an order line and a delivery line are
 * the same four fields — item, unit, how many, what one costs — and the two
 * screens that disagreed about which of them a shopkeeper may edit would be two
 * screens the same shopkeeper uses in the same ten minutes.
 *
 * **The search is the catalog's own `matchesProduct`**, shared with the till
 * and the item list, so a product the cashier can find is a product the person
 * receiving the delivery can find. Scanning works for the same reason it works
 * everywhere else: the fastest way to say which item a carton is, is to scan
 * one off the top of it.
 *
 * A line may also be typed against *nothing* in the catalog. That is
 * deliberate and it is the common case on a first order: a shop orders
 * something it does not stock yet, and refusing the line until somebody has
 * created the item is how the order gets written on paper instead. Such a line
 * carries its name and no `itemId`, records perfectly well, and moves no stock
 * when it arrives — which is honest, because there is no shelf for it.
 */

export type DraftLine = {
  key: string;
  itemId: string | null;
  /** The order line this satisfies. Only ever set by the delivery sheet, when
   *  it is prefilled from an order. */
  orderLineId: string | null;
  name: string;
  unit: string;
  quantity: number;
  unitCost: number;
  /** What is still owed on the order line behind this one, when there is one.
   *  Shown beside the quantity so somebody counting boxes off a van can see
   *  what was expected without opening the order. */
  expected?: number;
  /** Whether this item is counted by batch. Off the catalog row, so the line
   *  only asks for a date where a date exists to be read. */
  tracksBatches?: boolean;
  /** Off the carton, captured here because this is the one moment somebody is
   *  holding it. Only ever filled for a batch-tracked item. */
  batchNo?: string;
  expiresOn?: string;
};

let serial = 0;
const nextKey = () => `line-${(serial += 1)}`;

/** A line made from a catalog row, priced at what the shop last paid. */
export const lineFromProduct = (product: Product): DraftLine => ({
  key: nextKey(),
  itemId: product.id,
  orderLineId: null,
  name: product.name,
  unit: product.unit,
  tracksBatches: product.tracksBatches,
  batchNo: "",
  expiresOn: "",
  quantity: 1,
  // The last cost, as a starting point rather than a claim. The whole reason
  // this screen exists is that the number is usually out of date — but it is a
  // far better guess than zero, and a shopkeeper correcting 148 to 161 is one
  // keystroke where typing 161 from blank is four.
  unitCost: product.cost,
});

/** A line for something the shop does not stock yet. */
export const lineFromName = (name: string): DraftLine => ({
  key: nextKey(),
  itemId: null,
  orderLineId: null,
  name: name.trim(),
  unit: "piece",
  quantity: 1,
  unitCost: 0,
});

export { nextKey as newLineKey };

export function PurchaseLines({
  lines,
  products,
  onChange,
  /** "What one costs" reads differently on an order and on an invoice. */
  costLabel = "Cost each",
  /** The delivery sheet asks for the batch and the date; the order sheet does
   *  not. An order is an intention and nobody knows which carton will come. */
  askBatch = false,
  disabled = false,
}: {
  lines: DraftLine[];
  products: Product[];
  onChange: (next: DraftLine[]) => void;
  costLabel?: string;
  askBatch?: boolean;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Ten, because this is a dropdown under a search box on a tablet and an
  // eleventh row is one the thumb has to scroll to. The item list is the place
  // to browse four hundred items; this is the place to find one.
  const matches = useMemo(() => {
    const needle = query.trim();
    if (!needle) return [];

    return products
      .filter((product) => product.isActive && matchesProduct(product, needle))
      .slice(0, 10);
  }, [products, query]);

  const add = (line: DraftLine) => {
    // Already on the delivery? Step it rather than add a second row. Somebody
    // scanning a pallet scans the same carton code twelve times, and twelve
    // rows of one is a document nobody can check against the van.
    const at = lines.findIndex(
      (entry) => entry.itemId && entry.itemId === line.itemId,
    );

    if (at >= 0) {
      const next = [...lines];
      next[at] = { ...next[at], quantity: next[at].quantity + 1 };
      onChange(next);
    } else {
      onChange([...lines, line]);
    }

    setQuery("");
    searchRef.current?.focus();
  };

  const update = (key: string, patch: Partial<DraftLine>) =>
    onChange(
      lines.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );

  const remove = (key: string) =>
    onChange(lines.filter((line) => line.key !== key));

  const subtotal = lines.reduce((total, line) => total + lineTotalOf(line), 0);

  return (
    <div className="space-y-3">
      {/* ---------------- Finding something to put on ---------------- */}
      <div className="relative">
        <IconSearch className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-graphite-500" />
        <input
          ref={searchRef}
          className="pos-field pr-9 pl-9"
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // Enter takes the first match, which is what a barcode scanner
            // sends after the digits. Without it every scan needs a tap.
            if (event.key === "Enter") {
              event.preventDefault();
              if (matches[0]) add(lineFromProduct(matches[0]));
            }
            if (event.key === "Escape") setQuery("");
          }}
          placeholder="Search the catalog, or scan a carton"
          aria-label="Find an item to add"
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

        {query.trim() ? (
          <div className="pos-menu pos-menu-panel absolute top-full right-0 left-0 z-20 mt-1 max-h-72 overflow-y-auto">
            {matches.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => add(lineFromProduct(product))}
                className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-orchid-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.875rem] font-medium text-graphite-900">
                    {product.name}
                  </span>
                  <span className="block truncate text-[0.6875rem] text-graphite-500">
                    {product.sku || "no SKU"} · {product.stock.toLocaleString("en-PK")}{" "}
                    {unitShort(product.unit)} on the shelf
                  </span>
                </span>
                <span className="flex-none text-[0.75rem] tabular-nums text-graphite-500">
                  last {product.cost.toLocaleString("en-PK")}
                </span>
              </button>
            ))}

            {/* Nothing in the catalog matches — so offer the line anyway. A
                shop ordering something new should not have to go and create the
                item first, and the delivery that brings it in is exactly when
                somebody knows what it is called. */}
            <button
              type="button"
              onClick={() => add(lineFromName(query))}
              className="mt-1 flex w-full items-center gap-2 rounded-xl border border-dashed border-orchid-200 px-2.5 py-2 text-left hover:bg-orchid-50"
            >
              <IconPlus className="h-4 w-4 flex-none text-orchid-700" />
              <span className="min-w-0">
                <span className="block truncate text-[0.875rem] font-medium text-graphite-900">
                  Add “{query.trim()}” as a line
                </span>
                <span className="block text-[0.6875rem] text-graphite-500">
                  {matches.length === 0
                    ? "Nothing in your list matches."
                    : "Not one of these — something you do not stock yet."}{" "}
                  It moves no stock.
                </span>
              </span>
            </button>
          </div>
        ) : null}
      </div>

      {/* ---------------- What is on it ---------------- */}
      {lines.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-orchid-200 px-4 py-6 text-center text-[0.8125rem] text-graphite-500">
          Nothing on it yet. Search above, or scan something off the top of the
          delivery.
        </p>
      ) : (
        <ul className="space-y-2">
          {lines.map((line) => {
            const total = lineTotalOf(line);
            const over =
              line.expected !== undefined && line.quantity > line.expected;

            return (
              <li
                key={line.key}
                className="rounded-2xl border border-orchid-100 p-3"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.875rem] font-medium text-graphite-900">
                      {line.name}
                      {line.itemId ? null : (
                        <span className="pos-badge pos-badge-warn ml-2 align-middle">
                          Not in your list
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[0.6875rem] text-graphite-500">
                      per {unitShort(line.unit as Product["unit"])}
                      {line.expected !== undefined
                        ? ` · ${line.expected.toLocaleString("en-PK")} still expected on the order`
                        : ""}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => remove(line.key)}
                    disabled={disabled}
                    className="pos-icon-btn flex-none"
                    aria-label={`Take ${line.name} off`}
                  >
                    <IconTrash className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-2.5 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                  <label className="block">
                    <span className="pos-label">How many</span>
                    <input
                      className="pos-field text-right tabular-nums"
                      inputMode="decimal"
                      disabled={disabled}
                      value={line.quantity === 0 ? "" : String(line.quantity)}
                      onChange={(event) =>
                        update(line.key, {
                          quantity: clamp(event.target.value, QUANTITY_MAX),
                        })
                      }
                      aria-label={`How many ${line.name}`}
                    />
                  </label>

                  <label className="block">
                    <span className="pos-label">{costLabel}</span>
                    <input
                      className="pos-field text-right tabular-nums"
                      inputMode="decimal"
                      disabled={disabled}
                      value={line.unitCost === 0 ? "" : String(line.unitCost)}
                      onChange={(event) =>
                        update(line.key, {
                          unitCost: clamp(event.target.value, COST_MAX),
                        })
                      }
                      aria-label={`What one ${line.name} costs`}
                    />
                  </label>

                  <p className="pb-2.5 text-right text-[0.9375rem] font-semibold tabular-nums text-graphite-900">
                    {total.toLocaleString("en-PK", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </p>
                </div>

                {/* ---------------- The date off the carton ----------------
                    Only for a tracked item, and only while receiving. This is
                    the one moment the date is readable — every later screen is
                    somebody typing it from memory.

                    Neither field is required. The person at the door has a
                    queue behind them, and a delivery recorded without a batch
                    is worth more than a delivery not recorded: it lands in the
                    item's plain stock and the Products screen says so. */}
                {askBatch && line.tracksBatches ? (
                  <div className="mt-2 grid grid-cols-2 gap-2 border-t border-orchid-100 pt-2">
                    <label className="block">
                      <span className="pos-label">Batch no.</span>
                      <input
                        className="pos-field font-mono"
                        value={line.batchNo ?? ""}
                        disabled={disabled}
                        maxLength={60}
                        placeholder="Off the carton"
                        onChange={(event) =>
                          update(line.key, { batchNo: event.target.value })
                        }
                        aria-label={`Batch number for ${line.name}`}
                      />
                    </label>

                    <label className="block">
                      <span className="pos-label">Expires</span>
                      <input
                        type="date"
                        className="pos-field"
                        value={line.expiresOn ?? ""}
                        disabled={disabled}
                        onChange={(event) =>
                          update(line.key, { expiresOn: event.target.value })
                        }
                        aria-label={`Expiry date for ${line.name}`}
                      />
                    </label>
                  </div>
                ) : null}

                {/* Said, not refused. A supplier who sends thirty-two against
                    an order for thirty has over-delivered, and that is a
                    conversation with him — not a line the shop is stopped from
                    recording. Refusing it would mean the shelf count is wrong
                    instead. */}
                {over ? (
                  <p className="mt-2 text-[0.75rem] leading-snug text-signal-warn">
                    More than the order still expects. Recorded as it stands —
                    check it against the delivery note.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {lines.length > 0 ? (
        <p className="flex items-center justify-between border-t border-orchid-100 pt-2.5 text-[0.8125rem]">
          <span className="text-graphite-500">
            {lines.length} {lines.length === 1 ? "line" : "lines"}
          </span>
          <span className="font-display text-[1rem] font-bold tabular-nums text-graphite-900">
            {subtotal.toLocaleString("en-PK", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * A typed number, bounded.
 *
 * Empty reads as zero rather than NaN, so clearing a box to retype it does not
 * make the whole total disappear while somebody's finger is between digits. The
 * ceiling is the same one `checkOrder` and the column constraint enforce, so a
 * mis-keyed row is stopped at the keyboard rather than at the save.
 */
function clamp(raw: string, max: number): number {
  const value = Number(raw.replace(/[,\s]/g, ""));
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(value, max);
}
