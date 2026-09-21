"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { IconAlert, IconCheck, IconTag } from "@/components/pos/icons";
import { useActionToast } from "@/components/pos/toaster";
import { rupees } from "@/lib/format";
import {
  AXIS_MAX,
  checkGrid,
  gridOf,
  splitValues,
  summariseVariants,
  VARIANTS_MAX,
  VARIANT_BARCODE_MAX,
  VARIANT_SKU_MAX,
  VARIANT_ADJUST_REASONS,
  writeVariant,
  type GridDraft,
  type Variant,
} from "@/lib/pos/variant";
import { adjustVariantStock, loadVariants, saveGrid } from "./variant-actions";
import { IDLE_VARIANT } from "./state";

/**
 * The variant grid, for real this time.
 *
 * What stood here before drew the SKUs a matrix *would* generate and said in as
 * many words that nothing was stored — `item_variants` did not exist until
 * `0031`. Now the grid is the thing: each row is a sellable line with its own
 * stock, its own code and optionally its own price, and the till picks one of
 * them.
 *
 * **Two axes typed as comma-separated lists**, because that is how a shopkeeper
 * writes them out: "Small, Medium, Large" and "Blue, Green". A row-by-row
 * builder would be twelve interactions for what is two.
 *
 * **Codes survive a rebuild.** The grid is saved whole, but the barcode and SKU
 * boxes are keyed by combination rather than by row id — so adding one colour
 * to a line whose labels are already printed keeps every code on the rows that
 * had them. That is the whole reason the form posts `row[Small|Blue][barcode]`
 * instead of an array: a new row has no id to key on yet.
 */
