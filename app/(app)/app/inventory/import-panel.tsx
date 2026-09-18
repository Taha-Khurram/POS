"use client";

import Link from "next/link";
import { useId, useMemo, useRef, useState, useTransition } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import {
  IconAlert,
  IconCheck,
  IconClose,
  IconUpload,
} from "@/components/pos/icons";
import { Select } from "@/components/pos/select-field";
import { useToast } from "@/components/pos/toaster";
import { importProducts } from "./actions";
import type { ImportResult, ImportRow } from "./state";

/**
 * Bulk import — the screen onboarding lives or dies on.
 *
 * Every shop already has the list: an Excel sheet, a Word table, or a rate list
 * the distributor emails. Retyping four hundred items is how a POS gets
 * abandoned in week one, so the import is not a convenience feature, it is the
 * first thing a new shop touches — and usually with us on the phone.
 *
 * Which is why it is four visible steps rather than one "upload" button. The
 * failure that matters is not a rejected file; it is a file that imports
 * cleanly with the cost column read as the price. So the mapping is shown,
 * pre-guessed but never hidden, and the preview is of *mapped* rows — what will
 * be written — not of the raw sheet.
 *
 * The file never leaves the browser until Import is pressed. What is sent then
 * is the mapped rows and nothing else — not the file — and the Server Action
 * puts every one of them through the same validator the add-product sheet uses,
 * because a check that only ran here is a check a crafted request skipped.
 */

type FieldId =
  | "name"
  | "urdu"
  | "barcode"
  | "sku"
  | "department"
  | "category"
  | "unit"
  | "cost"
  | "price"
  | "stock"
  | "lowAt"
  | "supplier";

const FIELDS: {
  id: FieldId;
  label: string;
  required?: boolean;
  /** Header spellings seen in the wild, normalised. Roman Urdu included. */
  aliases: string[];
}[] = [
  { id: "name", label: "Item name", required: true, aliases: ["name", "item", "itemname", "product", "productname", "description", "particulars", "cheez"] },
  { id: "urdu", label: "Urdu name", aliases: ["urdu", "urduname", "nameurdu", "localname"] },
  { id: "barcode", label: "Barcode", aliases: ["barcode", "ean", "upc", "code", "barcodeno"] },
  { id: "sku", label: "SKU", aliases: ["sku", "itemcode", "code2", "articlecode", "ref"] },
  { id: "department", label: "Department", aliases: ["department", "dept", "group", "maincategory"] },
  { id: "category", label: "Category", aliases: ["category", "cat", "subcategory", "type"] },
  { id: "unit", label: "Unit", aliases: ["unit", "uom", "units", "packing"] },
  { id: "cost", label: "Cost price", required: true, aliases: ["cost", "costprice", "purchase", "purchaseprice", "buying", "buyrate", "rate", "kharid"] },
  { id: "price", label: "Retail price", required: true, aliases: ["price", "retail", "retailprice", "sale", "saleprice", "selling", "sellingprice", "mrp"] },
  { id: "stock", label: "Stock on hand", aliases: ["stock", "qty", "quantity", "onhand", "balance", "opening", "openingstock"] },
  { id: "lowAt", label: "Low-stock alert", aliases: ["low", "lowstock", "reorder", "reorderlevel", "min", "minimum", "alert"] },
  { id: "supplier", label: "Supplier", aliases: ["supplier", "vendor", "party", "distributor", "company"] },
];

const TEMPLATE = [
  "name,urdu,barcode,sku,department,category,unit,cost,price,stock,low_stock,supplier",
  'Coca-Cola 1.5 L,کوکا کولا,5449000000996,BEV-COL-1500,Beverages,Soft drinks,piece,148,180,64,24,Coca-Cola Icecek — Lahore',
  'Sugar — loose,چینی,,GRO-SUG-0001,Grocery,Sugar & salt,kg,142,165,84.5,25,"Ravi Trading, Akbari Mandi"',
  "Shan Biryani Masala 50 g,شان بریانی مصالحہ,8964000221471,GRO-SHA-0050,Grocery,Masala & spices,packet,88,110,120,36,Shan Foods",
].join("\n");

