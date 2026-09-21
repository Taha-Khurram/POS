"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { IconAlert, IconCheck, IconPlus, IconTrash } from "@/components/pos/icons";
import { useActionToast } from "@/components/pos/toaster";
import {
  ADJUST_REASONS,
  BATCH_NOTE_MAX,
  BATCH_NO_MAX,
  byFefo,
  checkBatch,
  EXPIRY_STATES,
  expiryState,
  summarise,
  writeExpiry,
  type Batch,
} from "@/lib/pos/batch";
import { rupees } from "@/lib/format";
import { adjustBatch, loadBatches, openBatch } from "./batch-actions";
import { IDLE_BATCH } from "./state";

/**
 * The batches under one item.
 *
 * **Drawn in the order the till will sell them** — `byFefo`, the same ordering
 * `private.take_from_batches` walks — because that is the one thing that makes
 * a list of batches legible: the top row is what the next customer gets. Any
 * other order and a shopkeeper has to work out which one is going first.
 *
 * Expired rows stay in the list and are drawn as expired rather than hidden.
 * They are the whole reason somebody opened this panel: the till has already
 * refused to sell them and the way through is a write-off here, which is a
 * deliberate, recorded act.
 *
 * A batch at nought stays too — "we had B-441 and wrote it off in March" is
 * exactly the history a pharmacy is asked for, the same reason a switched-off
 * item keeps its sales.
 */
