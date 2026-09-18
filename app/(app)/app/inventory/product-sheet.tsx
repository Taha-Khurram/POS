"use client";

import { useActionState, useEffect, useId, useMemo, useRef, useState } from "react";

import { BarcodeScanner } from "@/components/pos/barcode-scanner";
import {
  IconAlert,
  IconBarcode,
  IconCamera,
  IconCheck,
  IconClose,
  IconPlus,
  IconSearch,
  IconTag,
  IconTrash,
} from "@/components/pos/icons";
import { SelectRow } from "@/components/pos/select-field";
import { useActionToast } from "@/components/pos/toaster";
import {
  categoriesIn,
  DEPARTMENTS,
  GLOBAL_SAMPLE,
  internalBarcode,
  isFractional,
  looksScanned,
  marginOf,
  suggestSku,
  TAX_RATES,
  TRACKING,
  UNITS,
  type Product,
  type TrackingMode,
  type UnitId,
} from "@/lib/pos/catalog";
import { rupees } from "@/lib/format";
import { deleteProduct, saveProduct } from "./actions";
import { IDLE } from "./state";

/**
 * One product, added or corrected.
 *
 * The order of the sheet is the order of the hands: the barcode comes first
 * because the item is already on the counter and the scanner is already in
 * reach, and everything a lookup can fill is directly under it. Pricing sits
 * above stock because a shopkeeper always knows what they paid and often has to
 * go and count what is on the shelf.
 *
 * Three things here are real arithmetic rather than decoration — the margin
 * readout, the internal EAN-13, and the variant matrix — because those are the
 * three that are wrong on every spreadsheet this screen replaces.
 *
 * Every field is controlled, which is unusual for this codebase and is what the
 * two lookups need: filling six boxes from a barcode is not something
 * `defaultValue` can do. The reset after "Save and add another" is therefore
 * ours to do too, and it deliberately keeps the department, category and
 * supplier — a shopkeeper entering a delivery is entering twelve things from
 * one distributor in one aisle, and clearing those would be twelve re-picks.
 */

