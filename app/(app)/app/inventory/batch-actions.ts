"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { requireSession, type SessionContext } from "@/lib/auth";
import { getModuleAccess } from "@/lib/pos/access";
import {
  BATCH_NOTE_MAX,
  BATCH_NO_MAX,
  checkBatch,
  isAdjustReason,
  type Batch,
} from "@/lib/pos/batch";
import { listBatches } from "@/lib/pos/batches";
import { createAdminClient } from "@/utils/supabase/admin";
import { IDLE_BATCH, type BatchState } from "./state";

/**
 * Opening a batch, counting one, and writing one off.
 *
 * Every write goes through a security-definer function — `public.open_batch`
 * and `public.adjust_batch` — rather than straight at the table, because
 * `item_batches.quantity` and `items.stock` have to move together or they
 * drift, and `private.move_stock` is the only thing that can move both. A
 * Server Action writing the table directly would be the one path that could
 * desync them.
 *
 * `adjust_batch` is the absolute-to-relative adapter, exactly as `set_stock` is
 * for an item: the screen's entry point is "there are nine of this batch left"
 * and the safe write is a delta worked out under a row lock. Reading,
 * subtracting and writing here would read the count before counter 2 sells two
 * and write a number that un-sells them.
 *
 * Gated by `can_edit_items`, the same switch as the rest of Products & stock —
 * *not* `can_manage_purchasing`. Writing a batch off is a stocktake decision
 * made by whoever is standing at the shelf with the expired strips in their
 * hand, and that is the person the item permission is named for.
 */

const fail = (error: string): BatchState => ({ ...IDLE_BATCH, error });

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

