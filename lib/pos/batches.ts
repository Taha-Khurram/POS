import "server-only";

import { cookies } from "next/headers";

import { expiryState, summarise, type Batch, type BatchSummary } from "@/lib/pos/batch";
import { createClient } from "@/utils/supabase/server";

/**
 * An item's batches, read as rows.
 *
 * Through the shop's own JWT, like every other reader in `lib/pos/`:
 * `item_batches_read_own` scopes to the `tenant_id` claim, so RLS is the gate.
 * Nothing here writes — `private.move_stock` is the only writer of
 * `item_batches.quantity` anywhere, reachable only from inside `record_sale`,
 * `record_receipt`, `adjust_batch` and `open_batch`. A sub-ledger a screen can
 * edit is not a sub-ledger.
 *
 * Deliberately NOT wrapped in React `cache()`, for the reason none of the other
 * readers are.
 */

const money = (value: number | string | null) => Number(value ?? 0) || 0;

const embedded = <T,>(value: T | T[] | null): T | null =>
  Array.isArray(value) ? (value[0] ?? null) : value;

const COLUMNS = `
  id, item_id, batch_no, expires_on, quantity, unit_cost,
  goods_receipt_id, received_on, note,
  receipt:goods_receipts(grn_number)
`;

type Row = {
  id: string;
  item_id: string;
  batch_no: string | null;
  expires_on: string | null;
  quantity: number | string;
  unit_cost: number | string;
  goods_receipt_id: string | null;
  received_on: string;
  note: string | null;
  receipt: { grn_number: string } | { grn_number: string }[] | null;
};

const toBatch = (row: Row): Batch => ({
  id: row.id,
  itemId: row.item_id,
  batchNo: row.batch_no,
  expiresOn: row.expires_on,
  quantity: money(row.quantity),
  unitCost: money(row.unit_cost),
  goodsReceiptId: row.goods_receipt_id,
  grnNumber: embedded(row.receipt)?.grn_number ?? "",
  receivedOn: row.received_on,
  note: row.note ?? "",
});

/**
 * One item's batches, emptied ones included.
 *
 * A batch at nought is kept and shown, because "we had B-441 and wrote it off
 * in March" is the history a pharmacy is asked for — the same reason a
 * switched-off item keeps its sales. The screens grey it rather than hiding it.
 *
 * Read on demand for one item, like `listMovements`: a shop with four hundred
 * tracked lines has thousands of batches and nobody opens more than one item.
 */
export async function listBatches(
  tenantId: string,
  itemId: string,
): Promise<Batch[]> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("item_batches")
    .select(COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("item_id", itemId)
    .order("expires_on", { ascending: true, nullsFirst: false })
    .order("received_on");

  return ((data ?? []) as unknown as Row[]).map(toBatch);
}

/**
 * What every tracked item's batches come to, by item id.
 *
 * One read of the whole shop's live batches rather than one per item, which is
 * the n+1 the item list would otherwise pay on every paint. Only rows with
 * something in them: an emptied batch cannot make a list expire sooner and has
 * no business on the hot path.
 *
 * A shop with four hundred tracked lines and three live batches each is twelve
 * hundred short rows. A shop with none reads nothing, because the filter is on
 * an index that is itself partial.
 */
export async function batchSummaries(
  tenantId: string,
  today: string,
): Promise<Map<string, BatchSummary>> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("item_batches")
    .select(COLUMNS)
    .eq("tenant_id", tenantId)
    .gt("quantity", 0);

  const byItem = new Map<string, Batch[]>();

  for (const row of (data ?? []) as unknown as Row[]) {
    const batch = toBatch(row);
    const list = byItem.get(batch.itemId);
    if (list) list.push(batch);
    else byItem.set(batch.itemId, [batch]);
  }

  const summaries = new Map<string, BatchSummary>();

  for (const [itemId, batches] of byItem) {
    summaries.set(itemId, summarise(batches, today));
  }

  return summaries;
}

/**
 * What the bell needs: how many tracked items have stock going off.
 *
 * Counted here off the same read the item list makes rather than in SQL,
 * because `expiryState` is the thing that decides it and it lives in
 * TypeScript — a second definition of "going off" written as a date predicate
 * in a query is the copy that drifts, and the one it drifts from is the badge
 * the shopkeeper is looking at.
 */
export async function expiryCounts(
  tenantId: string,
  today: string,
): Promise<{ expired: number; critical: number; expiredUnits: number }> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("item_batches")
    .select("item_id, expires_on, quantity")
    .eq("tenant_id", tenantId)
    .gt("quantity", 0)
    .not("expires_on", "is", null);

  const expired = new Set<string>();
  const critical = new Set<string>();
  let expiredUnits = 0;

  for (const row of data ?? []) {
    const state = expiryState(row.expires_on as string, today);
    const itemId = row.item_id as string;

    if (state === "expired") {
      expired.add(itemId);
      expiredUnits += money(row.quantity);
    } else if (state === "critical") {
      critical.add(itemId);
    }
  }

  return {
    expired: expired.size,
    critical: critical.size,
    expiredUnits: Math.round(expiredUnits * 1000) / 1000,
  };
}
