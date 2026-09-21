"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";

import { IconCheck, IconClose, IconTrash, IconTruck } from "@/components/pos/icons";
import { SelectRow } from "@/components/pos/select-field";
import { useActionToast } from "@/components/pos/toaster";
import { normalisePhone, writePhone } from "@/lib/pos/customer";
import {
  ADDRESS_MAX,
  CONTACT_MAX,
  NAME_MAX,
  NOTES_MAX,
  PAYMENT_TERMS,
  TAX_NUMBER_MAX,
  checkSupplier,
  foldName,
  type Supplier,
} from "@/lib/pos/supplier";
import { deleteSupplier, saveSupplier } from "./supplier-actions";
import { IDLE } from "./state";

/**
 * One supplier, added or corrected.
 *
 * Short, for the reason the customer sheet is short: the thing this replaces is
 * a name and a number written on the inside cover of a register book, and a
 * form that asks for eleven fields about a man who is standing at the door with
 * a delivery is a form that gets skipped. Name is the only one that is not
 * visibly optional.
 *
 * The one piece of machinery is the duplicate warning. The name is the identity
 * here — `suppliers_tenant_name_idx` folds case and spacing — so the sheet
 * folds the same way and says so *before* the save, rather than turning a 23505
 * into a sentence afterwards. Two rows for one distributor is two balances that
 * never agree, and the cheapest moment to stop it is while somebody is still
 * typing the name.
 *
 * Every field is controlled, like the customer and product sheets, because
 * "Save and add another" has to clear the form itself and `defaultValue` cannot
 * be told to.
 */