export function VariantGrid({
  itemId,
  itemName,
  itemPrice,
  itemStock,
  axes,
}: {
  itemId: string;
  itemName: string;
  /** What a row with no price of its own sells for. */
  itemPrice: number;
  /** The item's running total, so the editor can say when the grid does not
   *  cover all of it — stock counted before the grid existed is real. */
  itemStock: number;
  /** What the item's columns are called today, so the editor opens on the grid
   *  that exists rather than an empty one. */
  axes: string[];
}) {
  const [variants, setVariants] = useState<Variant[] | null>(null);
  const [editing, setEditing] = useState(false);

  const [saved, saveAction, saving] = useActionState(saveGrid, IDLE_VARIANT);
  const [counted, countAction, counting] = useActionState(
    adjustVariantStock,
    IDLE_VARIANT,
  );

  useActionToast(saved, {
    saved: `Grid saved — ${saved.saved?.detail ?? ""}`,
    failed: "That grid did not save",
  });

  useActionToast(counted, {
    saved: `${counted.saved?.detail ?? "Row"} counted`,
    failed: "That count did not save",
  });

  useEffect(() => {
    let live = true;
    loadVariants(itemId).then((rows) => {
      if (live) setVariants(rows);
    });
    return () => {
      live = false;
    };
  }, [itemId]);

  const settled = useRef<number | null>(null);

  useEffect(() => {
    for (const state of [saved, counted]) {
      if (state.savedAt && state.savedAt !== settled.current && state.variants) {
        settled.current = state.savedAt;
        setVariants(state.variants);
        setEditing(false);
      }
    }
  }, [saved, counted]);

  if (variants === null) {
    return (
      <p className="px-1 py-3 text-[0.8125rem] text-graphite-500">
        Reading the grid…
      </p>
    );
  }

  const live = variants.filter((variant) => variant.isActive);
  const totals = summariseVariants(variants);
  const unassigned = Math.round((itemStock - totals.total) * 1000) / 1000;

  return (
    <div className="space-y-3">
      {live.length === 0 && !editing ? (
        <div className="rounded-2xl border border-dashed border-orchid-200 px-4 py-5 text-center">
          <p className="text-[0.8125rem] leading-relaxed text-graphite-500">
            No grid yet. Say what this item varies by — size, colour, flavour —
            and every combination becomes a row with its own stock and barcode.
          </p>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="pos-btn pos-btn-primary pos-btn-sm mt-3"
          >
            <IconTag className="h-4 w-4" />
            Build the grid
          </button>
        </div>
      ) : null}

      {/* ---------------- What it comes to ---------------- */}
      {live.length > 0 ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Figure label="Rows" value={String(totals.rows)} />
            <Figure label="On the shelf" value={totals.total.toLocaleString("en-PK")} />
            <Figure
              label="Out of stock"
              value={String(totals.out)}
              tone={totals.out > 0 ? "warn" : undefined}
            />
          </div>

          {unassigned !== 0 ? (
            <p className="pos-note">
              <IconAlert className="mt-0.5 h-4 w-4 flex-none text-signal-warn" />
              <span>
                {unassigned > 0 ? (
                  <>
                    <strong className="font-semibold text-graphite-900">
                      {unassigned.toLocaleString("en-PK")}
                    </strong>{" "}
                    of this item is counted but in no row — stock that was on the
                    shelf before the grid existed. Count it into the rows it
                    belongs to and this goes away.
                  </>
                ) : (
                  <>
                    The rows hold {Math.abs(unassigned).toLocaleString("en-PK")}{" "}
                    more than the item&rsquo;s own count. That should not be
                    possible — tell us about it.
                  </>
                )}
              </span>
            </p>
          ) : null}

          <ul className="space-y-2">
            {live.map((variant) => (
              <VariantRow
                key={variant.id}
                variant={variant}
                itemPrice={itemPrice}
                action={countAction}
                busy={counting}
              />
            ))}
          </ul>

          <button
            type="button"
            onClick={() => setEditing((open) => !open)}
            className="pos-btn pos-btn-soft pos-btn-sm"
          >
            <IconTag className="h-4 w-4" />
            {editing ? "Close the builder" : "Change the grid"}
          </button>
        </>
      ) : null}

      {editing ? (
        <GridBuilder
          itemId={itemId}
          itemName={itemName}
          itemPrice={itemPrice}
          axes={axes}
          existing={variants}
          action={saveAction}
          busy={saving}
          error={saved.error}
        />
      ) : null}
    </div>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div className="rounded-xl border border-orchid-100 px-3 py-2">
      <p className="text-[0.6875rem] text-graphite-500">{label}</p>
      <p
        className={`mt-0.5 font-display text-[1.0625rem] font-bold tabular-nums ${
          tone === "warn" ? "text-signal-warn" : "text-graphite-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/** One row of the grid, with its count editable in place — the same call the
 *  batch panel makes, and for the same reason: somebody is reading a shelf and
 *  typing what is on it, ten rows in a row. */
function VariantRow({
  variant,
  itemPrice,
  action,
  busy,
}: {
  variant: Variant;
  itemPrice: number;
  action: (formData: FormData) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(String(variant.quantity));

  return (
    <li
      className={`rounded-2xl border p-3 ${
        variant.quantity <= 0 ? "border-signal-warn" : "border-orchid-100"
      }`}
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[0.875rem] font-medium text-graphite-900">
            {writeVariant(variant)}
            {variant.quantity <= 0 ? (
              <span className="pos-badge pos-badge-warn ml-2 align-middle">Out</span>
            ) : null}
          </p>
          <p className="mt-0.5 text-[0.6875rem] text-graphite-500">
            {variant.barcode ? (
              <span className="font-mono">{variant.barcode}</span>
            ) : (
              "no barcode"
            )}
            {variant.sku ? ` · ${variant.sku}` : ""}
            {" · "}
            {variant.price === null
              ? `${rupees(itemPrice)} (the item's price)`
              : rupees(variant.price)}
          </p>
        </div>

        <p className="flex-none text-right">
          <span className="font-display text-[1.125rem] font-bold tabular-nums text-graphite-900">
            {variant.quantity.toLocaleString("en-PK")}
          </span>
          <span className="block text-[0.6875rem] text-graphite-500">on the shelf</span>
        </p>
      </div>

      {open ? (
        <form action={action} className="mt-3 border-t border-orchid-100 pt-3">
          <input type="hidden" name="variant_id" value={variant.id} />

          <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
            <label className="block">
              <span className="pos-label">Count it to</span>
              <input
                name="to"
                className="pos-field text-right tabular-nums"
                inputMode="decimal"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                autoFocus
              />
            </label>

            <label className="block">
              <span className="pos-label">Why</span>
              <select name="reason" className="pos-field" defaultValue="count">
                {VARIANT_ADJUST_REASONS.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy}
              className="pos-btn pos-btn-primary pos-btn-sm disabled:opacity-60"
            >
              <IconCheck className="h-4 w-4" />
              {busy ? "Saving…" : "Save the count"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setTo(String(variant.quantity));
              }}
              className="pos-btn pos-btn-quiet pos-btn-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="pos-btn pos-btn-soft pos-btn-sm mt-2.5"
        >
          Count this row
        </button>
      )}
    </li>
  );
}

/**
 * The builder: two axes, their values, and a code box per combination.
 *
 * The preview is the point. Somebody types "Small, Medium, Large" and sees nine
 * rows appear before saving anything — which is what stops a grid of forty-two
 * being discovered after the fact.
 */
