"use client";

import { useMemo, useState } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import { DataTable, type Column } from "@/components/pos/data-table";
import {
  IconChevron,
  IconClose,
  IconPlus,
  IconSearch,
} from "@/components/pos/icons";
import { Select, type SelectOption } from "@/components/pos/select-field";
import { initialsOf, writePhone } from "@/lib/pos/customer";
import {
  foldName,
  matchesSupplier,
  writeTerms,
  type Supplier,
} from "@/lib/pos/supplier";
import { SupplierSheet } from "./supplier-sheet";

/**
 * The supplier list.
 *
 * Client, for the reason the item and customer lists are: a shop has tens of
 * suppliers, not thousands, and filtering in a frame beats a round trip per
 * keystroke over shop 3G. The matcher is `matchesSupplier`, shared with every
 * picker that offers one, so a distributor the owner can find is one the
 * manager can find — which is the duplication `0027` existed to undo.
 *
 * Unlike the customer list there is no separate record screen behind a name
 * yet, so the name opens the editor directly. A supplier's record — what was
 * ordered, what arrived, what is owed — arrives with the ledger.
 */

/**
 * The cuts worth having, each with the test that decides it.
 *
 * The predicate sits beside the label rather than in a switch inside the
 * filter, so the count in the menu and the rows you get for pressing it cannot
 * drift apart.
 */