export function BatchPanel({
  itemId,
  itemName,
  /** The item's own running total, so the panel can say when the two disagree.
   *  They cannot drift — `move_stock` writes both — but stock that was on the
   *  shelf *before* tracking was switched on is untracked and real. */
  itemStock,
  /** The shop's own trading day. Never the browser's: a tablet on the wrong
   *  date would mark good stock expired. */
  today,
}: {
  itemId: string;
  itemName: string;
  itemStock: number;
  today: string;
}) {
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [adding, setAdding] = useState(false);

  const [opened, openAction, opening] = useActionState(openBatch, IDLE_BATCH);
  const [adjusted, adjustAction, adjusting] = useActionState(adjustBatch, IDLE_BATCH);

  useActionToast(opened, {
    saved: `Batch ${opened.saved?.detail ?? ""} opened`,
    failed: "That batch did not open",
  });

  useActionToast(adjusted, {
    saved:
      adjusted.saved?.action === "written-off"
        ? `Batch ${adjusted.saved.detail} written off`
        : `Batch ${adjusted.saved?.detail ?? ""} counted`,
    failed: "That count did not save",
  });

  // Loaded once when the panel mounts. A read per item rather than data shipped
  // with the catalog, the same call the movements list makes beside it.
  useEffect(() => {
    let live = true;
    loadBatches(itemId).then((rows) => {
      if (live) setBatches(rows);
    });
    return () => {
      live = false;
    };
  }, [itemId]);

  // Both actions hand the fresh list back, so the panel redraws without a
  // second round trip. Keyed on `savedAt` for the reason the toaster is: the
  // `revalidatePath` re-render arrives as a second state and would otherwise
  // replay it.
  const settled = useRef<number | null>(null);

  useEffect(() => {
    for (const state of [opened, adjusted]) {
      if (state.savedAt && state.savedAt !== settled.current && state.batches) {
        settled.current = state.savedAt;
        setBatches(state.batches);
        setAdding(false);
      }
    }
  }, [opened, adjusted]);

  if (batches === null) {
    return (
      <p className="px-1 py-3 text-[0.8125rem] text-graphite-500">
        Reading the batches…
      </p>
    );
  }

  const live = batches.filter((batch) => batch.quantity > 0).sort(byFefo);
  const empty = batches.filter((batch) => batch.quantity <= 0).sort(byFefo);
  const totals = summarise(batches, today);

  // Stock that is on the item but in no batch. Real and common: switching
  // tracking on does not invent a batch for what is already on the shelf, and
  // saying so is better than drawing a total that does not add up.
  const untracked = Math.round((itemStock - totals.total) * 1000) / 1000;

  return (
    <div className="space-y-3">
      {/* ---------------- What it comes to ---------------- */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Figure label="On the shelf" value={totals.total} />
        <Figure label="The till can sell" value={totals.sellable} tone="good" />
        <Figure
          label="Expired"
          value={totals.expired}
          tone={totals.expired > 0 ? "bad" : undefined}
        />
        <Figure
          label="Going off soon"
          value={totals.critical}
          tone={totals.critical > 0 ? "warn" : undefined}
        />
      </div>

      {untracked !== 0 ? (
        <p className="pos-note">
          <IconAlert className="mt-0.5 h-4 w-4 flex-none text-signal-warn" />
          <span>
            {untracked > 0 ? (
              <>
                <strong className="font-semibold text-graphite-900">
                  {untracked.toLocaleString("en-PK")}
                </strong>{" "}
                of this item is on the shelf but in no batch — stock that was
                already counted before you switched batch tracking on. The till
                will sell it after every dated batch. Open a batch for it when
                you next count the shelf.
              </>
            ) : (
              <>
                The batches hold {Math.abs(untracked).toLocaleString("en-PK")}{" "}
                more than the item&rsquo;s own count. That should not be possible
                — tell us about it.
              </>
            )}
          </span>
        </p>
      ) : null}

      {/* ---------------- The batches ---------------- */}
      {live.length === 0 && empty.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-orchid-200 px-4 py-5 text-center text-[0.8125rem] leading-relaxed text-graphite-500">
          No batches open. Take a delivery in under Buying and put the date off
          the carton on the line — or open one here for what is already on the
          shelf.
        </p>
      ) : (
        <ul className="space-y-2">
          {[...live, ...empty].map((batch) => (
            <BatchRow
              key={batch.id}
              batch={batch}
              today={today}
              action={adjustAction}
              busy={adjusting}
            />
          ))}
        </ul>
      )}

      {/* ---------------- Opening one ---------------- */}
      {adding ? (
        <OpenBatchForm
          itemId={itemId}
          itemName={itemName}
          action={openAction}
          busy={opening}
          error={opened.error}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="pos-btn pos-btn-soft pos-btn-sm"
        >
          <IconPlus className="h-4 w-4" />
          Open a batch
        </button>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "good" | "warn" | "bad";
}) {
  const colour =
    tone === "bad"
      ? "text-signal-bad"
      : tone === "warn"
        ? "text-signal-warn"
        : tone === "good"
          ? "text-signal-good"
          : "text-graphite-900";

  return (
    <div className="rounded-xl border border-orchid-100 px-3 py-2">
      <p className="text-[0.6875rem] text-graphite-500">{label}</p>
      <p className={`mt-0.5 font-display text-[1.0625rem] font-bold tabular-nums ${colour}`}>
        {value.toLocaleString("en-PK")}
      </p>
    </div>
  );
}

/**
 * One batch, with its count editable in place.
 *
 * The count is a form of its own rather than a sheet, because the thing
 * somebody is doing here is reading a shelf and typing what is on it, ten rows
 * in a row. A modal per row would be ten modals.
 */
function BatchRow({
  batch,
  today,
  action,
  busy,
}: {
  batch: Batch;
  today: string;
  action: (formData: FormData) => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [to, setTo] = useState(String(batch.quantity));
  const [reason, setReason] = useState<string>("count");

  const state = expiryState(batch.expiresOn, today);
  const look = EXPIRY_STATES[state];

  const tone =
    look.tone === "bad"
      ? "border-signal-bad"
      : look.tone === "warn"
        ? "border-signal-warn"
        : "border-orchid-100";

  return (
    <li
      className={`rounded-2xl border p-3 ${tone} ${batch.quantity <= 0 ? "opacity-60" : ""}`}
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-[0.875rem] font-medium text-graphite-900">
            <span className="font-mono">{batch.batchNo || "no batch number"}</span>

            <span
              className={`pos-badge ${
                look.tone === "bad"
                  ? "pos-badge-bad"
                  : look.tone === "warn"
                    ? "pos-badge-warn"
                    : look.tone === "good"
                      ? "pos-badge-good"
                      : ""
              }`}
            >
              {look.label}
            </span>
          </p>

          <p className="mt-0.5 text-[0.6875rem] text-graphite-500">
            {writeExpiry(batch.expiresOn, today)}
            {batch.unitCost > 0 ? ` · cost ${rupees(batch.unitCost)}` : ""}
            {batch.grnNumber ? ` · came in on ${batch.grnNumber}` : ""}
          </p>

          {batch.note ? (
            <p className="mt-1 text-[0.75rem] text-graphite-700">{batch.note}</p>
          ) : null}
        </div>

        <p className="flex-none text-right">
          <span className="font-display text-[1.125rem] font-bold tabular-nums text-graphite-900">
            {batch.quantity.toLocaleString("en-PK")}
          </span>
          <span className="block text-[0.6875rem] text-graphite-500">on the shelf</span>
        </p>
      </div>

      {editing ? (
        <form action={action} className="mt-3 border-t border-orchid-100 pt-3">
          <input type="hidden" name="batch_id" value={batch.id} />
          <input type="hidden" name="reason" value={reason} />

          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <label className="block">
              <span className="pos-label">Count it to</span>
              <input
                name="to"
                className="pos-field text-right tabular-nums"
                inputMode="decimal"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                autoFocus
              />
            </label>

            <label className="block">
              <span className="pos-label">Why</span>
              <select
                className="pos-field"
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  // Writing off means nothing is left. Filling it in is the
                  // whole of what somebody means by the word, and making them
                  // type a nought as well is a step that only exists to be
                  // forgotten.
                  if (event.target.value === "expired") setTo("0");
                }}
              >
                {ADJUST_REASONS.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="pos-hint mt-1">
            {ADJUST_REASONS.find((entry) => entry.id === reason)?.note}
          </p>

          <label className="mt-2 block">
            <span className="pos-label">Note — optional</span>
            <input
              name="note"
              className="pos-field"
              maxLength={BATCH_NOTE_MAX}
              placeholder="Two strips burst in the rain."
            />
          </label>

          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy}
              className={`pos-btn pos-btn-sm disabled:opacity-60 ${
                reason === "expired"
                  ? "bg-signal-bad text-white"
                  : "pos-btn-primary"
              }`}
            >
              {reason === "expired" ? (
                <IconTrash className="h-4 w-4" />
              ) : (
                <IconCheck className="h-4 w-4" />
              )}
              {busy
                ? "Saving…"
                : reason === "expired"
                  ? "Write it off"
                  : "Save the count"}
            </button>

            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setTo(String(batch.quantity));
                setReason("count");
              }}
              className="pos-btn pos-btn-quiet pos-btn-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="pos-btn pos-btn-soft pos-btn-sm"
          >
            Count or write off
          </button>
        </div>
      )}
    </li>
  );
}