/** Rupee fields arrive as strings; an empty one is 0, never NaN. */
const num = (value: string) => {
  const parsed = Number(value.replace(/[,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Where the digits in the barcode field came from. It changes what we say. */
type CodeSource = "none" | "scanned" | "typed" | "internal";

type LookupState = "idle" | "searching" | "hit" | "miss";

/** Quick ways to land on a round margin instead of doing the division. */
const MARGIN_STEPS = [15, 20, 25, 30];

type Option = { id: string; name: string; values: string };

const NEW_OPTIONS: Option[] = [
  { id: "opt-1", name: "Size", values: "Small, Medium, Large" },
  { id: "opt-2", name: "Colour", values: "" },
];

/** Every combination of every option, in the order the rows were typed. */
function matrixOf(options: Option[]) {
  const lists = options
    .map((option) => ({
      name: option.name.trim(),
      values: option.values
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    }))
    .filter((option) => option.name && option.values.length > 0);

  if (lists.length === 0) return [];

  return lists.reduce<string[][]>(
    (rows, list) => rows.flatMap((row) => list.values.map((value) => [...row, value])),
    [[]],
  );
}

export function ProductSheet({
  item,
  nextSerial,
  onClose,
}: {
  /** The row being corrected, or null for a new product. */
  item: Product | null;
  nextSerial: number;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const deleteFormId = useId();

  const [state, action, pending] = useActionState(saveProduct, IDLE);
  const [removal, removeAction, removing] = useActionState(deleteProduct, IDLE);

  useActionToast(state, {
    saved:
      state.saved?.action === "updated"
        ? `${state.saved.name} saved`
        : `${state.saved?.name ?? "Item"} added`,
    failed: "That item did not save",
  });

  useActionToast(removal, {
    saved: `${removal.saved?.name ?? "Item"} removed from the list`,
    failed: "That item was not removed",
  });

  const [barcode, setBarcode] = useState(item?.barcode ?? "");
  const [source, setSource] = useState<CodeSource>(item?.barcode ? "typed" : "none");
  const [scanning, setScanning] = useState(false);
  const [lookup, setLookup] = useState<LookupState>("idle");

  const [name, setName] = useState(item?.name ?? "");
  const [urdu, setUrdu] = useState(item?.urdu ?? "");
  const [department, setDepartment] = useState(
    item?.department || DEPARTMENTS[0].name,
  );
  const [category, setCategory] = useState(
    item?.category || DEPARTMENTS[0].categories[0].name,
  );
  const [sub, setSub] = useState(item?.sub ?? "");
  const [supplier, setSupplier] = useState(item?.supplier ?? "");

  const [cost, setCost] = useState(item ? String(item.cost) : "");
  const [price, setPrice] = useState(item ? String(item.price) : "");
  const [taxRate, setTaxRate] = useState(String(item?.taxRate ?? 18));

  const [tracking, setTracking] = useState<TrackingMode>(item?.tracking ?? "unit");
  const [unit, setUnit] = useState<UnitId>(item?.unit ?? "piece");
  const [stock, setStock] = useState(item ? String(item.stock) : "");
  const [lowAt, setLowAt] = useState(String(item?.lowAt ?? 12));
  const [options, setOptions] = useState<Option[]>(NEW_OPTIONS);
  const [onSale, setOnSale] = useState(item?.isActive ?? true);

  // The serial the next in-store code and the suggested SKU are cut from. It is
  // a suggestion and not a claim: the unique index on `(tenant_id, barcode)` is
  // what guarantees the code, and the action turns its refusal into a sentence.
  const [serial, setSerial] = useState(nextSerial);

  const [skuTouched, setSkuTouched] = useState(Boolean(item?.sku));
  const [sku, setSku] = useState(item?.sku ?? "");

  const [armed, setArmed] = useState(false);

  // Which button was pressed. A ref rather than state because it is read by the
  // effect below after the action settles and must never cause a render of its
  // own — the two submit buttons differ only in what happens afterwards.
  const closeAfter = useRef(true);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !scanning) onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // The barcode field, not the dialog: the item is on the counter and the
    // scanner is a keyboard. Landing anywhere else means one wasted tap on
    // every single item, which over 400 items is the whole afternoon.
    codeRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [onClose, scanning]);

  // What the sheet does once the server has answered. Keyed off `savedAt` and
  // not off the state object, for the reason the toaster is: the
  // `revalidatePath` re-render arrives as a second state and would otherwise
  // clear the form somebody had already started typing the next item into.
  const settled = useRef<number | null>(null);

  useEffect(() => {
    if (!state.savedAt || state.savedAt === settled.current) return;
    settled.current = state.savedAt;

    if (closeAfter.current) return onClose();

    // Same aisle, same distributor, next item. The department, category,
    // supplier and tax rate stay; everything that identifies one product goes.
    setBarcode("");
    setSource("none");
    setLookup("idle");
    setName("");
    setUrdu("");
    setStock("");
    setCost("");
    setPrice("");
    setSku("");
    setSkuTouched(false);
    setSerial((value) => value + 1);
    codeRef.current?.focus();
  }, [state.savedAt, onClose]);

  const removed = useRef<number | null>(null);

  useEffect(() => {
    if (!removal.savedAt || removal.savedAt === removed.current) return;
    removed.current = removal.savedAt;
    onClose();
  }, [removal.savedAt, onClose]);

  const categories = categoriesIn(department);
  const subs = categories.find((entry) => entry.name === category)?.sub ?? [];

  const suggested = suggestSku(department, name, serial);
  const effectiveSku = skuTouched ? sku : suggested;

  const money = marginOf(num(cost), num(price));
  const losing = money !== null && money.profit < 0;

  const combos = useMemo(() => matrixOf(options), [options]);
  const fractional = isFractional(unit);
  const locked = pending || removing;

  /* ---------------- Barcode capture ----------------
     A USB scanner is a keyboard that types a whole code in under a tenth of a
     second and presses Enter. Nothing needs to be installed for that to work —
     but knowing it *was* a scanner is worth the two refs, because a 13-digit
     code typed by hand is where mis-keyed digits come from, and only the typed
     one is worth checking a digit at a time. */
  const burstStart = useRef(0);
  const burstKeys = useRef(0);

  const onCodeKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      // The sheet is a form now, so a scanner's trailing Enter would submit it
      // with nothing but a barcode in it. It ends the scan instead.
      event.preventDefault();
      const elapsed = Date.now() - burstStart.current;
      const value = event.currentTarget.value.trim();
      if (!value) return;

      setSource(burstKeys.current >= 6 && elapsed < 400 ? "scanned" : "typed");
      setLookup("idle");
      burstKeys.current = 0;
      return;
    }

    if (burstKeys.current === 0) burstStart.current = Date.now();
    burstKeys.current += 1;
  };

  const acceptScan = (code: string) => {
    setBarcode(code);
    setSource("scanned");
    setLookup("idle");
    setScanning(false);
  };

  const generateCode = () => {
    setBarcode(internalBarcode(serial));
    setSource("internal");
    setLookup("idle");
  };

  const clearCode = () => {
    setBarcode("");
    setSource("none");
    setLookup("idle");
    codeRef.current?.focus();
  };

  const runLookup = () => {
    setLookup("searching");

    // Stands in for the round trip to a global barcode database. The delay is
    // here so the pending state is a real state and not a flash — the call it
    // replaces will be slower than this on shop Wi-Fi, not faster.
    window.setTimeout(() => {
      const hit = GLOBAL_SAMPLE[barcode.trim()];
      if (!hit) return setLookup("miss");

      setName(hit.name);
      setDepartment(hit.department);
      setCategory(hit.category);
      setSub("");
      setLookup("hit");
    }, 420);
  };

  const applyMargin = (percent: number) => {
    const base = num(cost);
    if (base <= 0) return;
    // Margin is off the selling price, so the divisor is what makes this
    // different from simply adding a percentage to the cost.
    setPrice(String(Math.round(base / (1 - percent / 100))));
  };

  const setOption = (id: string, patch: Partial<Option>) =>
    setOptions((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const addOption = () =>
    setOptions((rows) => [
      ...rows,
      { id: `opt-${rows.length + 1}-${Date.now()}`, name: "", values: "" },
    ]);

  return (
    <div
      className="pos-modal"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !locked) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={item ? `Edit ${item.name}` : "Add a product"}
        tabIndex={-1}
        className="pos-sheet pos-sheet-wide outline-none"
      >
        <form action={action}>
          {/* The row this form writes to. Checked against the shop's own items
              inside the action — a crafted id must never reach the update. */}
          {item ? <input type="hidden" name="item_id" value={item.id} /> : null}
          <input type="hidden" name="tracking" value={tracking} />
          <input type="hidden" name="department" value={department} />
          <input type="hidden" name="category" value={category} />
          <input type="hidden" name="subcategory" value={sub} />
          {/* The tax rate and the unit joined these when their dropdowns
              stopped being `<select name=…>`. They sit above the fieldset
              rather than inside it on purpose: a disabled fieldset posts
              nothing, and these two are never the field being switched off. */}
          <input type="hidden" name="tax_rate" value={taxRate} />
          <input type="hidden" name="unit" value={unit} />
          <input
            type="hidden"
            name="variant_count"
            value={tracking === "variant" ? combos.length : ""}
          />

          <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-orchid-100 bg-paper-50 px-4 py-3.5 sm:px-5">
            <span className="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-xl bg-orchid-200 text-orchid-800">
              <IconBarcode className="h-[18px] w-[18px]" />
            </span>

            <div className="min-w-0 flex-1">
              <h2 className="font-display text-[1rem] leading-tight font-bold">
                {item ? item.name : "Add a product"}
              </h2>
              <p className="mt-0.5 truncate text-[0.75rem] text-graphite-500">
                {item
                  ? "Correct anything. The register picks it up on its next load."
                  : "Scan it, price it, count it. Roughly forty seconds an item."}
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

          <fieldset disabled={locked} className="space-y-6 px-4 py-5 sm:px-5">
            {/* ---------------- 1 · The code ---------------- */}
            <section>
              <Step n={1} title="Barcode" hint="Scan it, or make one for the shop." />

              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-[13rem] flex-1 block">
                  <span className="pos-label">Barcode — UPC or EAN</span>
                  <input
                    ref={codeRef}
                    name="barcode"
                    className="pos-field font-mono tracking-[0.06em]"
                    value={barcode}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="Click here and scan"
                    onKeyDown={onCodeKeyDown}
                    onChange={(event) => {
                      setBarcode(event.target.value);
                      setSource(event.target.value ? "typed" : "none");
                      setLookup("idle");
                    }}
                  />
                </label>

                <button
                  type="button"
                  onClick={() => setScanning(true)}
                  className="pos-btn pos-btn-soft"
                >
                  <IconCamera className="h-4 w-4" />
                  Camera
                </button>

                <button
                  type="button"
                  onClick={runLookup}
                  disabled={!looksScanned(barcode) || lookup === "searching"}
                  className="pos-btn pos-btn-soft disabled:opacity-45"
                >
                  <IconSearch className="h-4 w-4" />
                  {lookup === "searching" ? "Looking up…" : "Look up"}
                </button>
              </div>

              {scanning ? (
                <div className="mt-3">
                  <BarcodeScanner onRead={acceptScan} onClose={() => setScanning(false)} />
                </div>
              ) : null}

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {source === "scanned" ? (
                  <span className="pos-badge pos-badge-good">
                    <IconCheck className="h-3 w-3" />
                    Scanned
                  </span>
                ) : null}

                {source === "internal" ? (
                  <span className="pos-badge pos-badge-info">
                    <IconTag className="h-3 w-3" />
                    In-store code
                  </span>
                ) : null}

                {source === "typed" && !looksScanned(barcode) && barcode ? (
                  <span className="pos-badge pos-badge-warn">
                    Not a full UPC or EAN
                  </span>
                ) : null}

                {barcode ? (
                  <button
                    type="button"
                    onClick={clearCode}
                    className="pos-btn pos-btn-quiet pos-btn-sm"
                  >
                    <IconTrash className="h-3.5 w-3.5" />
                    Clear
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={generateCode}
                    className="pos-btn pos-btn-quiet pos-btn-sm"
                  >
                    <IconPlus className="h-3.5 w-3.5" />
                    No barcode on it — make one
                  </button>
                )}
              </div>

              {lookup === "hit" ? (
                <p className="pos-hint flex items-start gap-1.5">
                  <IconCheck className="mt-0.5 h-3.5 w-3.5 flex-none text-signal-good" />
                  Filled from the barcode database —{" "}
                  <strong>{GLOBAL_SAMPLE[barcode.trim()]?.brand}</strong>,{" "}
                  {GLOBAL_SAMPLE[barcode.trim()]?.size}. Check the name before
                  saving; these entries are written by whoever uploaded them.
                </p>
              ) : null}

              {lookup === "miss" ? (
                <p className="pos-hint flex items-start gap-1.5">
                  <IconAlert className="mt-0.5 h-3.5 w-3.5 flex-none text-signal-warn" />
                  Nothing came back for that code. Type the name below — most
                  local brands and every bakery item are missing from the global
                  databases, which is normal, not an error.
                </p>
              ) : null}

              {source === "internal" ? (
                <LabelPreview
                  code={barcode}
                  name={name}
                  price={num(price)}
                  sku={effectiveSku}
                  onAnother={() => {
                    setSerial((value) => value + 1);
                    setBarcode(internalBarcode(serial + 1));
                  }}
                />
              ) : null}
            </section>

            {/* ---------------- 2 · What it is ---------------- */}
            <section>
              <Step n={2} title="The item" hint="What the cashier searches for." />

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="pos-label">Name</span>
                  <input
                    name="name"
                    className="pos-field"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Tapal Danedar 475 g"
                    required
                  />
                </label>

                <label className="block">
                  <span className="pos-label">Urdu name — optional</span>
                  <input
                    name="urdu"
                    className="pos-field"
                    dir="rtl"
                    value={urdu}
                    onChange={(event) => setUrdu(event.target.value)}
                    placeholder="ٹپال دانے دار"
                  />
                  <p className="pos-hint">
                    Searchable in Urdu script at the till, beside the roman name.
                  </p>
                </label>

                {/* The tree, three controls deep. Choosing a department
                    rewrites the two under it rather than leaving a category
                    that no longer belongs to it — the item would save with a
                    pair the register's grid could never page to. */}
                <SelectRow
                  label="Department"
                  value={department}
                  onChange={(next) => {
                    setDepartment(next);
                    setCategory(categoriesIn(next)[0]?.name ?? "");
                    setSub("");
                  }}
                  options={DEPARTMENTS.map((entry) => ({
                    id: entry.name,
                    label: entry.name,
                    description: `${entry.categories.length} categories`,
                  }))}
                />

                <SelectRow
                  label="Category"
                  value={category}
                  onChange={(next) => {
                    setCategory(next);
                    setSub("");
                  }}
                  options={categories.map((entry) => ({
                    id: entry.name,
                    label: entry.name,
                    description:
                      entry.sub.length > 0 ? entry.sub.join(" · ") : undefined,
                  }))}
                />

                <SelectRow
                  label="Subcategory — optional"
                  value={sub}
                  onChange={setSub}
                  disabled={subs.length === 0}
                  placeholder={
                    subs.length === 0 ? "This category has none" : "None"
                  }
                  options={
                    subs.length === 0
                      ? []
                      : [
                          { id: "", label: "None" },
                          ...subs.map((entry) => ({ id: entry, label: entry })),
                        ]
                  }
                />

                <label className="block">
                  <span className="pos-label">Supplier — optional</span>
                  <input
                    name="supplier"
                    className="pos-field"
                    value={supplier}
                    onChange={(event) => setSupplier(event.target.value)}
                    placeholder="Ravi Trading — Akbari Mandi"
                  />
                </label>

                <label className="block sm:col-span-2">
                  <span className="pos-label">SKU</span>
                  <input
                    name="sku"
                    className="pos-field font-mono"
                    value={effectiveSku}
                    onChange={(event) => {
                      setSkuTouched(true);
                      setSku(event.target.value);
                    }}
                  />
                  <p className="pos-hint">
                    {skuTouched ? (
                      <>
                        Your own code.{" "}
                        <button
                          type="button"
                          className="font-semibold text-orchid-700 underline underline-offset-2"
                          onClick={() => setSkuTouched(false)}
                        >
                          Go back to {suggested}
                        </button>
                      </>
                    ) : (
                      "Made up from the department and the name. Edit it if your rate list already has one."
                    )}
                  </p>
                </label>
              </div>
            </section>

            {/* ---------------- 3 · Money ---------------- */}
            <section>
              <Step
                n={3}
                title="Cost and price"
                hint="What you pay, and what the customer pays."
              />

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block">
                  <span className="pos-label">Cost price</span>
                  <input
                    name="cost"
                    className="pos-field"
                    inputMode="decimal"
                    value={cost}
                    onChange={(event) => setCost(event.target.value)}
                    placeholder="985"
                  />
                  <p className="pos-hint">Per unit, what the supplier charges.</p>
                </label>

                <label className="block">
                  <span className="pos-label">Retail price</span>
                  <input
                    name="price"
                    className="pos-field"
                    inputMode="decimal"
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                    placeholder="1150"
                  />
                  <p className="pos-hint">Tax included — as Settings has it.</p>
                </label>

                <SelectRow
                  label="Tax rate"
                  value={taxRate}
                  onChange={setTaxRate}
                  options={TAX_RATES.map((rate) => ({
                    id: String(rate.id),
                    label: rate.short,
                    description: rate.levy,
                  }))}
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-[0.75rem] font-semibold text-graphite-500">
                  Price it at
                </span>
                {MARGIN_STEPS.map((step) => (
                  <button
                    key={step}
                    type="button"
                    onClick={() => applyMargin(step)}
                    disabled={num(cost) <= 0}
                    className="pos-btn pos-btn-soft pos-btn-sm disabled:opacity-45"
                  >
                    {step}% margin
                  </button>
                ))}
              </div>

              <div className="mt-3 grid gap-2 rounded-xl border border-orchid-100 bg-orchid-50/55 p-3.5 sm:grid-cols-3">
                <Figure
                  label="Profit per unit"
                  value={money ? rupees(money.profit) : "—"}
                  tone={losing ? "bad" : "good"}
                />
                <Figure
                  label="Margin"
                  value={money ? `${money.marginPct.toFixed(1)}%` : "—"}
                  note="of the selling price"
                  tone={losing ? "bad" : "plain"}
                />
                <Figure
                  label="Markup"
                  value={money ? `${money.markupPct.toFixed(1)}%` : "—"}
                  note="on top of the cost"
                  tone="plain"
                />

                {losing ? (
                  <p className="flex items-start gap-1.5 text-[0.75rem] leading-relaxed text-signal-bad sm:col-span-3">
                    <IconAlert className="mt-0.5 h-3.5 w-3.5 flex-none" />
                    The retail price is under the cost. That is fine for a loss
                    leader — the register will not stop the sale — but the
                    dashboard will count it as a loss, because it is one.
                  </p>
                ) : null}
              </div>
            </section>

            {/* ---------------- 4 · Stock ---------------- */}
            <section>
              <Step
                n={4}
                title="How it is counted"
                hint="Pieces, weight, or a grid of sizes."
              />

              <fieldset>
                <legend className="sr-only">Stock tracking</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {TRACKING.map((mode) => (
                    <label
                      key={mode.id}
                      className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3.5 py-3 transition-colors ${
                        tracking === mode.id
                          ? "border-orchid-400 bg-orchid-50"
                          : "border-orchid-100"
                      }`}
                    >
                      <input
                        type="radio"
                        name="tracking_choice"
                        value={mode.id}
                        checked={tracking === mode.id}
                        onChange={() => {
                          setTracking(mode.id);
                          if (mode.id === "weight" && !fractional) setUnit("kg");
                          if (mode.id !== "weight" && fractional) setUnit("piece");
                        }}
                        className="mt-0.5 h-4 w-4 flex-none accent-orchid-700"
                      />
                      <span>
                        <span className="block text-[0.875rem] font-semibold text-graphite-900">
                          {mode.label}
                        </span>
                        <span className="block text-[0.75rem] leading-relaxed text-graphite-500">
                          {mode.blurb}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <SelectRow
                  label="Sold in"
                  value={unit}
                  onChange={(next) => setUnit(next as UnitId)}
                  options={UNITS.filter((entry) =>
                    tracking === "weight" ? entry.fractional : true,
                  ).map((entry) => ({ id: entry.id, label: entry.label }))}
                />

                <label className="block">
                  <span className="pos-label">
                    {item ? "Stock on hand" : "Stock on hand now"}
                  </span>
                  <input
                    name="stock"
                    className="pos-field"
                    inputMode="decimal"
                    value={stock}
                    onChange={(event) => setStock(event.target.value)}
                    placeholder={fractional ? "84.5" : "24"}
                  />
                  <p className="pos-hint">
                    {fractional
                      ? "Decimals allowed — 84.5 kg is a legitimate count."
                      : "Whole units. Leave it empty to start at nothing."}
                  </p>
                </label>

                <label className="block">
                  <span className="pos-label">Warn me below</span>
                  <input
                    name="low_at"
                    className="pos-field"
                    inputMode="decimal"
                    value={lowAt}
                    onChange={(event) => setLowAt(event.target.value)}
                  />
                  <p className="pos-hint">
                    Per item, not one number for the whole shop: three bottles
                    of shampoo is fine, three crates of Coke is not.
                  </p>
                </label>
              </div>

              {tracking === "variant" ? (
                <VariantMatrix
                  options={options}
                  combos={combos}
                  sku={effectiveSku}
                  onChange={setOption}
                  onAdd={addOption}
                  onRemove={(id) =>
                    setOptions((rows) => rows.filter((row) => row.id !== id))
                  }
                />
              ) : null}
            </section>

            {/* ---------------- 5 · At the till ---------------- */}
            <section>
              <Step
                n={5}
                title="At the till"
                hint="Whether the register offers it at all."
              />

              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-orchid-100 bg-orchid-50/60 p-3.5">
                <input
                  type="checkbox"
                  name="is_active"
                  checked={onSale}
                  onChange={(event) => setOnSale(event.target.checked)}
                  className="mt-0.5 h-4 w-4 flex-none accent-orchid-700"
                />

                <span className="min-w-0">
                  <span className="block font-display text-[0.875rem] font-semibold text-graphite-900">
                    The register can ring this up
                  </span>
                  <span className="mt-1 block text-[0.8125rem] leading-relaxed text-graphite-700">
                    {onSale ? (
                      <>
                        It is in the till&rsquo;s search and on the shelf list.
                      </>
                    ) : (
                      <>
                        Hidden. The cashier cannot find it, and it stays out of
                        the low-stock warnings — which is what a seasonal item or
                        something you have stopped carrying wants. Its past sales
                        are untouched.
                      </>
                    )}
                  </span>
                </span>
              </label>
            </section>

            {/* ---------------- Removing it ---------------- */}
            {item ? (
              <section className="rounded-2xl border border-orchid-100 p-3.5">
                <h3 className="font-display text-[0.9375rem] font-semibold">
                  Delete {item.name}
                </h3>
                <p className="mt-1 text-[0.8125rem] leading-relaxed text-graphite-700">
                  Gone from the list for good. Every receipt it is already on
                  still prints exactly as it was rung up — but nothing will be
                  able to total last month&rsquo;s sales by this item again. If
                  you have simply stopped carrying it, switch it off above
                  instead.
                </p>

                {removal.error ? (
                  <p className="mt-3 text-[0.8125rem] leading-relaxed text-signal-bad">
                    {removal.error}
                  </p>
                ) : null}

                <div className="mt-3.5 flex flex-wrap items-center gap-2">
                  {armed ? (
                    <>
                      {/* `form=` rather than nesting: a form inside a form is
                          invalid HTML and the browser drops the inner one, so
                          the delete button lives here and submits the empty
                          form declared beside this one. */}
                      <button
                        type="submit"
                        form={deleteFormId}
                        disabled={removing}
                        className="pos-btn pos-btn-sm bg-signal-bad text-white disabled:opacity-60"
                      >
                        <IconTrash className="h-4 w-4" />
                        {removing ? "Deleting…" : `Yes, delete ${item.name}`}
                      </button>

                      <button
                        type="button"
                        onClick={() => setArmed(false)}
                        className="pos-btn pos-btn-quiet pos-btn-sm"
                      >
                        Keep it
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setArmed(true)}
                      className="pos-btn pos-btn-soft pos-btn-sm"
                    >
                      <IconTrash className="h-4 w-4" />
                      Delete product
                    </button>
                  )}
                </div>
              </section>
            ) : null}
          </fieldset>

          <footer className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-orchid-100 bg-paper-50 px-4 py-3 sm:px-5">
            {state.error ? (
              <p className="mr-auto min-w-[8rem] flex-1 text-[0.75rem] leading-snug text-signal-bad">
                {state.error}
              </p>
            ) : null}

            <button
              type="button"
              onClick={onClose}
              disabled={locked}
              className="pos-btn pos-btn-soft"
            >
              Cancel
            </button>

            {item ? null : (
              <button
                type="submit"
                disabled={locked}
                onClick={() => {
                  closeAfter.current = false;
                }}
                className="pos-btn pos-btn-soft disabled:opacity-60"
              >
                {pending ? "Saving…" : "Save and add another"}
              </button>
            )}

            <button
              type="submit"
              disabled={locked}
              onClick={() => {
                closeAfter.current = true;
              }}
              className="pos-btn pos-btn-primary disabled:opacity-60"
            >
              {pending ? "Saving…" : item ? "Save changes" : "Save and close"}
            </button>
          </footer>
        </form>

        {item ? (
          <form id={deleteFormId} action={removeAction} className="hidden">
            <input type="hidden" name="item_id" value={item.id} />
          </form>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------- Pieces ---------------- */

function Step({ n, title, hint }: { n: number; title: string; hint: string }) {
  return (
    <header className="mb-3 flex items-center gap-2.5">
      <span className="pos-stamp h-6 w-6 rounded-lg text-[0.6875rem]">{n}</span>
      <h3 className="font-display text-[0.9375rem] font-semibold">{title}</h3>
      <span className="truncate text-[0.75rem] text-graphite-500">{hint}</span>
    </header>
  );
}

function Figure({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone: "good" | "bad" | "plain";
}) {
  const colour =
    tone === "bad"
      ? "text-signal-bad"
      : tone === "good"
        ? "text-signal-good"
        : "text-graphite-900";

  return (
    <p>
      <span className="block text-[0.6875rem] font-semibold tracking-wide text-graphite-500 uppercase">
        {label}
      </span>
      <span className={`block font-display text-[1.125rem] font-bold tabular-nums ${colour}`}>
        {value}
      </span>
      {note ? (
        <span className="block text-[0.6875rem] text-graphite-500">{note}</span>
      ) : null}
    </p>
  );
}

/**
 * The shelf label that will come off the printer.
 *
 * No bars are drawn. A rectangle of plausible-looking stripes that does not
 * decode is worse than no picture at all — someone would print a sheet of them
 * and find out at the till. The digits are the truth; the bars are the
 * printer's job.
 */
function LabelPreview({
  code,
  name,
  price,
  sku,
  onAnother,
}: {
  code: string;
  name: string;
  price: number;
  sku: string;
  onAnother: () => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-orchid-100 bg-orchid-50/55 p-3.5">
      <div className="w-[13.5rem] rounded-lg border border-dashed border-orchid-300 bg-paper-50 px-3 py-2.5 text-center">
        <p className="truncate text-[0.75rem] font-semibold text-graphite-900">
          {name || "Item name"}
        </p>
        <p className="font-display text-[1.0625rem] font-bold text-graphite-900">
          {price > 0 ? rupees(price) : "Rs —"}
        </p>
        <p className="mt-1 font-mono text-[0.6875rem] tracking-[0.18em] text-graphite-700">
          {code}
        </p>
        <p className="font-mono text-[0.625rem] text-graphite-500">{sku}</p>
      </div>

      <div className="min-w-[12rem] flex-1">
        <p className="text-[0.8125rem] leading-relaxed text-graphite-700">
          An in-store EAN-13 in the 200 range, which GS1 keeps free for codes
          like this — so it can never collide with a manufacturer&apos;s.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="pos-btn pos-btn-soft pos-btn-sm" disabled>
            Print label
          </button>
          <button
            type="button"
            onClick={onAnother}
            className="pos-btn pos-btn-quiet pos-btn-sm"
          >
            Give me a different one
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Size × colour, and whatever else the shop sells in a grid.
 *
 * Capped, and the cap is the point: six sizes by five colours by three fits is
 * ninety rows to count at stock-take, and a cloth house that wants that should
 * be asked whether it means it rather than finding out in January.
 *
 * What is saved today is the *number* of rows, not the rows — `item_variants`
 * is not built, so each combination has no stock of its own yet and the count
 * above covers the lot. The grid is here because the SKUs it generates are what
 * a shop prints its labels from, and it says so rather than offering a per-row
 * stock box that would go nowhere.
 */
const MATRIX_CAP = 60;

function VariantMatrix({
  options,
  combos,
  sku,
  onChange,
  onAdd,
  onRemove,
}: {
  options: Option[];
  combos: string[][];
  sku: string;
  onChange: (id: string, patch: Partial<Option>) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  const shown = combos.slice(0, MATRIX_CAP);

  return (
    <div className="mt-4">
      <div className="space-y-2">
        {options.map((option, index) => (
          <div key={option.id} className="flex flex-wrap items-end gap-2">
            <label className="w-[9rem] flex-none">
              <span className="pos-label">{index === 0 ? "Option" : "And"}</span>
              <input
                className="pos-field"
                value={option.name}
                onChange={(event) => onChange(option.id, { name: event.target.value })}
                placeholder="Size"
              />
            </label>

            <label className="min-w-[12rem] flex-1">
              <span className="pos-label">Values, separated by commas</span>
              <input
                className="pos-field"
                value={option.values}
                onChange={(event) => onChange(option.id, { values: event.target.value })}
                placeholder="Small, Medium, Large"
              />
            </label>

            {options.length > 1 ? (
              <button
                type="button"
                onClick={() => onRemove(option.id)}
                className="pos-icon-btn mb-1"
                aria-label={`Remove ${option.name || "this option"}`}
              >
                <IconTrash className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onAdd}
        disabled={options.length >= 3}
        className="pos-btn pos-btn-quiet pos-btn-sm mt-2 disabled:opacity-45"
      >
        <IconPlus className="h-3.5 w-3.5" />
        Another option
      </button>

      {shown.length > 0 ? (
        <div className="mt-3 overflow-x-auto rounded-xl border border-orchid-100">
          <table className="pos-table">
            <thead>
              <tr>
                <th>Variant</th>
                <th>SKU it would carry</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((combo) => (
                <tr key={combo.join("-")}>
                  <td className="font-medium text-graphite-900">{combo.join(" · ")}</td>
                  <td className="font-mono text-[0.75rem] text-graphite-500">
                    {sku}-
                    {combo.map((value) => value.slice(0, 2).toUpperCase()).join("")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="pos-hint">
          Name an option and give it values — the rows below build themselves.
        </p>
      )}

      {combos.length > 0 ? (
        <p className="pos-hint flex items-start gap-1.5">
          {combos.length > MATRIX_CAP ? (
            <>
              <IconAlert className="mt-0.5 h-3.5 w-3.5 flex-none text-signal-warn" />
              {combos.length} combinations — only the first {MATRIX_CAP} are
              shown. That is a lot of rows to count at stock-take; consider
              splitting the colours into their own items.
            </>
          ) : (
            <>
              <IconCheck className="mt-0.5 h-3.5 w-3.5 flex-none text-orchid-600" />
              {combos.length} {combos.length === 1 ? "row" : "rows"}. The count
              is saved with the item; stock and a barcode per row arrive with the
              variants table.
            </>
          )}
        </p>
      ) : null}
    </div>
  );
}
