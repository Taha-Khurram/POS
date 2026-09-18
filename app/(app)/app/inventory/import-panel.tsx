"use client";

import Link from "next/link";
import { useId, useMemo, useRef, useState, useTransition } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import {
  IconAlert,
  IconCheck,
  IconClose,
  IconTag,
  IconUpload,
} from "@/components/pos/icons";
import { Select } from "@/components/pos/select-field";
import { useToast } from "@/components/pos/toaster";
import {
  IMPORT_MAX,
  TREE_NAME_MAX,
  treeName,
  type Department,
} from "@/lib/pos/catalog";
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
 * Which is why it is three steps rather than one "upload" button. The failure
 * that matters is not a rejected file; it is a file that imports cleanly with
 * the cost column read as the price. So the matching is shown, pre-guessed but
 * never hidden, and the preview is of *mapped* rows — what will be written —
 * not of the raw sheet.
 *
 * One decision per screen, and only the controls that decision needs. A step
 * carries a Back and one way forward; there is no second primary button
 * anywhere, because the owner on the phone with us has to be told "press the
 * purple one" and be right every time.
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
  { id: "cost", label: "Cost price", required: true, aliases: ["cost", "costprice", "purchase", "purchaseprice", "buying", "buyrate", "rate", "kharid"] },
  { id: "price", label: "Retail price", required: true, aliases: ["price", "retail", "retailprice", "sale", "saleprice", "selling", "sellingprice", "mrp"] },
  { id: "department", label: "Department", aliases: ["department", "dept", "group", "maincategory"] },
  { id: "category", label: "Category", aliases: ["category", "cat", "subcategory", "type"] },
  { id: "barcode", label: "Barcode", aliases: ["barcode", "ean", "upc", "code", "barcodeno"] },
  { id: "sku", label: "SKU", aliases: ["sku", "itemcode", "code2", "articlecode", "ref"] },
  { id: "stock", label: "Stock on hand", aliases: ["stock", "qty", "quantity", "onhand", "balance", "opening", "openingstock"] },
  { id: "unit", label: "Unit", aliases: ["unit", "uom", "units", "packing"] },
  { id: "urdu", label: "Urdu name", aliases: ["urdu", "urduname", "nameurdu", "localname"] },
  { id: "lowAt", label: "Low-stock alert", aliases: ["low", "lowstock", "reorder", "reorderlevel", "min", "minimum", "alert"] },
  { id: "supplier", label: "Supplier", aliases: ["supplier", "vendor", "party", "distributor", "company"] },
];

const REQUIRED = FIELDS.filter((field) => field.required);
/** The two that say where an item sits. Their own group, beside the control
 *  that answers for the rows they leave blank — one decision, one place. */
const TREE = FIELDS.filter((field) => field.id === "department" || field.id === "category");
const OPTIONAL = FIELDS.filter(
  (field) => !field.required && !TREE.includes(field),
);

const TEMPLATE = [
  "name,urdu,barcode,sku,department,category,unit,cost,price,stock,low_stock,supplier",
  'Coca-Cola 1.5 L,کوکا کولا,5449000000996,BEV-COL-1500,Beverages,Soft drinks,piece,148,180,64,24,Coca-Cola Icecek — Lahore',
  'Sugar — loose,چینی,,GRO-SUG-0001,Grocery,Sugar & salt,kg,142,165,84.5,25,"Ravi Trading, Akbari Mandi"',
  "Shan Biryani Masala 50 g,شان بریانی مصالحہ,8964000221471,GRO-SHA-0050,Grocery,Masala & spices,packet,88,110,120,36,Shan Foods",
].join("\n");

/** A file this size is not a rate list; it is a database export that would sit
 *  in the tablet's memory twice over while it parsed. */
const FILE_MAX = 6 * 1024 * 1024;

const normalise = (header: string) =>
  header.toLowerCase().replace(/[^a-z0-9]/g, "");

const lower = (value: string) => value.trim().toLowerCase();

/**
 * Which character separates the columns.
 *
 * A comma, usually — but Excel on a machine set to a European locale writes
 * semicolons, and a sheet pasted out of Word arrives tab-separated. Counted on
 * the header line only, where a quoted field is rare, so this is a count and
 * not a parse.
 */
function sniff(text: string): string {
  const [head = ""] = text.split(/\r?\n/, 1);

  return [",", ";", "\t", "|"].reduce((best, candidate) => {
    const count = head.split(candidate).length;
    return count > head.split(best).length ? candidate : best;
  }, ",");
}