const FILTERS = [
  {
    id: "all",
    label: "Everyone",
    note: "No filter",
    match: () => true,
  },
  {
    id: "nophone",
    label: "No phone number",
    note: "Nothing to reach them on",
    match: (supplier: Supplier) => !supplier.phone,
  },
  {
    id: "unused",
    label: "Supplying nothing",
    note: "No item names them",
    match: (supplier: Supplier) => supplier.items === 0,
  },
  {
    id: "off",
    label: "Switched off",
    note: "Out of every picker",
    match: (supplier: Supplier) => !supplier.isActive,
  },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

const filterBy = (id: FilterId) =>
  FILTERS.find((entry) => entry.id === id) ?? FILTERS[0];

/**
 * A function rather than a const, because the name cell is the control that
 * opens the editor. The button is the name itself: a row with one small pencil
 * at the end of it is a target nobody hits on a tablet.
 */
const columnsFor = (onEdit: (supplier: Supplier) => void): Column<Supplier>[] => [
  {
    key: "supplier",
    header: "Supplier",
    cell: (supplier) => (
      <button
        type="button"
        onClick={() => onEdit(supplier)}
        className="flex w-full items-center gap-2.5 text-left"
      >
        <span
          className="grid h-8 w-8 flex-none place-items-center rounded-full bg-orchid-50 font-display text-[0.6875rem] font-bold text-orchid-700"
          aria-hidden
        >
          {initialsOf(supplier.name)}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium text-graphite-900 underline-offset-2 hover:underline">
            {supplier.name}
            {supplier.isActive ? null : (
              <span className="pos-badge pos-badge-warn ml-2 align-middle">Off</span>
            )}
          </span>
          <span className="block truncate font-mono text-[0.6875rem] text-graphite-500">
            {writePhone(supplier.phone) || "no number"}
          </span>
        </span>
      </button>
    ),
  },
  {
    key: "contact",
    header: "Who you ring",
    hideBelow: "md",
    cell: (supplier) => (
      <span className="block max-w-[12rem] truncate text-graphite-700">
        {supplier.contactName || <span className="text-graphite-500">—</span>}
      </span>
    ),
  },
  {
    key: "items",
    header: "Items",
    align: "end",
    cell: (supplier) =>
      supplier.items > 0 ? (
        <span className="tabular-nums text-graphite-900">
          {supplier.items.toLocaleString("en-PK")}
        </span>
      ) : (
        <span className="text-graphite-500">—</span>
      ),
  },
  {
    key: "terms",
    header: "Terms",
    hideBelow: "md",
    cell: (supplier) => (
      <span className="text-graphite-700">{writeTerms(supplier.paymentTermsDays)}</span>
    ),
  },
  {
    key: "where",
    header: "Where",
    hideBelow: "lg",
    cell: (supplier) => (
      <span className="block max-w-[16rem] truncate text-graphite-700">
        {supplier.address || <span className="text-graphite-500">—</span>}
      </span>
    ),
  },
  {
    key: "open",
    header: "",
    align: "end",
    cell: (supplier) => (
      <button
        type="button"
        onClick={() => onEdit(supplier)}
        className="pos-icon-btn"
        aria-label={`Edit ${supplier.name}`}
      >
        <IconChevron className="h-4 w-4 -rotate-90" />
      </button>
    ),
  },
];

export function SuppliersPanel({ suppliers }: { suppliers: Supplier[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterId>("all");

  // Null is closed, a supplier is the editor, and `"new"` is the empty sheet.
  // One piece of state rather than two, so the two cannot both be true.
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);

  // The row the sheet is open on, re-read from the list the server just sent.
  // Without this the sheet would go on showing the values it was opened with
  // after a save. It falls back to the row as it was opened, which is the
  // moment after a delete: the list comes back without it a frame before the
  // sheet closes itself, and without the fallback that frame would redraw the
  // editor as an empty Add-a-supplier form.
  const open =
    editing && editing !== "new"
      ? (suppliers.find((entry) => entry.id === editing.id) ?? editing)
      : null;

  const rows = useMemo(
    () =>
      suppliers.filter(
        (supplier) =>
          filterBy(filter).match(supplier) && matchesSupplier(supplier, query),
      ),
    [suppliers, query, filter],
  );

  const columns = useMemo(() => columnsFor(setEditing), []);

  const filterOptions: SelectOption[] = useMemo(
    () =>
      FILTERS.map((entry) => ({
        id: entry.id,
        label: entry.label,
        description: entry.note,
        meta: suppliers.filter(entry.match).length.toLocaleString("en-PK"),
      })),
    [suppliers],
  );

  // Every name already on the list, folded the way the unique index folds it.
  // The sheet warns on a clash before the save — the index is still the
  // control, and the action turns its 23505 into the same sentence.
  const taken = useMemo(
    () => suppliers.map((supplier) => foldName(supplier.name)),
    [suppliers],
  );

  return (
    <>
      <ChartCard
        title="Suppliers"
        caption={
          rows.length === suppliers.length
            ? `${suppliers.length} on the list`
            : `${rows.length} of ${suppliers.length}`
        }
        bleed
        actions={
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="pos-btn pos-btn-primary"
          >
            <IconPlus className="h-4 w-4" />
            Add supplier
          </button>
        }
      >
        <div className="flex items-center gap-2 px-4 pb-3">
          {/* A div and not a label, because of the × inside it: a click on a
              button nested in a label is forwarded to the labelled control as
              well, and the box would take focus back off the button that had
              just been pressed. */}
          <div className="relative min-w-0 flex-1">
            <IconSearch className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-graphite-500" />
            <input
              className="pos-field pr-9 pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, contact, phone, or anything in the note"
              aria-label="Search the supplier list"
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

          <div className="w-[12rem] flex-none">
            <Select
              value={filter}
              onChange={(next) => setFilter(next as FilterId)}
              options={filterOptions}
              label="Narrow the supplier list"
            />
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(supplier) => supplier.id}
          empty={
            suppliers.length === 0
              ? "Nobody on the list yet. Add the distributor whose van comes on Tuesday — the name on his invoice is the whole of it."
              : query
                ? `Nobody matches “${query.trim()}”. Check the spelling, or add them as a new supplier.`
                : "Nobody under this filter."
          }
        />
      </ChartCard>

      {editing ? (
        <SupplierSheet supplier={open} taken={taken} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}
