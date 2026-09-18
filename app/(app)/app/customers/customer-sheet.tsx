"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";

import { IconCheck, IconClose, IconTrash, IconUser } from "@/components/pos/icons";
import { useActionToast } from "@/components/pos/toaster";
import {
  ADDRESS_MAX,
  NAME_MAX,
  NOTES_MAX,
  checkCustomer,
  normalisePhone,
  writePhone,
  type Customer,
} from "@/lib/pos/customer";
import { deleteCustomer, saveCustomer } from "./actions";
import { IDLE } from "./state";

/**
 * One customer, added or corrected.
 *
 * Short on purpose. The register book this replaces has a name and a number in
 * it and nothing else, and a form that asks a shopkeeper for eleven fields
 * about somebody standing at the counter with their shopping is a form that
 * gets skipped. So: name, phone, and four optional boxes that are visibly
 * optional.
 *
 * The phone is the one field with any machinery behind it. It is normalised as
 * it is typed — `+92 300 1234567` and `0300-1234567` are one customer — and the
 * stored form is shown back under the box, because a shopkeeper who types the
 * number off a customer's screen should be able to see that Flo read it the way
 * they meant.
 *
 * Every field is controlled, like the product sheet's, for the reason that one
 * is: "Save and add another" has to clear the form itself, and `defaultValue`
 * cannot be told to.
 */
