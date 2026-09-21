"use client";

import { useActionState, useState } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import { IconCheck, IconPlus, IconTrash } from "@/components/pos/icons";
import { useActionToast } from "@/components/pos/toaster";
import { useSubmissionKey } from "@/components/pos/use-submission-key";
import {
  AREA_MAX,
  checkTable,
  SEATS_MAX,
  TABLE_NAME_MAX,
  type DiningTable,
} from "@/lib/pos/restaurant";
import { deleteTable, saveTable } from "./table-actions";
import { IDLE } from "./save-bar";

/**
 * The floor, laid out.
 *
 * A list of small forms rather than a drag-and-drop plan, and deliberately: a
 * shop knows its tables by name and section, and a graphical floor plan is
 * twenty minutes of somebody dragging rectangles to arrive at what four text
 * boxes give them in two.
 *
 * **A table with a bill against it cannot be deleted**, only switched off. The
 * action refuses it and says why — `table_orders.table_id` is
 * `on delete set null`, so removing one would detach every meal ever eaten at
 * it from where it happened.
 */
export function TablesPanel({
  tables,
  readOnly,
}: {
  tables: DiningTable[];
  /** A manager sees this and cannot change it. Presentation only — the action
   *  checks the role again for itself, the same call every panel here makes. */
  readOnly: boolean;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-4">
      <ChartCard
        title="Tables"
        caption={
          tables.length === 0
            ? "None yet"
            : `${tables.filter((table) => table.isActive).length} on the map, ${tables.length} in all`
        }
        actions={
          readOnly ? null : (
            <button
              type="button"
              onClick={() => setAdding((open) => !open)}
              className="pos-btn pos-btn-primary"
            >
              <IconPlus className="h-4 w-4" />
              Add a table
            </button>
          )
        }
      >
        <div className="space-y-2 px-4 pb-4">
          {tables.length === 0 && !adding ? (
            <p className="rounded-2xl border border-dashed border-orchid-200 px-4 py-5 text-center text-[0.8125rem] leading-relaxed text-graphite-500">
              No tables yet. Add them the way you would point at them — a name a
              waiter can call out, which part of the shop they are in, and how
              many they seat.
            </p>
          ) : null}

          {adding ? (
            <TableForm key="new" table={null} onDone={() => setAdding(false)} />
          ) : null}

          {tables.map((table) => (
            <TableForm key={table.id} table={table} readOnly={readOnly} />
          ))}
        </div>
      </ChartCard>
    </div>
  );
}

function TableForm({
  table,
  readOnly = false,
  onDone,
}: {
  table: DiningTable | null;
  readOnly?: boolean;
  onDone?: () => void;
}) {
  const [state, action, pending] = useActionState(saveTable, IDLE);
  const [removal, removeAction, removing] = useActionState(deleteTable, IDLE);
  const submission = useSubmissionKey(state);

  useActionToast(state, {
    saved: table ? `${table.name} saved` : "Table added",
    failed: "That table did not save",
  });

  useActionToast(removal, {
    saved: "Table removed",
    failed: "That table was not removed",
  });

  const [name, setName] = useState(table?.name ?? "");
  const [area, setArea] = useState(table?.area ?? "");
  const [seats, setSeats] = useState(String(table?.seats ?? 4));
  const [onMap, setOnMap] = useState(table?.isActive ?? true);
  const [armed, setArmed] = useState(false);

  const complaint = checkTable({ name, area, seats: Number(seats) || 0 });
  const busy = pending || removing;

  return (
    <div className="rounded-2xl border border-orchid-100 p-3">
      <form action={action}>
        {table ? <input type="hidden" name="table_id" value={table.id} /> : null}

        <fieldset disabled={readOnly || busy} className="grid gap-2 sm:grid-cols-[1fr_1fr_5rem]">
          <label className="block">
            <span className="pos-label">Name</span>
            <input
              key={submission}
              name="name"
              className="pos-field"
              value={name}
              maxLength={TABLE_NAME_MAX}
              placeholder="T1"
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <label className="block">
            <span className="pos-label">Where it is</span>
            <input
              name="area"
              className="pos-field"
              value={area}
              maxLength={AREA_MAX}
              placeholder="Terrace"
              onChange={(event) => setArea(event.target.value)}
            />
          </label>

          <label className="block">
            <span className="pos-label">Seats</span>
            <input
              name="seats"
              className="pos-field text-right tabular-nums"
              inputMode="numeric"
              value={seats}
              max={SEATS_MAX}
              onChange={(event) => setSeats(event.target.value)}
            />
          </label>
        </fieldset>

        <label className="mt-2 flex cursor-pointer items-center gap-2.5 text-[0.8125rem]">
          <input
            type="checkbox"
            name="is_active"
            checked={onMap}
            disabled={readOnly || busy}
            onChange={(event) => setOnMap(event.target.checked)}
            className="h-4 w-4 accent-orchid-700"
          />
          <span className="text-graphite-700">
            {onMap
              ? "On the floor map"
              : "Off the map — a table pushed into the store room keeps every meal served at it"}
          </span>
        </label>

        {state.error ? (
          <p className="mt-2 text-[0.75rem] leading-snug text-signal-bad">
            {state.error}
          </p>
        ) : complaint && name ? (
          <p className="mt-2 text-[0.75rem] leading-snug text-graphite-700">
            {complaint}
          </p>
        ) : null}

        {removal.error ? (
          <p className="mt-2 text-[0.75rem] leading-snug text-signal-bad">
            {removal.error}
          </p>
        ) : null}

        {readOnly ? null : (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={busy || Boolean(complaint)}
              className="pos-btn pos-btn-primary pos-btn-sm disabled:opacity-60"
            >
              <IconCheck className="h-4 w-4" />
              {pending ? "Saving…" : table ? "Save" : "Add it"}
            </button>

            {onDone ? (
              <button
                type="button"
                onClick={onDone}
                className="pos-btn pos-btn-quiet pos-btn-sm"
              >
                Cancel
              </button>
            ) : null}

            {table ? (
              armed ? (
                <>
                  <button
                    type="submit"
                    formAction={removeAction}
                    disabled={busy}
                    className="pos-btn pos-btn-sm bg-signal-bad text-white disabled:opacity-60"
                  >
                    <IconTrash className="h-4 w-4" />
                    {removing ? "Removing…" : `Yes, remove ${table.name}`}
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
                  className="pos-btn pos-btn-quiet pos-btn-sm ml-auto"
                >
                  <IconTrash className="h-4 w-4" />
                  Remove
                </button>
              )
            ) : null}
          </div>
        )}
      </form>
    </div>
  );
}