const amount = (value: FormDataEntryValue | null) => {
  const parsed = Number(text(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : NaN;
};

/** Owner, or somebody the owner switched `can_edit_items` on for. */
async function requireCatalog() {
  const session = await requireSession();

  if (!session.tenantId) {
    return { ok: false as const, error: "This login is not linked to a shop yet." };
  }

  const access = await getModuleAccess(session);

  if (!access.inventory) {
    return {
      ok: false as const,
      error: "You are not allowed to change stock. Ask the owner.",
    };
  }

  return {
    ok: true as const,
    session: { ...session, tenantId: session.tenantId } as SessionContext & {
      tenantId: string;
    },
  };
}

/** The item's id arrives in a form, so it is checked against the shop's own
 *  rows before anything is written. A crafted id must not reach the function. */
async function ownItem(tenantId: string, itemId: unknown) {
  if (typeof itemId !== "string" || !itemId) return null;

  const { data } = await createAdminClient()
    .from("items")
    .select("id, name, tracks_batches")
    .eq("tenant_id", tenantId)
    .eq("id", itemId)
    .maybeSingle();

  return data;
}

/** The two screens a batch move shows up on. The register reads the catalog it
 *  sells from, and the till's own stock gate reads `items.stock`. */
function revalidateStock() {
  revalidatePath("/app/inventory");
  revalidatePath("/app/register");
}

/**
 * A 23505 from `item_batches_identity_idx`, in words.
 *
 * Worth catching by name: a batch number and expiry that are already on the
 * item means somebody is opening a second row for stock that already has one,
 * and the useful answer is to point at the row rather than let them find a
 * spelling that gets past the index.
 */
function conflict(message: string): string | null {
  if (message.includes("item_batches_identity_idx")) {
    return "That batch is already open on this item. Count it instead of opening a second one — two rows for one carton is two expiry dates for one date.";
  }

  return null;
}

// -----------------------------------------------------------------------------
// Opening a batch
// -----------------------------------------------------------------------------

export async function openBatch(
  _previous: BatchState,
  formData: FormData,
): Promise<BatchState> {
  const gate = await requireCatalog();
  if (!gate.ok) return fail(gate.error);
  const { session } = gate;

  const item = await ownItem(session.tenantId, formData.get("item_id"));
  if (!item) {
    return fail("That item is not in your list any more. Reload and try again.");
  }

  if (!item.tracks_batches) {
    return fail(
      "This item is not counted by batch. Switch that on first — until you do, its stock is one number.",
    );
  }

  const draft = {
    batchNo: text(formData.get("batch_no")).slice(0, BATCH_NO_MAX),
    expiresOn: text(formData.get("expires_on")),
    quantity: amount(formData.get("quantity")),
    unitCost: amount(formData.get("unit_cost")),
  };

  // The same function the sheet greys its button out with, so the refusal read
  // here is the sentence the form was already showing.
  const complaint = checkBatch(draft);
  if (complaint) return fail(complaint);

  const { error } = await createAdminClient().rpc("open_batch", {
    p_tenant: session.tenantId,
    p_item: item.id,
    p_batch_no: draft.batchNo || null,
    p_expires_on: draft.expiresOn || null,
    p_quantity: draft.quantity,
    p_unit_cost: draft.unitCost,
    p_note: text(formData.get("note")).slice(0, BATCH_NOTE_MAX) || null,
    p_by: session.userId,
  });

  if (error) {
    console.error("[inventory] open_batch failed", error);
    return fail(
      conflict(error.message) ??
        "We could not open that batch. Check the connection and try again.",
    );
  }

  await recordAudit(session, {
    action: "batch.opened",
    subjectType: "item",
    subjectId: item.id,
    after: {
      item_name: item.name,
      batch_no: draft.batchNo || null,
      expires_on: draft.expiresOn || null,
      quantity: draft.quantity,
    },
  });

  revalidateStock();

  return {
    error: null,
    savedAt: Date.now(),
    saved: {
      action: "opened",
      detail: draft.batchNo || draft.expiresOn || "batch",
    },
    batches: await listBatches(session.tenantId, item.id),
  };
}

// -----------------------------------------------------------------------------
// Counting one, or writing it off
// -----------------------------------------------------------------------------

/**
 * One batch, counted to an absolute figure.
 *
 * Writing off is this with a target of nought and a reason of `expired`, which
 * is why there is no second action for it: a write-off *is* a count, and the
 * only thing that makes it different is the word that goes in the ledger — and
 * that word has to be its own reason rather than a note, because "how much did
 * we throw away last quarter" is a `sum()` a pharmacy lives by.
 */
export async function adjustBatch(
  _previous: BatchState,
  formData: FormData,
): Promise<BatchState> {
  const gate = await requireCatalog();
  if (!gate.ok) return fail(gate.error);
  const { session } = gate;

  const batchId = text(formData.get("batch_id"));
  const reason = text(formData.get("reason"));
  const to = amount(formData.get("to"));

  if (!isAdjustReason(reason)) return fail("Say why the count is changing.");

  if (!Number.isFinite(to) || to < 0) {
    return fail("That count is not a number. Zero is allowed — it writes the batch off.");
  }

  const supabase = createAdminClient();

  // The batch id comes off a form, so it is checked against the shop's own rows
  // first — the function checks it again under a lock, and that is the control;
  // this is what turns a refusal into a sentence and gets the item's name for
  // the audit entry.
  const { data: batch } = await supabase
    .from("item_batches")
    .select("id, item_id, batch_no, expires_on, quantity")
    .eq("tenant_id", session.tenantId)
    .eq("id", batchId)
    .maybeSingle();

  if (!batch) {
    return fail("That batch is not on this item any more. Reload and try again.");
  }

  const { data, error } = await supabase.rpc("adjust_batch", {
    p_tenant: session.tenantId,
    p_batch: batch.id,
    p_to: to,
    p_reason: reason,
    p_note: text(formData.get("note")).slice(0, BATCH_NOTE_MAX) || null,
    p_by: session.userId,
  });

  if (error) {
    console.error("[inventory] adjust_batch failed", error);
    return fail("We could not change that count. Check the connection and try again.");
  }

  const moved =
    data && typeof data === "object" && "moved" in data
      ? Boolean((data as { moved: unknown }).moved)
      : false;

  // Nothing changed, so nothing is audited and nothing is announced. A ledger
  // full of "counted: no change" rows is a ledger nobody reads — the same call
  // `set_stock` makes for a zero delta.
  if (moved) {
    await recordAudit(session, {
      action: reason === "expired" ? "batch.written_off" : "batch.counted",
      subjectType: "item",
      subjectId: batch.item_id as string,
      before: { quantity: batch.quantity },
      after: {
        batch_no: batch.batch_no,
        expires_on: batch.expires_on,
        quantity: to,
        reason,
      },
    });

    revalidateStock();
  }

  return {
    error: null,
    savedAt: Date.now(),
    saved: {
      action: reason === "expired" ? "written-off" : "counted",
      detail: (batch.batch_no as string | null) ?? (batch.expires_on as string) ?? "batch",
    },
    batches: await listBatches(session.tenantId, batch.item_id as string),
  };
}

/**
 * One item's batches, for the panel to load when it opens.
 *
 * A read through a Server Action rather than data shipped with the catalog, the
 * same call `loadMovements` makes beside it: a shop with four hundred tracked
 * lines has thousands of batches and nobody opens more than one item at a time.
 */
export async function loadBatches(itemId: string): Promise<Batch[]> {
  const gate = await requireCatalog();
  if (!gate.ok) return [];

  const item = await ownItem(gate.session.tenantId, itemId);
  if (!item) return [];

  return listBatches(gate.session.tenantId, item.id);
}