/** A batch opened by hand, for stock already on the shelf when tracking was
 *  switched on — or for a shop that does not put its deliveries through Buying. */
function OpenBatchForm({
  itemId,
  itemName,
  action,
  busy,
  error,
  onCancel,
}: {
  itemId: string;
  itemName: string;
  action: (formData: FormData) => void;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
}) {
  const [batchNo, setBatchNo] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");

  const complaint = checkBatch({
    batchNo,
    expiresOn,
    quantity: Number(quantity) || 0,
    unitCost: Number(unitCost) || 0,
  });

  return (
    <form action={action} className="rounded-2xl border border-orchid-100 p-3.5">
      <input type="hidden" name="item_id" value={itemId} />

      <h4 className="font-display text-[0.875rem] font-semibold">
        Open a batch of {itemName}
      </h4>
      <p className="mt-1 text-[0.75rem] leading-relaxed text-graphite-700">
        For stock already on the shelf. A delivery through Buying opens its own.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="pos-label">Batch number</span>
          <input
            name="batch_no"
            className="pos-field font-mono"
            value={batchNo}
            maxLength={BATCH_NO_MAX}
            placeholder="Off the carton"
            onChange={(event) => setBatchNo(event.target.value)}
          />
        </label>

        <label className="block">
          <span className="pos-label">Expires on</span>
          <input
            name="expires_on"
            type="date"
            className="pos-field"
            value={expiresOn}
            onChange={(event) => setExpiresOn(event.target.value)}
          />
        </label>

        <label className="block">
          <span className="pos-label">How many</span>
          <input
            name="quantity"
            className="pos-field text-right tabular-nums"
            inputMode="decimal"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>

        <label className="block">
          <span className="pos-label">Cost each</span>
          <input
            name="unit_cost"
            className="pos-field text-right tabular-nums"
            inputMode="decimal"
            value={unitCost}
            placeholder="0"
            onChange={(event) => setUnitCost(event.target.value)}
          />
        </label>
      </div>

      <label className="mt-2 block">
        <span className="pos-label">Note — optional</span>
        <input
          name="note"
          className="pos-field"
          maxLength={BATCH_NOTE_MAX}
          placeholder="Counted off the top shelf."
        />
      </label>

      {error ? (
        <p className="mt-2 text-[0.75rem] leading-snug text-signal-bad">{error}</p>
      ) : complaint && (batchNo || expiresOn || quantity) ? (
        <p className="mt-2 text-[0.75rem] leading-snug text-graphite-700">
          {complaint}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy || Boolean(complaint)}
          className="pos-btn pos-btn-primary pos-btn-sm disabled:opacity-60"
        >
          <IconCheck className="h-4 w-4" />
          {busy ? "Opening…" : "Open it"}
        </button>

        <button
          type="button"
          onClick={onCancel}
          className="pos-btn pos-btn-quiet pos-btn-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