const normalise = (header: string) =>
  header.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * A CSV reader that survives what actually comes off a shop's machine: fields
 * quoted because a supplier name has a comma in it, doubled quotes inside
 * those, Windows line endings, and a trailing blank line.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  // Excel writes a BOM on "CSV UTF-8", and it would otherwise become part of
  // the first header — which is how "name" silently stops matching.
  const body = text.replace(/^﻿/, "");

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];

    if (quoted) {
      if (char !== '"') {
        cell += char;
      } else if (body[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = false;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }

  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((line) => line.some((value) => value.trim() !== ""));
}

const money = (value: string) => {
  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : NaN;
};

type Mapping = Partial<Record<FieldId, number>>;

type Checked = {
  values: Partial<Record<FieldId, string>>;
  errors: string[];
  warnings: string[];
};

export function ImportPanel({
  knownBarcodes,
  knownSkus,
}: {
  /** The codes the shop already carries, so a duplicate is named before the
   *  file is sent. The action checks again — this list is stale the moment
   *  somebody else adds an item. */
  knownBarcodes: string[];
  knownSkus: string[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  // One stem for the twelve column pickers. Each one is named by the heading
  // above it rather than wrapped in a `<label>` — a listbox is not a form
  // control, so a label around it would name nothing.
  const mapId = useId();

  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [body, setBody] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [problem, setProblem] = useState("");
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [sending, startImport] = useTransition();

  const loaded = body.length > 0;

  const takeFile = async (file: File | undefined) => {
    if (!file) return;
    setProblem("");
    setResult(null);

    if (/\.xlsx?$/i.test(file.name)) {
      return setProblem(
        "That is an Excel workbook. Open it and use File → Save As → CSV UTF-8, then upload that — a reader for .xlsx is 400 KB the counter tablet would carry forever for one screen.",
      );
    }

    const rows = parseCsv(await file.text());
    if (rows.length < 2) {
      return setProblem(
        "That file has a header row and nothing under it. Check you exported the right sheet.",
      );
    }

    const [head, ...rest] = rows;
    setFileName(file.name);
    setHeaders(head);
    setBody(rest);

    // Guessed, then shown. A mapping that is silently right nine times teaches
    // people to skip the step on the tenth, which is the one that puts cost in
    // the price column.
    const guess: Mapping = {};
    const taken = new Set<number>();

    for (const field of FIELDS) {
      const index = head.findIndex(
        (header, at) => !taken.has(at) && field.aliases.includes(normalise(header)),
      );
      if (index >= 0) {
        guess[field.id] = index;
        taken.add(index);
      }
    }

    setMapping(guess);
  };

  const reset = () => {
    setFileName("");
    setHeaders([]);
    setBody([]);
    setMapping({});
    setProblem("");
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const downloadTemplate = () => {
    const blob = new Blob([`﻿${TEMPLATE}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "flo-items-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const checked = useMemo<Checked[]>(() => {
    if (body.length === 0) return [];

    const codes = new Set(knownBarcodes);
    const skus = new Set(knownSkus);
    const seen = new Map<string, number>();
    const seenSku = new Map<string, number>();

    return body.map((row, index) => {
      const values: Partial<Record<FieldId, string>> = {};
      for (const field of FIELDS) {
        const at = mapping[field.id];
        if (at !== undefined) values[field.id] = (row[at] ?? "").trim();
      }

      const errors: string[] = [];
      const warnings: string[] = [];

      if (!values.name) errors.push("No name");

      const price = money(values.price ?? "");
      const cost = money(values.cost ?? "");

      if (!values.price) errors.push("No retail price");
      else if (!Number.isFinite(price) || price <= 0) errors.push("Price is not a number");

      if (values.cost && !Number.isFinite(cost)) errors.push("Cost is not a number");
      else if (!values.cost) warnings.push("No cost — profit will be blank for this item");
      else if (Number.isFinite(price) && cost > price) warnings.push("Costs more than it sells for");

      const barcode = values.barcode;
      if (barcode) {
        if (!/^\d{8}$|^\d{12,14}$/.test(barcode)) {
          warnings.push("Barcode is not a UPC or EAN length");
        }
        if (codes.has(barcode)) errors.push("Barcode already in your catalog");

        const first = seen.get(barcode);
        if (first !== undefined) errors.push(`Same barcode as row ${first + 1}`);
        else seen.set(barcode, index);
      }

      // The SKU carries a unique index of its own, so a repeat is refused by
      // the database rather than merged — and a row refused after the fact is a
      // row the owner has to go and find.
      const sku = values.sku;
      if (sku) {
        if (skus.has(sku)) errors.push("SKU already in your catalog");

        const first = seenSku.get(sku);
        if (first !== undefined) errors.push(`Same SKU as row ${first + 1}`);
        else seenSku.set(sku, index);
      }

      return { values, errors, warnings };
    });
  }, [body, mapping, knownBarcodes, knownSkus]);

  const missing = FIELDS.filter(
    (field) => field.required && mapping[field.id] === undefined,
  );

  const bad = checked.filter((row) => row.errors.length > 0).length;
  const warned = checked.filter(
    (row) => row.errors.length === 0 && row.warnings.length > 0,
  ).length;
  const clean = checked.length - bad - warned;
  const sendable = clean + warned;

  /**
   * Off it goes. A row with a warning is sent — a missing cost is a fact about
   * the shop's sheet, not a reason to lose the item. A row with an error is
   * not, because the server would only refuse it again.
   */
  const send = () => {
    const rows: ImportRow[] = checked
      .filter((row) => row.errors.length === 0)
      .map((row) => ({
        name: row.values.name,
        urdu: row.values.urdu,
        barcode: row.values.barcode,
        sku: row.values.sku,
        department: row.values.department,
        category: row.values.category,
        unit: row.values.unit,
        cost: row.values.cost,
        price: row.values.price,
        stock: row.values.stock,
        lowAt: row.values.lowAt,
        supplier: row.values.supplier,
      }));

    startImport(async () => {
      const answer = await importProducts(rows);
      setResult(answer);

      if (!answer.ok) {
        toast({ title: "Nothing was imported", detail: answer.error, tone: "bad" });
        return;
      }

      toast({
        title: `${answer.inserted.toLocaleString("en-PK")} ${
          answer.inserted === 1 ? "item" : "items"
        } imported`,
        detail:
          answer.skipped.length > 0
            ? `${answer.skipped.length} ${
                answer.skipped.length === 1 ? "row was" : "rows were"
              } skipped.`
            : null,
        tone: answer.skipped.length > 0 ? "warn" : "good",
      });
    });
  };

  if (result?.ok) {
    return <Landed result={result} onAgain={reset} />;
  }

  return (
    <div className="space-y-4">
      <Steps current={!loaded ? 1 : missing.length > 0 ? 2 : 3} />

      {!loaded ? (
        <ChartCard
          title="Bring your list in"
          caption="The sheet you already keep, however it is laid out."
        >
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void takeFile(event.dataTransfer.files[0]);
            }}
            className={`rounded-2xl border-2 border-dashed px-4 py-10 text-center transition-colors ${
              dragging ? "border-orchid-400 bg-orchid-50" : "border-orchid-100"
            }`}
          >
            <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-orchid-50 text-orchid-700">
              <IconUpload className="h-5 w-5" />
            </span>

            <p className="mt-3 font-display text-[0.9375rem] font-semibold text-graphite-900">
              Drop a CSV here
            </p>
            <p className="mx-auto mt-1 max-w-sm text-[0.8125rem] leading-relaxed text-graphite-700">
              Any column order. Urdu names are fine — save as CSV UTF-8 so the
              script survives the trip.
            </p>

            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="pos-btn pos-btn-primary"
              >
                Choose a file
              </button>
              <button
                type="button"
                onClick={downloadTemplate}
                className="pos-btn pos-btn-soft"
              >
                Download the template
              </button>
            </div>

            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,text/csv"
              className="sr-only"
              onChange={(event) => void takeFile(event.target.files?.[0])}
            />
          </div>

          {problem ? (
            <p className="mt-3 flex items-start gap-2 rounded-xl border border-orchid-100 bg-orchid-50/60 px-3.5 py-3 text-[0.8125rem] leading-relaxed text-graphite-700">
              <IconAlert className="mt-0.5 h-4 w-4 flex-none text-signal-warn" />
              {problem}
            </p>
          ) : null}

          <p className="pos-hint">
            Nothing is uploaded at this step — the file is read in the browser,
            so a 4,000-line list opens instantly and never leaves the tablet
            until you press Import.
          </p>
        </ChartCard>
      ) : (
        <>
          <ChartCard
            title="Match the columns"
            caption={`${fileName} · ${body.length} rows · ${headers.length} columns`}
            actions={
              <button type="button" onClick={reset} className="pos-btn pos-btn-soft pos-btn-sm">
                <IconClose className="h-3.5 w-3.5" />
                Different file
              </button>
            }
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FIELDS.map((field) => {
                const at = mapping[field.id];
                const sample = at === undefined ? "" : (body[0]?.[at] ?? "").trim();

                return (
                  <div key={field.id} className="block">
                    <span className="pos-label" id={`${mapId}-${field.id}`}>
                      {field.label}
                      {field.required ? (
                        <span className="text-signal-bad"> *</span>
                      ) : null}
                    </span>

                    <Select
                      value={at === undefined ? "" : String(at)}
                      onChange={(next) =>
                        setMapping((current) => ({
                          ...current,
                          [field.id]: next === "" ? undefined : Number(next),
                        }))
                      }
                      labelledBy={`${mapId}-${field.id}`}
                      options={[
                        { id: "", label: "— not in my sheet —" },
                        // Each column carries its own first value as a second
                        // line: a sheet whose headings are all "Column 3" is
                        // matched by what is under them, not by their names.
                        ...headers.map((header, index) => ({
                          id: String(index),
                          label: header.trim() || `Column ${index + 1}`,
                          description: (body[0]?.[index] ?? "").trim() || undefined,
                        })),
                      ]}
                    />

                    <p className="pos-hint truncate">
                      {sample ? `First row: ${sample}` : " "}
                    </p>
                  </div>
                );
              })}
            </div>

            {missing.length > 0 ? (
              <p className="mt-2 flex items-start gap-2 text-[0.8125rem] leading-relaxed text-signal-warn">
                <IconAlert className="mt-0.5 h-4 w-4 flex-none" />
                Still needed: {missing.map((field) => field.label).join(", ")}.
              </p>
            ) : null}
          </ChartCard>

          <ChartCard
            title="What will be written"
            caption="Mapped rows, checked. Not the raw sheet."
            bleed
            footer={
              <>
                <p className="mr-auto text-[0.75rem] text-graphite-500">
                  Everything comes in at 0% tax and on sale. Set the rate on the
                  items that need one afterwards — a rate list has no tax column
                  and a guess would print on receipts.
                </p>
                <button
                  type="button"
                  onClick={send}
                  disabled={sending || missing.length > 0 || sendable === 0}
                  className="pos-btn pos-btn-primary disabled:opacity-50"
                >
                  {sending
                    ? "Importing…"
                    : `Import ${sendable} ${sendable === 1 ? "item" : "items"}`}
                </button>
              </>
            }
          >
            <div className="flex flex-wrap gap-2 px-4 pb-3">
              <Tally label="ready" count={clean} tone="good" />
              <Tally label="with a warning" count={warned} tone="warn" />
              <Tally label="will be skipped" count={bad} tone="bad" />
            </div>

            {result && !result.ok ? (
              <p className="mx-4 mb-3 flex items-start gap-2 rounded-xl border border-orchid-100 bg-orchid-50/60 px-3.5 py-3 text-[0.8125rem] leading-relaxed text-signal-bad">
                <IconAlert className="mt-0.5 h-4 w-4 flex-none" />
                {result.error}
              </p>
            ) : null}

            <div className="overflow-x-auto">
              <table className="pos-table">
                <thead>
                  <tr>
                    <th className="text-right">#</th>
                    <th>Item</th>
                    <th className="hidden md:table-cell">Category</th>
                    <th className="text-right">Cost</th>
                    <th className="text-right">Price</th>
                    <th className="text-right">Stock</th>
                    <th>Check</th>
                  </tr>
                </thead>
                <tbody>
                  {checked.slice(0, 12).map((row, index) => (
                    <tr key={index}>
                      <td className="pos-num text-right text-graphite-500">
                        {index + 1}
                      </td>
                      <td>
                        <span className="block font-medium text-graphite-900">
                          {row.values.name || (
                            <span className="text-graphite-500">—</span>
                          )}
                        </span>
                        {row.values.barcode ? (
                          <span className="block font-mono text-[0.6875rem] text-graphite-500">
                            {row.values.barcode}
                          </span>
                        ) : null}
                      </td>
                      <td className="hidden text-graphite-700 md:table-cell">
                        {row.values.category || "—"}
                      </td>
                      <td className="pos-num text-right">{row.values.cost || "—"}</td>
                      <td className="pos-num text-right">{row.values.price || "—"}</td>
                      <td className="pos-num text-right">{row.values.stock || "—"}</td>
                      <td>
                        {row.errors.length > 0 ? (
                          <span className="pos-badge pos-badge-bad">
                            {row.errors[0]}
                          </span>
                        ) : row.warnings.length > 0 ? (
                          <span className="pos-badge pos-badge-warn">
                            {row.warnings[0]}
                          </span>
                        ) : (
                          <span className="pos-badge pos-badge-good">
                            <IconCheck className="h-3 w-3" />
                            Ready
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {checked.length > 12 ? (
              <p className="px-4 pt-3 text-[0.75rem] text-graphite-500">
                First 12 of {checked.length} rows. Every row is checked, not
                only the ones shown.
              </p>
            ) : null}
          </ChartCard>
        </>
      )}
    </div>
  );
}

/* ---------------- Pieces ---------------- */

/**
 * What landed.
 *
 * The skipped rows are listed by their place in the file and not by name,
 * because the owner is going to go back to the sheet on the other screen and
 * look at row 214 — a name they would have to search for is a name that costs
 * them the line.
 */
function Landed({
  result,
  onAgain,
}: {
  result: Extract<ImportResult, { ok: true }>;
  onAgain: () => void;
}) {
  const shown = result.skipped.slice(0, 25);

  return (
    <ChartCard
      title="Imported"
      caption={`${result.inserted.toLocaleString("en-PK")} ${
        result.inserted === 1 ? "item is" : "items are"
      } in your list.`}
      footer={
        <>
          <button type="button" onClick={onAgain} className="pos-btn pos-btn-soft">
            Import another file
          </button>
          <Link href="/app/inventory?tab=items" className="pos-btn pos-btn-primary">
            See the item list
          </Link>
        </>
      }
    >
      <p className="flex items-start gap-2 text-[0.875rem] leading-relaxed text-graphite-700">
        <IconCheck className="mt-0.5 h-4 w-4 flex-none text-signal-good" />
        They are on sale at the counter right away, at 0% tax. Set a rate and
        correct the units on the ones that need it — the till will ring them up
        either way.
      </p>

      {result.skipped.length > 0 ? (
        <div className="mt-4 rounded-xl border border-orchid-100">
          <p className="border-b border-orchid-100 px-3.5 py-2.5 text-[0.8125rem] font-semibold text-graphite-900">
            {result.skipped.length}{" "}
            {result.skipped.length === 1 ? "row was" : "rows were"} skipped
          </p>

          <ul className="divide-y divide-orchid-100">
            {shown.map((row) => (
              <li
                key={row.row}
                className="flex flex-wrap items-baseline gap-x-2 px-3.5 py-2 text-[0.8125rem]"
              >
                <span className="font-mono text-graphite-500">Row {row.row}</span>
                <span className="text-graphite-700">{row.reason}</span>
              </li>
            ))}
          </ul>

          {result.skipped.length > shown.length ? (
            <p className="border-t border-orchid-100 px-3.5 py-2 text-[0.75rem] text-graphite-500">
              The first {shown.length} of them. Fix these, export again, and the
              ones that already landed will be named as duplicates.
            </p>
          ) : null}
        </div>
      ) : null}
    </ChartCard>
  );
}

const STEPS = ["Pick the file", "Match the columns", "Check and import"];

function Steps({ current }: { current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      {STEPS.map((label, index) => {
        const at = index + 1;
        const done = at < current;
        const live = at === current;

        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`grid h-6 w-6 flex-none place-items-center rounded-lg font-display text-[0.6875rem] font-bold ${
                done || live ? "pos-stamp" : "bg-orchid-50 text-graphite-500"
              }`}
            >
              {done ? <IconCheck className="h-3.5 w-3.5" /> : at}
            </span>
            <span
              className={`text-[0.8125rem] font-semibold ${
                live ? "text-graphite-900" : "text-graphite-500"
              }`}
            >
              {label}
            </span>
            {at < STEPS.length ? (
              <span className="hidden h-px w-6 bg-orchid-100 sm:block" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function Tally({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "good" | "warn" | "bad";
}) {
  const badge =
    tone === "good" ? "pos-badge-good" : tone === "warn" ? "pos-badge-warn" : "pos-badge-bad";

  return (
    <span className={`pos-badge ${badge}`}>
      {count} {label}
    </span>
  );
}
