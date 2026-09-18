"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { ChartCard } from "@/components/pos/chart-card";
import {
  IconChevron,
  IconPlus,
  IconTag,
  IconTrash,
} from "@/components/pos/icons";
import { useActionToast } from "@/components/pos/toaster";
import { TREE_NAME_MAX, type Department } from "@/lib/pos/catalog";
import { TREE_IDLE, type TreeState } from "./state";
import {
  addCategory,
  addDepartment,
  removeCategory,
  removeDepartment,
} from "./tree-actions";

/**
 * The shop's own tree.
 *
 * Two levels and two verbs: add a department, add a category inside it. That is
 * the whole screen. It used to be a read-only picture of six departments
 * nobody could change, a third level of subcategory chips nobody browsed by,
 * and a second card previewing the register grid — which between them said a
 * great deal and let a shopkeeper do nothing.
 *
 * Every name box is inline, where the thing it names will appear, rather than
 * in a modal. Adding four categories to a department is four sentences typed
 * into the same box, and a dialog that opened and closed between each of them
 * would be four times the work for no extra clarity.
 *
 * Removing is only offered on a branch with nothing in it. The action checks
 * again for itself — an item carries its department as a word, so deleting one
 * with stock under it would leave those items pointing at a tile the register
 * no longer draws.
 */
export function CategoriesPanel({ tree }: { tree: Department[] }) {
  const [state, action, pending] = useActionState(addDepartment, TREE_IDLE);

  useActionToast(state, {
    saved: `${state.saved?.name ?? "Department"} added`,
    failed: "That department was not added",
  });

  const items = tree.reduce((total, department) => total + department.items, 0);
  const categories = tree.reduce(
    (total, department) => total + department.categories.length,
    0,
  );

  return (
    <ChartCard
      title="Departments and categories"
      caption={
        tree.length === 0
          ? "Nothing yet — a product has to sit somewhere, so start here."
          : `${tree.length} departments · ${categories} categories · ${items} items`
      }
    >
      {tree.length === 0 ? (
        <p className="rounded-xl border border-dashed border-orchid-200 px-4 py-8 text-center text-[0.875rem] leading-relaxed text-graphite-700">
          Your tree is empty. Add a department below — Grocery, Beverages, or
          whatever your shelves are actually called — and the add-product sheet
          will start offering it.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {tree.map((department) => (
            <DepartmentRow key={department.id} department={department} />
          ))}
        </ul>
      )}

      {/* At the foot of the list, which is where the new one will appear. */}
      <div className="mt-3 rounded-xl border border-dashed border-orchid-200 p-3.5">
        <span className="pos-label">Add a department</span>
        <NameForm
          id="root"
          action={action}
          pending={pending}
          state={state}
          label="Add a department"
          placeholder="Hardware, Cloth, Medicines…"
        />
      </div>
    </ChartCard>
  );
}

/**
 * One department, open or shut.
 *
 * `<details>`, but with React holding whether it is open — which it has to,
 * because every save here re-renders this row. A computed `open` prop would go
 * from true to false the moment the first category landed, and the panel would
 * shut itself under the shopkeeper halfway through typing the second one.
 * `onToggle` keeps the state and the element agreeing whichever one moved
 * first.
 */
function DepartmentRow({ department }: { department: Department }) {
  // Open if there is nothing in it: an empty department is one somebody has
  // just made and is about to fill, and a full one is a row they are scrolling
  // past.
  const [open, setOpen] = useState(department.categories.length === 0);

  const [state, action, pending] = useActionState(addCategory, TREE_IDLE);
  const [removal, removeAction, removing] = useActionState(
    removeDepartment,
    TREE_IDLE,
  );

  useActionToast(state, {
    saved: `${state.saved?.name ?? "Category"} added to ${department.name}`,
    failed: "That category was not added",
  });

  useActionToast(removal, {
    saved: `${removal.saved?.name ?? "Department"} removed`,
    failed: "That department was not removed",
  });

  // A department can go once no *item* is filed under it. Its empty categories
  // go with it through the foreign key, which saves clearing four of them by
  // hand first — but the note below says so, because a delete that quietly took
  // four other rows would be a surprise. The action checks the item count again
  // for itself.
  const empty = department.items === 0;

  return (
    <li>
      <details
        className="group rounded-xl border border-orchid-100 open:bg-orchid-50/40"
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3.5 py-3">
          <IconChevron className="h-4 w-4 flex-none -rotate-90 text-graphite-500 transition-transform duration-200 group-open:rotate-0" />

          <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-orchid-100 text-orchid-800">
            <IconTag className="h-4 w-4" />
          </span>

          <span className="min-w-0 flex-1">
            <span className="block truncate font-display text-[0.875rem] font-semibold text-graphite-900">
              {department.name}
            </span>
            <span className="block truncate text-[0.75rem] text-graphite-500">
              {department.categories.length}{" "}
              {department.categories.length === 1 ? "category" : "categories"} ·{" "}
              {department.items} {department.items === 1 ? "item" : "items"}
            </span>
          </span>
        </summary>

        <div className="space-y-2 border-t border-orchid-100 px-3.5 py-3">
          {department.categories.map((category) => (
            <CategoryRow
              key={category.id}
              id={category.id}
              name={category.name}
              items={category.items}
            />
          ))}

          <NameForm
            id={department.id}
            action={action}
            pending={pending}
            state={state}
            label={`Add a category to ${department.name}`}
            placeholder="Cold drinks, Water…"
            hidden={{ department_id: department.id }}
            small
          />

          {/* Outside the `<summary>` on purpose: a button nested in one still
              toggles the disclosure it sits in, and the only way to stop that
              is to cancel the click that was meant to submit the form. */}
          {empty ? (
            <RemoveButton
              action={removeAction}
              pending={removing}
              field="department_id"
              value={department.id}
              label={`Remove ${department.name}`}
              note={
                department.categories.length === 0
                  ? "Nothing is filed here."
                  : `Nothing is filed here — its ${department.categories.length} ${
                      department.categories.length === 1
                        ? "category goes"
                        : "categories go"
                    } too.`
              }
            />
          ) : null}

          {removal.error && removal.scope === department.id ? (
            <p className="text-[0.8125rem] leading-relaxed text-signal-bad">
              {removal.error}
            </p>
          ) : null}
        </div>
      </details>
    </li>
  );
}

