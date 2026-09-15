"use client";

import { useMemo, useRef, useState } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import {
  IconAlert,
  IconCheck,
  IconClose,
  IconUpload,
} from "@/components/pos/icons";
import { SAMPLE_ITEMS } from "@/lib/pos/catalog";

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
 * The parse and every check below are real. Only the last step is missing.
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
  const body = text.replace(/^\uFEFF/, "");

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

export function ImportPanel() {
  const fileRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [body, setBody] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [problem, setProblem] = useState("");
  const [dragging, setDragging] = useState(false);

  const loaded = body.length > 0;

  const takeFile = async (file: File | undefined) => {
    if (!file) return;
    setProblem("");

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
    if (fileRef.current) fileRef.current.value = "";
  };

  const downloadTemplate = () => {
    const blob = new Blob([`\uFEFF${TEMPLATE}`], {
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

    const known = new Set(
      SAMPLE_ITEMS.map((item) => item.barcode).filter(Boolean) as string[],
    );
    const seen = new Map<string, number>();

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
        if (known.has(barcode)) errors.push("Barcode already in your catalog");

        const first = seen.get(barcode);
        if (first !== undefined) errors.push(`Same barcode as row ${first + 1}`);
        else seen.set(barcode, index);
      }

      return { values, errors, warnings };
    });
  }, [body, mapping]);

  const missing = FIELDS.filter(
    (field) => field.required && mapping[field.id] === undefined,
  );

  const bad = checked.filter((row) => row.errors.length > 0).length;
  const warned = checked.filter(
    (row) => row.errors.length === 0 && row.warnings.length > 0,
  ).length;
  const clean = checked.length - bad - warned;

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
                  <label key={field.id} className="block">
                    <span className="pos-label">
                      {field.label}
                      {field.required ? (
                        <span className="text-signal-bad"> *</span>
                      ) : null}
                    </span>

                    <select
                      className="pos-field"
                      value={at ?? ""}
                      onChange={(event) =>
                        setMapping((current) => ({
                          ...current,
                          [field.id]:
                            event.target.value === ""
                              ? undefined
                              : Number(event.target.value),
                        }))
                      }
                    >
                      <option value="">— not in my sheet —</option>
                      {headers.map((header, index) => (
                        <option key={`${header}-${index}`} value={index}>
                          {header.trim() || `Column ${index + 1}`}
                        </option>
                      ))}
                    </select>

                    <p className="pos-hint truncate">
                      {sample ? `First row: ${sample}` : "\u00a0"}
                    </p>
                  </label>
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
                  Import writes nothing yet — Part 3 builds the{" "}
                  <code>items</code> table behind it.
                </p>
                <button
                  type="button"
                  className="pos-btn pos-btn-primary"
                  disabled
                >
                  Import {clean + warned} {clean + warned === 1 ? "item" : "items"}
                </button>
              </>
            }
          >
            <div className="flex flex-wrap gap-2 px-4 pb-3">
              <Tally label="ready" count={clean} tone="good" />
              <Tally label="with a warning" count={warned} tone="warn" />
              <Tally label="will be skipped" count={bad} tone="bad" />
            </div>

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
