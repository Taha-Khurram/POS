"use client";

import { useEffect, useMemo, useState } from "react";

import { IconClose } from "@/components/pos/icons";
import type { Product } from "@/lib/pos/catalog";
import { round3 } from "@/lib/pos/counter";
import { cartKey } from "@/lib/pos/counter";
import { priceOf, writeVariant, type Variant } from "@/lib/pos/variant";

/**
 * Which size or colour, at the counter.
 *
 * A grid rather than a dropdown, because this is a 10-inch screen with a
 * customer standing at it and the cashier is picking one of nine things by
 * sight. A `<select>` of "Small / Blue, Small / Green, Medium / Blue…" is nine
 * lines of near-identical text to read under pressure.
 *
 * **Laid out by the two axes**, with the first down the side and the second
 * across the top, so the grid on screen is the grid on the shelf. A flat list
 * would lose the one thing that makes it scannable — all the mediums in a row.
 *
 * **What is out of stock is drawn and disabled, not hidden.** The cashier has
 * been asked for a large blue and needs to see that there is none, not fail to
 * find it. That is the same call the item list makes about an item at zero.
 */
export function VariantPicker({
  item,
  variants,
  /** What this tablet has sold since the page loaded, by cart key — so the grid
   *  counts down as the bill is built rather than offering stock already on it. */
  sold,
  money,
  onPick,
  onClose,
}: {
  item: Product;
  variants: Variant[];
  sold: Record<string, number>;
  money: (value: number) => string;
  onPick: (variant: Variant) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const axes = item.variantAxes;

  // The two axes as they appear in the rows, in the order the grid was saved —
  // which is the order the shop arranged it, not alphabetical.
  const { rowsA, colsB } = useMemo(() => {
    const a: string[] = [];
    const b: string[] = [];

    for (const variant of variants) {
      if (!a.includes(variant.optionA)) a.push(variant.optionA);
      if (variant.optionB && !b.includes(variant.optionB)) b.push(variant.optionB);
    }

    return { rowsA: a, colsB: b };
  }, [variants]);

  const at = (optionA: string, optionB: string) =>
    variants.find(
      (variant) => variant.optionA === optionA && (variant.optionB || "") === optionB,
    );

  // A scanner still works here: the label on a garment carries the variant's
  // own code, and typing or scanning it picks the row straight off.
  const scanned = query.trim()
    ? variants.find(
        (variant) =>
          variant.barcode === query.trim() ||
          variant.sku.toLowerCase() === query.trim().toLowerCase(),
      )
    : undefined;

  useEffect(() => {
    if (scanned) onPick(scanned);
  }, [scanned, onPick]);

  const left = (variant: Variant) =>
    round3(variant.quantity - (sold[cartKey(item.id, variant.id)] ?? 0));

  return (
    <div
      className="pos-modal"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Which ${item.name}?`}
        tabIndex={-1}
        className="pos-sheet outline-none"
      >
        <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-orchid-100 bg-paper-50 px-4 py-3.5 sm:px-5">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[1rem] leading-tight font-bold">
              Which {item.name}?
            </h2>
            <p className="mt-0.5 truncate text-[0.75rem] text-graphite-500">
              {axes.join(" and ") || "Pick one"} · {money(item.price)} unless the
              row says otherwise
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="pos-icon-btn"
            aria-label="Close"
          >
            <IconClose />
          </button>
        </header>

        <div className="space-y-3 px-4 py-4 sm:px-5">
          <input
            className="pos-field font-mono"
            value={query}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Or scan the label on the garment"
            aria-label="Scan a variant barcode"
            autoComplete="off"
          />

          {colsB.length === 0 ? (
            // One axis only — a bakery's cake sizes. A row of buttons, because
            // a one-column grid is a list with extra lines drawn on it.
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {rowsA.map((optionA) => {
                const variant = at(optionA, "");
                if (!variant) return null;
                return (
                  <li key={optionA}>
                    <Cell
                      label={optionA}
                      variant={variant}
                      left={left(variant)}
                      itemPrice={item.price}
                      money={money}
                      onPick={onPick}
                    />
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-1">
                <thead>
                  <tr>
                    <th className="w-20 text-left text-[0.6875rem] font-semibold tracking-wide text-graphite-500 uppercase">
                      {axes[0] ?? ""}
                    </th>
                    {colsB.map((optionB) => (
                      <th
                        key={optionB}
                        className="text-center text-[0.6875rem] font-semibold tracking-wide text-graphite-500 uppercase"
                      >
                        {optionB}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rowsA.map((optionA) => (
                    <tr key={optionA}>
                      <th className="text-left text-[0.8125rem] font-medium text-graphite-900">
                        {optionA}
                      </th>
                      {colsB.map((optionB) => {
                        const variant = at(optionA, optionB);

                        return (
                          <td key={optionB}>
                            {variant ? (
                              <Cell
                                label={optionB}
                                variant={variant}
                                left={left(variant)}
                                itemPrice={item.price}
                                money={money}
                                onPick={onPick}
                                compact
                              />
                            ) : (
                              // A combination the shop never made. Blank rather
                              // than a disabled button: there is nothing to
                              // enable, and a grey square reads as out of stock.
                              <span className="block py-2 text-center text-[0.75rem] text-graphite-500">
                                —
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <footer className="sticky bottom-0 flex justify-end border-t border-orchid-100 bg-paper-50 px-4 py-3 sm:px-5">
          <button type="button" onClick={onClose} className="pos-btn pos-btn-soft">
            Cancel
          </button>
        </footer>
      </div>
    </div>
  );
}

function Cell({
  label,
  variant,
  left,
  itemPrice,
  money,
  onPick,
  compact = false,
}: {
  label: string;
  variant: Variant;
  left: number;
  itemPrice: number;
  money: (value: number) => string;
  onPick: (variant: Variant) => void;
  compact?: boolean;
}) {
  const out = left <= 0;
  const price = priceOf(variant, itemPrice);

  return (
    <button
      type="button"
      onClick={() => onPick(variant)}
      disabled={out}
      title={writeVariant(variant)}
      className={`w-full rounded-xl border px-2 py-2 text-center transition ${
        out
          ? "cursor-not-allowed border-orchid-100 opacity-45"
          : "border-orchid-200 hover:border-orchid-700 hover:bg-orchid-50"
      }`}
    >
      {compact ? null : (
        <span className="block text-[0.875rem] font-medium text-graphite-900">
          {label}
        </span>
      )}

      <span
        className={`block text-[0.8125rem] font-semibold tabular-nums ${
          out ? "text-graphite-500" : "text-graphite-900"
        }`}
      >
        {out ? "none" : left.toLocaleString("en-PK")}
      </span>

      {/* Only where it differs. A price repeated in twelve cells is twelve
          things to read past to find the one that is not the same. */}
      {variant.price !== null && variant.price !== itemPrice ? (
        <span className="block text-[0.6875rem] tabular-nums text-graphite-500">
          {money(price)}
        </span>
      ) : null}
    </button>
  );
}