/**
 * A CSV reader that survives what actually comes off a shop's machine: fields
 * quoted because a supplier name has a comma in it, doubled quotes inside
 * those, Windows line endings, and a trailing blank line.
 */
function parseCsv(text: string, delimiter: string): string[][] {
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
    else if (char === delimiter) {
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
  /** Where the row will actually be filed, after the sheet's own cell, the
   *  destination chosen below, and the length a tile can carry. */
  department: string;
  category: string;
  errors: string[];
  warnings: string[];
};

/** The option for "a department that does not exist yet". The empty string,
 *  which `TREE_NAME_MIN` guarantees is not a name any real department has. */
const NEW_DEPARTMENT = "";

export function ImportPanel({
  tree,
  knownBarcodes,
  knownSkus,
}: {
  /** The shop's departments and categories as they stand. What the file names
   *  beyond this is created by the import — shown here first, by name. */
  tree: Department[];
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

  const [step, setStep] = useState(1);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [body, setBody] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [problem, setProblem] = useState("");
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [sending, startImport] = useTransition();

  // Where a row with no department of its own goes. A shop with a tree starts
  // on its first department; a shop with none has to type one, and that is the
  // moment its register grid comes into existence.
  const [destPick, setDestPick] = useState(tree[0]?.name ?? NEW_DEPARTMENT);
  const [destFresh, setDestFresh] = useState("");

  const destination =
    destPick === NEW_DEPARTMENT ? treeName(destFresh) : destPick;

  const takeFile = async (file: File | undefined) => {
    if (!file) return;
    setProblem("");
    setResult(null);

    if (/\.xlsx?$/i.test(file.name)) {
      return setProblem(
        "That is an Excel workbook. Open it and use File → Save As → CSV UTF-8, then bring that in.",
      );
    }

    if (file.size > FILE_MAX) {
      return setProblem(
        "That file is too large to open on a tablet. Split it — one sheet per department is the usual way.",
      );
    }

    const text = await file.text();
    const rows = parseCsv(text, sniff(text));

    if (rows.length < 2) {
      return setProblem(
        "That file has a header row and nothing under it. Check you exported the right sheet.",
      );
    }

    const [head, ...rest] = rows;

    if (rest.length > IMPORT_MAX) {
      return setProblem(
        `That file has ${rest.length.toLocaleString("en-PK")} rows. Split it into files of ${IMPORT_MAX.toLocaleString("en-PK")} or fewer — one import that size times out halfway and leaves you guessing what landed.`,
      );
    }

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
    setStep(2);
  };

  const reset = () => {
    setStep(1);
    setFileName("");
    setHeaders([]);
    setBody([]);
    setMapping({});
    setProblem("");
    setResult(null);
    setOnlyProblems(false);
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

  /**
   * Every row as it will be written, with the tree it will be written into.
   *
   * The department is resolved here and not only on the server, because this is
   * the screen where it can still be changed. A file whose department column is
   * blank in ninety rows should say so before the import, not report ninety
   * skips afterwards.
   */
  const review = useMemo(() => {
    if (body.length === 0) {
      return {
        rows: [] as Checked[],
        blanks: 0,
        departments: [] as string[],
        categories: [] as string[],
      };
    }

    const codes = new Set(knownBarcodes);
    const skus = new Set(knownSkus);
    const seen = new Map<string, number>();
    const seenSku = new Map<string, number>();

    const held = new Map(tree.map((item) => [lower(item.name), item]));
    const freshDepartments = new Map<string, string>();
    const freshCategories = new Map<string, string>();

    const rows = body.map((row, index) => {
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

      // The sheet's own department, then the destination. A cell too long for a
      // tile is not truncated — it falls to the destination and says so, which
      // is a correction the owner can make in the sheet rather than a tile
      // reading "Imported dry goods and hou…" on the register forever.
      const cell = values.department ?? "";
      const own = treeName(cell);

      if (cell.trim() && !own) {
        warnings.push(`Department name is over ${TREE_NAME_MAX} characters — filed under ${destination || "the destination"}`);
      }

      const department = own || destination;

      if (!department) errors.push("No department — choose where these go");

      const catCell = values.category ?? "";
      const category = treeName(catCell);

      if (catCell.trim() && !category) {
        warnings.push("Category name is too long for a tile — filed under the department only");
      }

      if (department) {
        const key = lower(department);
        const known = held.get(key);
        if (!known && !freshDepartments.has(key)) freshDepartments.set(key, department);

        if (category) {
          const pair = `${key}/${lower(category)}`;
          const hasCategory = known?.categories.some(
            (item) => lower(item.name) === lower(category),
          );
          if (!hasCategory && !freshCategories.has(pair)) {
            freshCategories.set(pair, category);
          }
        }
      }

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

      return { values, department, category, errors, warnings };
    });

    return {
      rows,
      // How many rows have nothing in the department column. It is what decides
      // whether the destination below is a question at all — a file that files
      // every one of its own rows should not be asked one.
      blanks: rows.filter((row) => !treeName(row.values.department ?? "")).length,
      departments: [...freshDepartments.values()],
      categories: [...freshCategories.values()],
    };
  }, [body, mapping, destination, tree, knownBarcodes, knownSkus]);

  const checked = review.rows;

  const missing = REQUIRED.filter((field) => mapping[field.id] === undefined);

  const bad = checked.filter((row) => row.errors.length > 0).length;
  const warned = checked.filter(
    (row) => row.errors.length === 0 && row.warnings.length > 0,
  ).length;
  const clean = checked.length - bad - warned;
  const sendable = clean + warned;

  // Asked only when the file leaves it unanswered. A sheet with a department
  // on every row needs no destination, and a control that changes nothing is a
  // control that should not be on the screen.
  const needsDestination = review.blanks > 0;
  const ready = missing.length === 0 && (!needsDestination || destination !== "");

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
        // Resolved, not raw: what the preview said is what is sent. The action
        // reads it through the same `treeName` and creates what is missing.
        department: row.department,
        category: row.category,
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

  if (result?.ok) return <Landed result={result} onAgain={reset} />;

  return (
    <div className="space-y-4">
      <Steps current={step} onBack={setStep} />

      {step === 1 ? (
        <ChartCard title="Bring in your list">
          <label
            className="pos-drop"
            data-over={dragging ? "true" : undefined}
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
          >
            <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-orchid-50 text-orchid-700">
              <IconUpload className="h-5 w-5" />
            </span>

            <span className="mt-3 block font-display text-[0.9375rem] font-semibold text-graphite-900">
              Drop your CSV here, or tap to choose
            </span>
            <span className="mx-auto mt-1 block max-w-sm text-[0.8125rem] leading-relaxed text-graphite-700">
              Any column order. Save as CSV UTF-8 and Urdu names come through.
            </span>

            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv"
              className="sr-only"
              onChange={(event) => void takeFile(event.target.files?.[0])}
            />
          </label>

          {problem ? (
            <p className="pos-note pos-note-warn mt-3">
              <IconAlert className="mt-0.5 h-4 w-4 flex-none text-signal-warn" />
              {problem}
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="pos-hint">Nothing is sent until you press Import.</p>

            <button
              type="button"
              onClick={downloadTemplate}
              className="pos-btn pos-btn-quiet pos-btn-sm"
            >
              Download a template
            </button>
          </div>
        </ChartCard>
      ) : step === 2 ? (
        <ChartCard
          title="Match the columns"
          caption={`${fileName} · ${body.length.toLocaleString("en-PK")} rows`}
          actions={
            <button
              type="button"
              onClick={reset}
              className="pos-btn pos-btn-quiet pos-btn-sm"
            >
              <IconClose className="h-3.5 w-3.5" />
              Change file
            </button>
          }
          footer={
            <>
              {missing.length > 0 ? (
                <p className="mr-auto flex items-center gap-1.5 text-[0.8125rem] font-medium text-signal-warn">
                  <IconAlert className="h-4 w-4 flex-none" />
                  Still to match: {missing.map((field) => field.label).join(", ")}
                </p>
              ) : needsDestination && !destination ? (
                <p className="mr-auto flex items-center gap-1.5 text-[0.8125rem] font-medium text-signal-warn">
                  <IconAlert className="h-4 w-4 flex-none" />
                  Name the department these items go in
                </p>
              ) : null}

              <button
                type="button"
                onClick={() => setStep(3)}
                disabled={!ready}
                className="pos-btn pos-btn-primary disabled:opacity-50"
              >
                Check {body.length.toLocaleString("en-PK")} rows
              </button>
            </>
          }
        >
          <Group label="Flo needs these three">
            {REQUIRED.map((field) => (
              <Picker
                key={field.id}
                field={field}
                stem={mapId}
                headers={headers}
                first={body[0] ?? []}
                at={mapping[field.id]}
                onPick={(next) =>
                  setMapping((current) => ({ ...current, [field.id]: next }))
                }
              />
            ))}
          </Group>

          <Group label="Where they sit on the register">
            {TREE.map((field) => (
              <Picker
                key={field.id}
                field={field}
                stem={mapId}
                headers={headers}
                first={body[0] ?? []}
                at={mapping[field.id]}
                onPick={(next) =>
                  setMapping((current) => ({ ...current, [field.id]: next }))
                }
              />
            ))}
          </Group>

          {needsDestination ? (
            <Destination
              tree={tree}
              pick={destPick}
              fresh={destFresh}
              blanks={review.blanks}
              rows={body.length}
              onPick={setDestPick}
              onFresh={setDestFresh}
            />
          ) : null}

          <Group label="Bring these across too, if the sheet has them">
            {OPTIONAL.map((field) => (
              <Picker
                key={field.id}
                field={field}
                stem={mapId}
                headers={headers}
                first={body[0] ?? []}
                at={mapping[field.id]}
                onPick={(next) =>
                  setMapping((current) => ({ ...current, [field.id]: next }))
                }
              />
            ))}
          </Group>
        </ChartCard>
      ) : (
        <ChartCard
          title="Check and import"
          caption={`${sendable.toLocaleString("en-PK")} of ${checked.length.toLocaleString("en-PK")} rows will be brought in, at 0% tax and on sale.`}
          actions={
            <button
              type="button"
              onClick={reset}
              className="pos-btn pos-btn-quiet pos-btn-sm"
            >
              <IconClose className="h-3.5 w-3.5" />
              Change file
            </button>
          }
          bleed
          footer={
            <>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="mr-auto pos-btn pos-btn-quiet"
              >
                Back to matching
              </button>

              <button
                type="button"
                onClick={send}
                disabled={sending || !ready || sendable === 0}
                className="pos-btn pos-btn-primary disabled:opacity-50"
              >
                {sending
                  ? "Importing…"
                  : `Import ${sendable.toLocaleString("en-PK")} ${sendable === 1 ? "item" : "items"}`}
              </button>
            </>
          }
        >
          <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
            <Tally label="ready" count={clean} tone="good" />
            {warned > 0 ? <Tally label="with a warning" count={warned} tone="warn" /> : null}
            {bad > 0 ? <Tally label="will be skipped" count={bad} tone="bad" /> : null}

            {bad + warned > 0 ? (
              <button
                type="button"
                onClick={() => setOnlyProblems((on) => !on)}
                className="pos-btn pos-btn-quiet pos-btn-sm ml-auto"
              >
                {onlyProblems ? "Show every row" : "Show only the problems"}
              </button>
            ) : null}
          </div>

          {review.departments.length > 0 || review.categories.length > 0 ? (
            <p className="pos-note mx-4 mb-3">
              <IconTag className="mt-0.5 h-4 w-4 flex-none text-orchid-700" />
              <span>
                {review.departments.length > 0 ? (
                  <>
                    <strong className="font-semibold text-graphite-900">
                      {review.departments.length === 1
                        ? "One new department"
                        : `${review.departments.length} new departments`}
                    </strong>{" "}
                    will be added to your tree: {list(review.departments)}.
                  </>
                ) : null}
                {review.categories.length > 0 ? (
                  <>
                    {review.departments.length > 0 ? " " : null}
                    {review.categories.length === 1
                      ? "One new category"
                      : `${review.categories.length} new categories`}{" "}
                    under them: {list(review.categories)}.
                  </>
                ) : null}
              </span>
            </p>
          ) : null}

          {result && !result.ok ? (
            <p className="pos-note pos-note-bad mx-4 mb-3 text-signal-bad">
              <IconAlert className="mt-0.5 h-4 w-4 flex-none" />
              {result.error}
            </p>
          ) : null}

          <Preview rows={checked} onlyProblems={onlyProblems && bad + warned > 0} />
        </ChartCard>
      )}
    </div>
  );
}

/* ---------------- Pieces ---------------- */

/** Up to five names, then a count. A note is a sentence, not a list of forty. */
function list(names: string[]): string {
  if (names.length <= 5) return names.join(", ");
  return `${names.slice(0, 5).join(", ")} and ${names.length - 5} more`;
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 last:mb-0">
      <h3 className="pos-label mb-2">{label}</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

/**
 * One column picked for one field.
 *
 * Each option carries that column's first value as a second line: a sheet whose
 * headings are all "Column 3" is matched by what is under them, not by names
 * that say nothing.
 */
function Picker({
  field,
  stem,
  headers,
  first,
  at,
  onPick,
}: {
  field: (typeof FIELDS)[number];
  stem: string;
  headers: string[];
  first: string[];
  at: number | undefined;
  onPick: (next: number | undefined) => void;
}) {
  const sample = at === undefined ? "" : (first[at] ?? "").trim();

  return (
    <div>
      <span className="pos-label" id={`${stem}-${field.id}`}>
        {field.label}
      </span>

      <Select
        value={at === undefined ? "" : String(at)}
        onChange={(next) => onPick(next === "" ? undefined : Number(next))}
        labelledBy={`${stem}-${field.id}`}
        placeholder={field.required ? "Pick a column" : "Not in my sheet"}
        options={[
          // A required field is not offered a way to be empty. Nothing is
          // gained by clearing one — the next screen would only refuse it —
          // and an empty option on a list of three is an invitation to it.
          ...(field.required ? [] : [{ id: "", label: "Not in my sheet" }]),
          ...headers.map((header, index) => ({
            id: String(index),
            label: header.trim() || `Column ${index + 1}`,
            description: (first[index] ?? "").trim() || undefined,
          })),
        ]}
      />

      <p className="pos-hint truncate">{sample ? `First row: ${sample}` : " "}</p>
    </div>
  );
}

/**
 * Where the items land.
 *
 * The one control on this screen that is not a column. Since a shop's tree
 * starts empty, an import with no department is an import with nowhere to put
 * anything — so this is asked plainly, once, rather than four hundred times as
 * a skipped row. A file that carries its own department column only falls back
 * here for the rows that left it blank.
 */
function Destination({
  tree,
  pick,
  fresh,
  blanks,
  rows,
  onPick,
  onFresh,
}: {
  tree: Department[];
  pick: string;
  fresh: string;
  /** How many rows are waiting on this answer. */
  blanks: number;
  rows: number;
  onPick: (next: string) => void;
  onFresh: (next: string) => void;
}) {
  const id = useId();
  const typing = pick === NEW_DEPARTMENT || tree.length === 0;

  return (
    <section className="mb-4 rounded-xl border border-dashed border-orchid-200 p-3.5">
      <span className="pos-label" id={id}>
        {blanks === rows
          ? "File every item under"
          : `File the ${blanks.toLocaleString("en-PK")} rows with no department under`}
      </span>

      <div className="grid gap-3 sm:grid-cols-2">
        {tree.length > 0 ? (
          <Select
            value={pick}
            onChange={onPick}
            labelledBy={id}
            options={[
              ...tree.map((department) => ({
                id: department.name,
                label: department.name,
                meta: department.items || undefined,
              })),
              { id: NEW_DEPARTMENT, label: "A new department…" },
            ]}
          />
        ) : null}

        {typing ? (
          <input
            type="text"
            value={fresh}
            onChange={(event) => onFresh(event.target.value)}
            maxLength={TREE_NAME_MAX}
            placeholder="Hardware, Cloth, Medicines…"
            aria-label="New department name"
            className="pos-field"
          />
        ) : null}
      </div>

      <p className="pos-hint">
        Departments your sheet names that you do not have yet are added for you.
      </p>
    </section>
  );
}

/**
 * The rows as they will be written.
 *
 * Twelve of them, or every row with something wrong with it — which is the list
 * the owner actually wants when a file is half broken, and the reason the
 * filter is here rather than a scroll through four hundred good rows.
 */
function Preview({
  rows,
  onlyProblems,
}: {
  rows: Checked[];
  onlyProblems: boolean;
}) {
  const numbered = rows.map((row, index) => ({ row, at: index + 1 }));
  const chosen = onlyProblems
    ? numbered.filter(({ row }) => row.errors.length > 0 || row.warnings.length > 0)
    : numbered;

  const shown = chosen.slice(0, onlyProblems ? 50 : 12);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="pos-table">
          <thead>
            <tr>
              <th className="text-right">#</th>
              <th>Item</th>
              <th className="hidden md:table-cell">Goes in</th>
              <th className="hidden text-right sm:table-cell">Cost</th>
              <th className="text-right">Price</th>
              <th className="hidden text-right sm:table-cell">Stock</th>
              <th>Check</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ row, at }) => (
              <tr key={at}>
                <td className="pos-num text-right text-graphite-500">{at}</td>
                <td>
                  <span className="block font-medium text-graphite-900">
                    {row.values.name || <span className="text-graphite-500">—</span>}
                  </span>
                  {row.values.barcode ? (
                    <span className="block font-mono text-[0.6875rem] text-graphite-500">
                      {row.values.barcode}
                    </span>
                  ) : null}
                </td>
                <td className="hidden text-graphite-700 md:table-cell">
                  {row.department || "—"}
                  {row.category ? (
                    <span className="block text-[0.6875rem] text-graphite-500">
                      {row.category}
                    </span>
                  ) : null}
                </td>
                <td className="pos-num hidden text-right sm:table-cell">
                  {row.values.cost || "—"}
                </td>
                <td className="pos-num text-right">{row.values.price || "—"}</td>
                <td className="pos-num hidden text-right sm:table-cell">
                  {row.values.stock || "—"}
                </td>
                <td>
                  {row.errors.length > 0 ? (
                    <span className="pos-badge pos-badge-bad">{row.errors[0]}</span>
                  ) : row.warnings.length > 0 ? (
                    <span className="pos-badge pos-badge-warn">{row.warnings[0]}</span>
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

      {chosen.length > shown.length ? (
        <p className="px-4 pt-3 text-[0.75rem] text-graphite-500">
          {shown.length} of {chosen.length.toLocaleString("en-PK")} rows shown.
          Every row is checked, not only the ones here.
        </p>
      ) : null}

      {chosen.length === 0 ? (
        <p className="px-4 py-6 text-center text-[0.8125rem] text-graphite-500">
          Nothing wrong with any row.
        </p>
      ) : null}
    </>
  );
}

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
      } in your list, on sale at the counter.`}
      footer={
        <>
          <button type="button" onClick={onAgain} className="mr-auto pos-btn pos-btn-quiet">
            Import another file
          </button>
          <Link href="/app/inventory?tab=items" className="pos-btn pos-btn-primary">
            See the item list
          </Link>
        </>
      }
    >
      {result.added.departments.length > 0 ? (
        <p className="pos-note mb-3">
          <IconTag className="mt-0.5 h-4 w-4 flex-none text-orchid-700" />
          <span>
            Added to your tree: {list(result.added.departments)}
            {result.added.categories.length > 0
              ? `, and ${result.added.categories.length} ${
                  result.added.categories.length === 1 ? "category" : "categories"
                } under them`
              : ""}
            .
          </span>
        </p>
      ) : null}

      <p className="flex items-start gap-2 text-[0.875rem] leading-relaxed text-graphite-700">
        <IconCheck className="mt-0.5 h-4 w-4 flex-none text-signal-good" />
        Everything came in at 0% tax. Set a rate and correct the units on the
        ones that need it — the till will ring them up either way.
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

/**
 * Three stops on one rail.
 *
 * A finished step is a button and goes back to it; an unreached one is not,
 * because jumping forward past a decision is how the cost column ends up in the
 * price. Forward is always the one primary button at the foot of the card.
 */
function Steps({
  current,
  onBack,
}: {
  current: number;
  onBack: (step: number) => void;
}) {
  return (
    <ol className="pos-steps" aria-label="Import steps">
      {STEPS.map((label, index) => {
        const at = index + 1;
        const done = at < current;
        const live = at === current;

        // Only a step that can be returned to without losing anything is a
        // button. Going back to step one means a different file, which drops
        // the matching — so that one is asked for by name, in the card's own
        // header, and never by a stray tap on a rail.
        const walkable = done && at > 1;

        const inner = (
          <>
            <span className="pos-step-dot">
              {done ? <IconCheck className="h-4 w-4" /> : at}
            </span>
            <span className="pos-step-label">{label}</span>
          </>
        );

        return (
          <li
            key={label}
            className="pos-step"
            data-state={done ? "done" : live ? "live" : "next"}
            aria-current={live ? "step" : undefined}
          >
            {walkable ? (
              <button
                type="button"
                className="pos-step-hit"
                onClick={() => onBack(at)}
              >
                {inner}
              </button>
            ) : (
              <span className="pos-step-hit">{inner}</span>
            )}
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
      {count.toLocaleString("en-PK")} {label}
    </span>
  );
}