function CategoryRow({
  id,
  name,
  items,
}: {
  id: string;
  name: string;
  items: number;
}) {
  const [state, action, pending] = useActionState(removeCategory, TREE_IDLE);

  useActionToast(state, {
    saved: `${state.saved?.name ?? "Category"} removed`,
    failed: "That category was not removed",
  });

  return (
    <div className="rounded-lg bg-paper-50 px-3 py-2">
      {/* A div and not a paragraph: the armed remove control is a form, and a
          form inside a `<p>` is markup the browser silently unpicks. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 flex-1 truncate text-[0.875rem] font-medium text-graphite-900">
          {name}
        </span>
        <span className="flex-none text-[0.75rem] text-graphite-500">
          {items} {items === 1 ? "item" : "items"}
        </span>
        {items === 0 ? (
          <RemoveButton
            action={action}
            pending={pending}
            field="category_id"
            value={id}
            label={`Remove ${name}`}
          />
        ) : null}
      </div>

      {state.error ? (
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-signal-bad">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * One box and one button, submitted together.
 *
 * It clears itself and keeps the caret on the next save, because the shopkeeper
 * adding one category is nearly always adding three. Keyed off `savedAt` rather
 * than off the state object, for the reason the toaster is: the
 * `revalidatePath` re-render arrives as a second state and would otherwise wipe
 * the name somebody had already started typing.
 */
function NameForm({
  id,
  action,
  pending,
  state,
  label,
  placeholder,
  hidden,
  small = false,
}: {
  /** Which form this is, matched against the action's `scope`. */
  id: string;
  action: (formData: FormData) => void;
  pending: boolean;
  state: TreeState;
  label: string;
  placeholder: string;
  hidden?: Record<string, string>;
  small?: boolean;
}) {
  const box = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const settled = useRef<number | null>(null);

  useEffect(() => {
    if (!state.savedAt || state.savedAt === settled.current) return;
    settled.current = state.savedAt;
    setName("");
    box.current?.focus();
  }, [state.savedAt]);

  const mine = state.error && state.scope === id;

  return (
    <form action={action} className={small ? "" : "flex-none"}>
      {Object.entries(hidden ?? {}).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}

      <div className="flex items-center gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">{label}</span>
          <input
            ref={box}
            name="name"
            className={`pos-field ${small ? "py-1.5 text-[0.8125rem]" : ""}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={placeholder}
            maxLength={TREE_NAME_MAX}
            autoComplete="off"
          />
        </label>

        <button
          type="submit"
          disabled={pending || name.trim().length === 0}
          className={`pos-btn ${
            small ? "pos-btn-soft pos-btn-sm" : "pos-btn-primary"
          } disabled:opacity-45`}
        >
          <IconPlus className={small ? "h-3.5 w-3.5" : "h-4 w-4"} />
          {pending ? "Adding…" : "Add"}
        </button>
      </div>

      {mine ? (
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-signal-bad">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Delete, armed in place.
 *
 * Two presses rather than a confirm dialog, because everything this button can
 * reach is empty — there is nothing to lose that a second tap would not put
 * back, and a modal over a list of twenty rows is a modal in the way. It
 * disarms itself after four seconds so a half-pressed delete does not sit
 * waiting on a counter tablet nobody is watching.
 */
function RemoveButton({
  action,
  pending,
  field,
  value,
  label,
  note,
}: {
  action: (formData: FormData) => void;
  pending: boolean;
  field: string;
  value: string;
  label: string;
  /** Said beside the button when it is not armed, so the offer explains itself. */
  note?: string;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  if (!armed) {
    return (
      <div className="flex items-center gap-2">
        {note ? (
          <span className="text-[0.75rem] text-graphite-500">{note}</span>
        ) : null}
        <button
          type="button"
          onClick={() => setArmed(true)}
          className="pos-btn pos-btn-quiet pos-btn-sm"
          aria-label={label}
        >
          <IconTrash className="h-3.5 w-3.5" />
          Remove
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name={field} value={value} />
      <span className="text-[0.75rem] text-graphite-700">{label}?</span>
      <button
        type="submit"
        disabled={pending}
        className="pos-btn pos-btn-sm bg-signal-bad text-white disabled:opacity-60"
      >
        {pending ? "Removing…" : "Yes, remove"}
      </button>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="pos-btn pos-btn-quiet pos-btn-sm"
      >
        Keep it
      </button>
    </form>
  );
}
