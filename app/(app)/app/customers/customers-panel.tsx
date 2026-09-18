"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import { DataTable, type Column } from "@/components/pos/data-table";
import {
  IconChevron,
  IconClose,
  IconPlus,
  IconSearch,
  IconUser,
} from "@/components/pos/icons";
import { Select, type SelectOption } from "@/components/pos/select-field";
import {
  initialsOf,
  matchesCustomer,
  writePhone,
  type Customer,
} from "@/lib/pos/customer";
import { CustomerSheet } from "./customer-sheet";

/**
 * The customer list.
 *
 * Client, for the reason the item list is: a shopkeeper looking somebody up
 * types three digits of a phone number and expects the row, and a round trip
 * per keystroke over shop 3G makes the box feel broken. A shop's list is
 * hundreds of rows, not thousands — it filters in a frame.
 *
 * Search matches the phone on its digits alone, so "0300 1234" finds
 * `03001234567`: a cashier reading a number off the customer's own screen types
 * the spaces that are printed on it. The matcher is `matchesCustomer`, shared
 * with the till, so somebody the owner can find is somebody the cashier can
 * find.
 *
 * The name goes to the customer's record rather than opening the editor,
 * because the question being asked of this screen is nearly always "what have
 * they bought" and only occasionally "fix their number". The pencil at the end
 * of the row is the editor.
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
    match: (customer: Customer) => !customer.phone,
  },
  {
    id: "off",
    label: "Switched off",
    note: "The till cannot find them",
    match: (customer: Customer) => !customer.isActive,
  },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

const filterBy = (id: FilterId) =>
  FILTERS.find((entry) => entry.id === id) ?? FILTERS[0];

/**
 * A function rather than a const, because the last cell is the control that
 * opens the editor and it needs the caller's setter.
 */
const columnsFor = (onEdit: (customer: Customer) => void): Column<Customer>[] => [
  {
    key: "customer",
    header: "Customer",
    cell: (customer) => (
      <Link
        href={`/app/customers?customer=${customer.id}`}
        className="flex w-full items-center gap-2.5 text-left"
      >
        <span
          className="grid h-8 w-8 flex-none place-items-center rounded-full bg-orchid-50 font-display text-[0.6875rem] font-bold text-orchid-700"
          aria-hidden
        >
          {initialsOf(customer.name)}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium text-graphite-900 underline-offset-2 hover:underline">
            {customer.name}
            {customer.isActive ? null : (
              <span className="pos-badge pos-badge-warn ml-2 align-middle">Off</span>
            )}
          </span>
          <span className="block truncate font-mono text-[0.6875rem] text-graphite-500">
            {writePhone(customer.phone) || "no number"}
          </span>
        </span>
      </Link>
    ),
  },
  {
    key: "where",
    header: "Where",
    hideBelow: "md",
    cell: (customer) => (
      <span className="block max-w-[16rem] truncate text-graphite-700">
        {customer.address || <span className="text-graphite-500">—</span>}
      </span>
    ),
  },
  {
    key: "email",
    header: "Email",
    hideBelow: "lg",
    cell: (customer) => (
      <span className="block max-w-[14rem] truncate text-graphite-700">
        {customer.email || <span className="text-graphite-500">—</span>}
      </span>
    ),
  },
  {
    key: "note",
    header: "Note",
    hideBelow: "lg",
    cell: (customer) => (
      <span className="block max-w-[18rem] truncate text-graphite-700">
        {customer.notes || <span className="text-graphite-500">—</span>}
      </span>
    ),
  },
  {
    key: "open",
    header: "",
    align: "end",
    cell: (customer) => (
      <button
        type="button"
        onClick={() => onEdit(customer)}
        className="pos-icon-btn"
        aria-label={`Edit ${customer.name}`}
      >
        <IconChevron className="h-4 w-4 -rotate-90" />
      </button>
    ),
  },
];

export function CustomersPanel({ customers }: { customers: Customer[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterId>("all");

  // Null is closed, a customer is the editor, and `"new"` is the empty sheet.
  // One piece of state rather than two, so the two cannot both be true.
  const [editing, setEditing] = useState<Customer | "new" | null>(null);

  // The row the sheet is open on, re-read from the list the server just sent.
  // Without this the sheet would go on showing the values it was opened with
  // after a save. It falls back to the row as it was opened, which is the
  // moment after a delete: the list comes back without it a frame before the
  // sheet closes itself, and without the fallback that frame would redraw the
  // editor as an empty Add-a-customer form.
  const open =
    editing && editing !== "new"
      ? (customers.find((entry) => entry.id === editing.id) ?? editing)
      : null;

  const rows = useMemo(
    () =>
      customers.filter(
        (customer) =>
          filterBy(filter).match(customer) && matchesCustomer(customer, query),
      ),
    [customers, query, filter],
  );

  const columns = useMemo(() => columnsFor(setEditing), []);

  const filterOptions: SelectOption[] = useMemo(
    () =>
      FILTERS.map((entry) => ({
        id: entry.id,
        label: entry.label,
        description: entry.note,
        meta: customers.filter(entry.match).length.toLocaleString("en-PK"),
      })),
    [customers],
  );

  return (
    <>
      <ChartCard
        title="Customers"
        caption={
          rows.length === customers.length
            ? `${customers.length} on the list`
            : `${rows.length} of ${customers.length}`
        }
        bleed
        actions={
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="pos-btn pos-btn-primary"
          >
            <IconPlus className="h-4 w-4" />
            Add customer
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
              placeholder="Name, phone, or anything in the note"
              aria-label="Search the customer list"
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

          {/* Three options, so the dropdown is the control rather than a menu
              in front of one — the item list needs a popover because it has two
              lists and five states; this screen has one. */}
          <div className="w-[12rem] flex-none">
            <Select
              value={filter}
              onChange={(next) => setFilter(next as FilterId)}
              options={filterOptions}
              label="Narrow the customer list"
            />
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(customer) => customer.id}
          empty={
            customers.length === 0
              ? "Nobody on the list yet. Add the regular who was in this morning — a name and a number is the whole of it."
              : query
                ? `Nobody matches “${query.trim()}”. Check the spelling, or add them as a new customer.`
                : "Nobody under this filter."
          }
        />
      </ChartCard>

      {editing ? (
        <CustomerSheet customer={open} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}

/**
 * The editor, opened from somewhere that is not the table — the record screen's
 * own Edit button.
 *
 * A component of its own rather than lifting the sheet's state into the page,
 * because the page is a server component and the sheet is a modal: this is the
 * smallest possible client leaf that can hold "is it open".
 */
export function EditCustomerButton({ customer }: { customer: Customer }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pos-btn pos-btn-soft pos-btn-sm"
      >
        <IconUser className="h-4 w-4" />
        Edit details
      </button>

      {open ? (
        <CustomerSheet customer={customer} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