function GridBuilder({
  itemId,
  itemName,
  itemPrice,
  axes,
  existing,
  action,
  busy,
  error,
}: {
  itemId: string;
  itemName: string;
  itemPrice: number;
  axes: string[];
  existing: Variant[];
  action: (formData: FormData) => void;
  busy: boolean;
  error: string | null;
}) {
  // Opened on the grid that exists, so "add one colour" is one keystroke rather
  // than retyping what is already there.
  const [draft, setDraft] = useState<GridDraft>(() => {
    const a = [...new Set(existing.map((variant) => variant.optionA))];
    const b = [...new Set(existing.map((variant) => variant.optionB).filter(Boolean))];

    return {
      axisA: axes[0] ?? "Size",
      valuesA: a.join(", "),
      axisB: axes[1] ?? (b.length > 0 ? "Colour" : ""),
      valuesB: b.join(", "),
    };
  });

  const set = (patch: Partial<GridDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const rows = gridOf(draft);
  const complaint = checkGrid(draft);

  // What each combination already carries, so the boxes below are prefilled and
  // a rebuild does not lose a printed barcode.
  const held = new Map(
    existing.map((variant) => [`${variant.optionA}|${variant.optionB}`, variant]),
  );

  return (
    <form action={action} className="rounded-2xl border border-orchid-100 p-3.5">
      <input type="hidden" name="item_id" value={itemId} />

      <h4 className="font-display text-[0.875rem] font-semibold">
        What {itemName} varies by
      </h4>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="pos-label">First column</span>
          <input
            name="axis_a"
            className="pos-field"
            value={draft.axisA}
            maxLength={AXIS_MAX}
            placeholder="Size"
            onChange={(event) => set({ axisA: event.target.value })}
          />
        </label>

        <label className="block">
          <span className="pos-label">Its values</span>
          <input
            name="values_a"
            className="pos-field"
            value={draft.valuesA}
            placeholder="Small, Medium, Large"
            onChange={(event) => set({ valuesA: event.target.value })}
          />
          <p className="pos-hint">
            {splitValues(draft.valuesA).length} value
            {splitValues(draft.valuesA).length === 1 ? "" : "s"}, separated by
            commas.
          </p>
        </label>

        <label className="block">
          <span className="pos-label">Second column — optional</span>
          <input
            name="axis_b"
            className="pos-field"
            value={draft.axisB}
            maxLength={AXIS_MAX}
            placeholder="Colour"
            onChange={(event) => set({ axisB: event.target.value })}
          />
        </label>

        <label className="block">
          <span className="pos-label">Its values</span>
          <input
            name="values_b"
            className="pos-field"
            value={draft.valuesB}
            placeholder="Blue, Green"
            onChange={(event) => set({ valuesB: event.target.value })}
          />
          <p className="pos-hint">Leave both empty for one column only.</p>
        </label>
      </div>

      {/* ---------------- The preview ---------------- */}
      {rows.length > 0 ? (
        <div className="mt-4">
          <p className="pos-label">
            {rows.length} row{rows.length === 1 ? "" : "s"}
            {rows.length > VARIANTS_MAX ? " — too many" : ""}
          </p>

          <ul className="mt-1 max-h-72 space-y-1.5 overflow-y-auto">
            {rows.slice(0, VARIANTS_MAX).map((row) => {
              const key = `${row.optionA}|${row.optionB}`;
              const was = held.get(key);

              return (
                <li
                  key={key}
                  className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-xl border border-orchid-100 px-2.5 py-1.5"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[0.8125rem] text-graphite-900">
                      {row.optionB ? `${row.optionA} / ${row.optionB}` : row.optionA}
                      {was ? null : (
                        <span className="pos-badge pos-badge-good ml-2 align-middle">
                          New
                        </span>
                      )}
                    </span>
                    {was && was.quantity > 0 ? (
                      <span className="block text-[0.6875rem] text-graphite-500">
                        {was.quantity.toLocaleString("en-PK")} on the shelf
                      </span>
                    ) : null}
                  </span>

                  <span className="flex flex-none gap-1.5">
                    <input
                      name={`row[${key}][barcode]`}
                      className="pos-field w-32 font-mono text-[0.75rem]"
                      defaultValue={was?.barcode ?? ""}
                      maxLength={VARIANT_BARCODE_MAX}
                      placeholder="barcode"
                      aria-label={`Barcode for ${key}`}
                    />
                    <input
                      name={`row[${key}][sku]`}
                      className="pos-field w-24 font-mono text-[0.75rem]"
                      defaultValue={was?.sku ?? ""}
                      maxLength={VARIANT_SKU_MAX}
                      placeholder="SKU"
                      aria-label={`SKU for ${key}`}
                    />
                    <input
                      name={`row[${key}][price]`}
                      className="pos-field w-24 text-right text-[0.75rem] tabular-nums"
                      defaultValue={was?.price === null ? "" : String(was?.price ?? "")}
                      inputMode="decimal"
                      placeholder={String(itemPrice)}
                      aria-label={`Price for ${key}`}
                    />
                  </span>
                </li>
              );
            })}
          </ul>

          <p className="pos-hint mt-1.5">
            Leave a price empty to use the item&rsquo;s own {rupees(itemPrice)}.
            A combination you take off the list is switched off, never deleted —
            it may be on last month&rsquo;s receipts.
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="mt-2 text-[0.75rem] leading-snug text-signal-bad">{error}</p>
      ) : complaint && draft.valuesA ? (
        <p className="mt-2 text-[0.75rem] leading-snug text-graphite-700">
          {complaint}
        </p>
      ) : null}

      <div className="mt-3">
        <button
          type="submit"
          disabled={busy || Boolean(complaint)}
          className="pos-btn pos-btn-primary pos-btn-sm disabled:opacity-60"
        >
          <IconCheck className="h-4 w-4" />
          {busy ? "Saving…" : `Save ${rows.length} rows`}
        </button>
      </div>
    </form>
  );
}