export function CustomerSheet({
  customer,
  onClose,
}: {
  /** The row being corrected, or null for a new customer. */
  customer: Customer | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const deleteFormId = useId();

  const [state, action, pending] = useActionState(saveCustomer, IDLE);
  const [removal, removeAction, removing] = useActionState(deleteCustomer, IDLE);

  useActionToast(state, {
    saved:
      state.saved?.action === "updated"
        ? `${state.saved.name} saved`
        : `${state.saved?.name ?? "Customer"} added`,
    failed: "That customer did not save",
  });

  useActionToast(removal, {
    saved: `${removal.saved?.name ?? "Customer"} removed from the list`,
    failed: "That customer was not removed",
  });

  const [name, setName] = useState(customer?.name ?? "");
  const [phone, setPhone] = useState(customer ? writePhone(customer.phone) : "");
  const [email, setEmail] = useState(customer?.email ?? "");
  const [address, setAddress] = useState(customer?.address ?? "");
  const [notes, setNotes] = useState(customer?.notes ?? "");
  const [onList, setOnList] = useState(customer?.isActive ?? true);

  const [armed, setArmed] = useState(false);

  // Which button was pressed. A ref rather than state because it is read by the
  // effect below after the action settles and must never cause a render of its
  // own — the two submit buttons differ only in what happens afterwards.
  const closeAfter = useRef(true);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    nameRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  // Keyed off `savedAt` and not off the state object, for the reason the
  // toaster is: the `revalidatePath` re-render arrives as a second state and
  // would otherwise clear a form somebody had already started the next customer
  // in.
  const settled = useRef<number | null>(null);

  useEffect(() => {
    if (!state.savedAt || state.savedAt === settled.current) return;
    settled.current = state.savedAt;

    if (closeAfter.current) return onClose();

    setName("");
    setPhone("");
    setEmail("");
    setAddress("");
    setNotes("");
    nameRef.current?.focus();
  }, [state.savedAt, onClose]);

  const removed = useRef<number | null>(null);

  useEffect(() => {
    if (!removal.savedAt || removal.savedAt === removed.current) return;
    removed.current = removal.savedAt;
    onClose();
  }, [removal.savedAt, onClose]);

  const stored = normalisePhone(phone);

  // The same function the Server Action refuses with, so the sentence under the
  // form and the sentence that comes back from the server are one sentence.
  const complaint = checkCustomer({ name, phone, email, address, notes });

  const locked = pending || removing;

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
        aria-label={customer ? `Edit ${customer.name}` : "Add a customer"}
        tabIndex={-1}
        className="pos-sheet outline-none"
      >
        <form action={action}>
          {/* The row this form writes to. Checked against the shop's own
              customers inside the action — a crafted id must never reach the
              update. */}
          {customer ? (
            <input type="hidden" name="customer_id" value={customer.id} />
          ) : null}

          <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-orchid-100 bg-paper-50 px-4 py-3.5 sm:px-5">
            <span className="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-xl bg-orchid-200 text-orchid-800">
              <IconUser className="h-[18px] w-[18px]" />
            </span>

            <div className="min-w-0 flex-1">
              <h2 className="font-display text-[1rem] leading-tight font-bold">
                {customer ? customer.name : "Add a customer"}
              </h2>
              <p className="mt-0.5 truncate text-[0.75rem] text-graphite-500">
                {customer
                  ? "Correct anything. The register picks it up on its next load."
                  : "A name and a number is the whole of it. The rest can wait."}
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

          <fieldset disabled={locked} className="space-y-5 px-4 py-5 sm:px-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="pos-label">Name</span>
                <input
                  ref={nameRef}
                  name="name"
                  className="pos-field"
                  value={name}
                  maxLength={NAME_MAX}
                  autoComplete="off"
                  placeholder="Bilal Ahmed"
                  onChange={(event) => setName(event.target.value)}
                />
              </label>

              <label className="block">
                <span className="pos-label">Phone — optional</span>
                <input
                  name="phone"
                  className="pos-field font-mono tracking-[0.04em]"
                  value={phone}
                  inputMode="tel"
                  autoComplete="off"
                  placeholder="0300 1234567"
                  onChange={(event) => setPhone(event.target.value)}
                />
                <p className="pos-hint">
                  {stored && stored !== phone.replace(/\s/g, "")
                    ? `Saved as ${stored}.`
                    : "One number is one customer. Leave it empty if they would not give one."}
                </p>
              </label>
            </div>

            <label className="block">
              <span className="pos-label">Where they are — optional</span>
              <input
                name="address"
                className="pos-field"
                value={address}
                maxLength={ADDRESS_MAX}
                autoComplete="off"
                placeholder="Shop 4, Anarkali — near the masjid"
                onChange={(event) => setAddress(event.target.value)}
              />
            </label>

            <label className="block">
              <span className="pos-label">Email — optional</span>
              <input
                name="email"
                type="email"
                className="pos-field"
                value={email}
                autoComplete="off"
                placeholder="bilal@example.com"
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>

            <label className="block">
              <span className="pos-label">Note — optional</span>
              <textarea
                name="notes"
                className="pos-field min-h-[5rem] resize-y"
                value={notes}
                maxLength={NOTES_MAX}
                placeholder="Takes the 5 kg bag every Friday. Brother of Imran at the pharmacy."
                onChange={(event) => setNotes(event.target.value)}
              />
              <p className="pos-hint">
                Whatever you would have written in the margin of the register
                book. Only your shop sees it.
              </p>
            </label>

            {/* ---------------- On the list ---------------- */}
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-orchid-100 bg-orchid-50/60 p-3.5">
              <input
                type="checkbox"
                name="is_active"
                checked={onList}
                onChange={(event) => setOnList(event.target.checked)}
                className="mt-0.5 h-4 w-4 flex-none accent-orchid-700"
              />

              <span className="min-w-0">
                <span className="block font-display text-[0.875rem] font-semibold text-graphite-900">
                  The register can put a bill against them
                </span>
                <span className="mt-1 block text-[0.8125rem] leading-relaxed text-graphite-700">
                  {onList ? (
                    <>They come up in the till&rsquo;s customer search.</>
                  ) : (
                    <>
                      Switched off. The cashier cannot find them, which is what
                      somebody who has moved away wants. Every bill already
                      against them is untouched.
                    </>
                  )}
                </span>
              </span>
            </label>

            {/* ---------------- Removing them ---------------- */}
            {customer ? (
              <section className="rounded-2xl border border-orchid-100 p-3.5">
                <h3 className="font-display text-[0.9375rem] font-semibold">
                  Delete {customer.name}
                </h3>
                <p className="mt-1 text-[0.8125rem] leading-relaxed text-graphite-700">
                  Gone from the list for good. Every bill they are on still
                  prints and still counts towards the day&rsquo;s takings — but
                  nothing will be able to total what they have spent again. If
                  they have simply moved away, switch them off above instead.
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
                        {removing ? "Deleting…" : `Yes, delete ${customer.name}`}
                      </button>

                      <button
                        type="button"
                        onClick={() => setArmed(false)}
                        className="pos-btn pos-btn-quiet pos-btn-sm"
                      >
                        Keep them
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setArmed(true)}
                      className="pos-btn pos-btn-soft pos-btn-sm"
                    >
                      <IconTrash className="h-4 w-4" />
                      Delete customer
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
            ) : complaint && name.trim() ? (
              // Only once they have started. An empty form is not yet a mistake,
              // and a red line under a box nobody has touched reads as one.
              <p className="mr-auto min-w-[8rem] flex-1 text-[0.75rem] leading-snug text-graphite-700">
                {complaint}
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

            {customer ? null : (
              <button
                type="submit"
                disabled={locked || Boolean(complaint)}
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
              disabled={locked || Boolean(complaint)}
              onClick={() => {
                closeAfter.current = true;
              }}
              className="pos-btn pos-btn-primary disabled:opacity-60"
            >
              {pending ? (
                "Saving…"
              ) : customer ? (
                "Save changes"
              ) : (
                <>
                  <IconCheck className="h-4 w-4" />
                  Save and close
                </>
              )}
            </button>
          </footer>
        </form>

        {customer ? (
          <form id={deleteFormId} action={removeAction} className="hidden">
            <input type="hidden" name="customer_id" value={customer.id} />
          </form>
        ) : null}
      </div>
    </div>
  );
}