export function SupplierSheet({
  supplier,
  /** Every name already on the list, folded. The duplicate warning reads it;
   *  the unique index is still what guarantees it. */
  taken,
  onClose,
}: {
  supplier: Supplier | null;
  taken: string[];
  onClose: () => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const deleteFormId = useId();

  const [state, action, pending] = useActionState(saveSupplier, IDLE);
  const [removal, removeAction, removing] = useActionState(deleteSupplier, IDLE);

  useActionToast(state, {
    saved:
      state.saved?.action === "updated"
        ? `${state.saved.name} saved`
        : `${state.saved?.name ?? "Supplier"} added`,
    failed: "That supplier did not save",
  });

  useActionToast(removal, {
    saved: `${removal.saved?.name ?? "Supplier"} removed from the list`,
    failed: "That supplier was not removed",
  });

  const [name, setName] = useState(supplier?.name ?? "");
  const [contactName, setContactName] = useState(supplier?.contactName ?? "");
  const [phone, setPhone] = useState(supplier ? writePhone(supplier.phone) : "");
  const [email, setEmail] = useState(supplier?.email ?? "");
  const [address, setAddress] = useState(supplier?.address ?? "");
  const [taxNumber, setTaxNumber] = useState(supplier?.taxNumber ?? "");
  const [terms, setTerms] = useState(String(supplier?.paymentTermsDays ?? 0));
  const [notes, setNotes] = useState(supplier?.notes ?? "");
  const [opening, setOpening] = useState(
    supplier?.opening ? String(supplier.opening) : "",
  );
  const [openingOn, setOpeningOn] = useState(supplier?.openingOn ?? "");
  const [onList, setOnList] = useState(supplier?.isActive ?? true);

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
  // would otherwise clear a form somebody had already started the next supplier
  // in.
  const settled = useRef<number | null>(null);

  useEffect(() => {
    if (!state.savedAt || state.savedAt === settled.current) return;
    settled.current = state.savedAt;

    if (closeAfter.current) return onClose();

    setName("");
    setContactName("");
    setPhone("");
    setEmail("");
    setAddress("");
    setTaxNumber("");
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

  // Signed and blank-is-nought, matching what the action reads. Most suppliers
  // start level, and an empty box is that rather than a mistake.
  const openingAmount = (() => {
    const value = Number(opening.replace(/[,\s]/g, ""));
    return Number.isFinite(value) ? value : 0;
  })();

  // The same function the Server Action refuses with, so the sentence under the
  // form and the sentence that comes back from the server are one sentence.
  const complaint = checkSupplier({
    name,
    contactName,
    phone,
    email,
    address,
    taxNumber,
    paymentTermsDays: Number(terms) || 0,
    notes,
    opening: openingAmount,
    openingOn,
  });

  // A name somebody else on the list already carries, folded the way the index
  // folds it. Not a refusal — the save is still offered, and the server's own
  // 23505 is the control — because the fastest way to lose an owner's typing is
  // to disable a button over a check the browser made.
  const clash =
    name.trim().length > 1 &&
    foldName(name) !== foldName(supplier?.name ?? "") &&
    taken.includes(foldName(name));

  const locked = pending || removing;

  return (
    <div
      className="pos-modal"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !locked) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={supplier ? `Edit ${supplier.name}` : "Add a supplier"}
        tabIndex={-1}
        className="pos-sheet outline-none"
      >
        <form action={action}>
          {/* The row this form writes to. Checked against the shop's own
              suppliers inside the action — a crafted id must never reach the
              update. */}
          {supplier ? (
            <input type="hidden" name="supplier_id" value={supplier.id} />
          ) : null}
          <input type="hidden" name="payment_terms_days" value={terms} />
          <input type="hidden" name="opening" value={opening} />
          <input type="hidden" name="opening_on" value={openingOn} />

          <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-orchid-100 bg-paper-50 px-4 py-3.5 sm:px-5">
            <span className="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-xl bg-orchid-200 text-orchid-800">
              <IconTruck className="h-[18px] w-[18px]" />
            </span>

            <div className="min-w-0 flex-1">
              <h2 className="font-display text-[1rem] leading-tight font-bold">
                {supplier ? supplier.name : "Add a supplier"}
              </h2>
              <p className="mt-0.5 truncate text-[0.75rem] text-graphite-500">
                {supplier
                  ? "Correct anything. Every item and order pointing at them follows."
                  : "The name on the invoice is the whole of it. The rest can wait."}
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
            <label className="block">
              <span className="pos-label">Name</span>
              <input
                ref={nameRef}
                name="name"
                className="pos-field"
                value={name}
                maxLength={NAME_MAX}
                autoComplete="off"
                placeholder="Ravi Trading"
                onChange={(event) => setName(event.target.value)}
              />
              <p className="pos-hint">
                {clash ? (
                  <span className="text-signal-warn">
                    You already buy from somebody by this name. Open their record
                    instead — two rows for one distributor is two balances that
                    never agree.
                  </span>
                ) : (
                  "The name on the invoice, not the salesman's. One name is one account."
                )}
              </p>
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="pos-label">Who you ring — optional</span>
                <input
                  name="contact_name"
                  className="pos-field"
                  value={contactName}
                  maxLength={CONTACT_MAX}
                  autoComplete="off"
                  placeholder="Asif bhai"
                  onChange={(event) => setContactName(event.target.value)}
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
                    : "The number you dial when the shelf is empty on a Friday."}
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
                placeholder="Godown 12, Akbari Mandi"
                onChange={(event) => setAddress(event.target.value)}
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <SelectRow
                label="Payment terms"
                value={terms}
                onChange={setTerms}
                options={PAYMENT_TERMS.map((term) => ({
                  id: String(term.id),
                  label: term.label,
                  description: "note" in term ? term.note : undefined,
                }))}
                hint="What you agreed, for your own reference. Flo does not chase it."
              />

              <label className="block">
                <span className="pos-label">NTN or STRN — optional</span>
                <input
                  name="tax_number"
                  className="pos-field font-mono"
                  value={taxNumber}
                  maxLength={TAX_NUMBER_MAX}
                  autoComplete="off"
                  placeholder="1234567-8"
                  onChange={(event) => setTaxNumber(event.target.value)}
                />
                <p className="pos-hint">
                  Needed on the invoice the day you start claiming input tax.
                </p>
              </label>
            </div>

            <label className="block">
              <span className="pos-label">Email — optional</span>
              <input
                name="email"
                type="email"
                className="pos-field"
                value={email}
                autoComplete="off"
                placeholder="orders@ravitrading.pk"
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
                placeholder="Van comes Tuesday morning. Will not take a return after a week."
                onChange={(event) => setNotes(event.target.value)}
              />
              <p className="pos-hint">
                Whatever you would have written in the margin of the order book.
                Only your shop sees it.
              </p>
            </label>

            {/* ---------------- What was owed before Flo ---------------- */}
            <section className="rounded-2xl border border-orchid-100 p-3.5">
              <h3 className="font-display text-[0.9375rem] font-semibold">
                Opening balance
              </h3>
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-graphite-700">
                What you already owed them the day you started using Flo. Leave
                it empty if you were level. Without it, their balance here will
                never match the page at the back of your own book — and a figure
                that does not match is one nobody checks twice.
              </p>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="pos-label">Owed to them</span>
                  <input
                    className="pos-field text-right tabular-nums"
                    inputMode="decimal"
                    value={opening}
                    placeholder="0"
                    onChange={(event) => setOpening(event.target.value)}
                  />
                  <p className="pos-hint">
                    A minus figure if you had paid them in advance.
                  </p>
                </label>

                <label className="block">
                  <span className="pos-label">As at</span>
                  <input
                    type="date"
                    className="pos-field"
                    value={openingOn}
                    disabled={openingAmount === 0}
                    onChange={(event) => setOpeningOn(event.target.value)}
                  />
                  <p className="pos-hint">
                    {openingAmount === 0
                      ? "Nothing owed, so no date needed."
                      : "The morning that figure was true."}
                  </p>
                </label>
              </div>
            </section>

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
                  Still buying from them
                </span>
                <span className="mt-1 block text-[0.8125rem] leading-relaxed text-graphite-700">
                  {onList ? (
                    <>They come up when you file an item or enter a delivery.</>
                  ) : (
                    <>
                      Switched off. They are out of every picker, which is what a
                      distributor who has shut down wants. Every item and
                      delivery already pointing at them is untouched.
                    </>
                  )}
                </span>
              </span>
            </label>

            {/* ---------------- Removing them ---------------- */}
            {supplier ? (
              <section className="rounded-2xl border border-orchid-100 p-3.5">
                <h3 className="font-display text-[0.9375rem] font-semibold">
                  Delete {supplier.name}
                </h3>
                <p className="mt-1 text-[0.8125rem] leading-relaxed text-graphite-700">
                  Gone from the list for good.{" "}
                  {supplier.items > 0 ? (
                    <>
                      The{" "}
                      <strong className="font-semibold text-graphite-900">
                        {supplier.items.toLocaleString("en-PK")}{" "}
                        {supplier.items === 1 ? "item" : "items"}
                      </strong>{" "}
                      you buy from them keep selling and simply stop saying where
                      they came from.{" "}
                    </>
                  ) : null}
                  Nothing will be able to total what you bought from them again.
                  If they have just shut down, switch them off above instead.
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
                          the delete button lives here and submits the empty form
                          declared beside this one. */}
                      <button
                        type="submit"
                        form={deleteFormId}
                        disabled={removing}
                        className="pos-btn pos-btn-sm bg-signal-bad text-white disabled:opacity-60"
                      >
                        <IconTrash className="h-4 w-4" />
                        {removing ? "Deleting…" : `Yes, delete ${supplier.name}`}
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
                      Delete supplier
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

            {supplier ? null : (
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
              ) : supplier ? (
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

        {supplier ? (
          <form id={deleteFormId} action={removeAction} className="hidden">
            <input type="hidden" name="supplier_id" value={supplier.id} />
          </form>
        ) : null}
      </div>
    </div>
  );
}
