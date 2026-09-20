import "server-only";

import { cookies } from "next/headers";

import { MOVEMENTS_MAX, type Movement } from "@/lib/pos/stock";
import { createClient } from "@/utils/supabase/server";

/**
 * An item's stock ledger, read as rows.
 *
 * Through the shop's own JWT rather than the service role, like `items.ts`,
 * `bills.ts` and the readers in `shop.ts`: `stock_movements_read_own` scopes to
 * the `tenant_id` claim, so RLS is the gate and a bug in this file cannot hand
 * one shop another's stocktake. Nothing here writes, and there is no write path
 * for a movement anywhere — `private.move_stock` is the only writer and it is
 * revoked from everybody, reachable only from inside `record_sale`,
 * `record_return` and `set_stock`. A ledger a screen can edit is not a ledger.
 *
 * Read on demand rather than with the catalog: a shop with four hundred items
 * has a movement table with tens of thousands of rows in it, and nobody opens
 * more than one item at a time. This is the read the product sheet waits on,
 * and it is the only round trip opening an item costs.
 *
 * Deliberately NOT wrapped in React `cache()`, for the reason none of the
 * readers in `lib/pos/` are.
 */

type Row = {
  id: string;
  reason: string;
  quantity: number | string;
  stock_after: number | string;
  sale_id: string | null;
  goods_receipt_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  sales: { receipt_number: string } | null;
  goods_receipts: { grn_number: string } | null;
};

/**
 * The last `MOVEMENTS_MAX` movements against one item, newest first.
 *
 * The receipt number is embedded on `sales` rather than looked up afterwards,
 * because it is the one thing that makes a "Sold −2" row actionable: it is what
 * the owner searches the sales history for when the count and the shelf
 * disagree. The GRN number is embedded beside it for the mirror reason, since
 * `0028`: a "Delivered +24" row is only worth reading if it names the invoice
 * that brought them in.
 *
 * The staff roster is handed in rather than re-read. It is already in hand
 * wherever this is called from, and resolving the name here is what keeps the
 * roster off the wire — the browser sees "Bilal", never the list of everybody
 * who could have done it.
 */
export async function listMovements(
  tenantId: string,
  itemId: string,
  staff: { id: string; name: string }[],
): Promise<Movement[]> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("stock_movements")
    .select(
      "id, reason, quantity, stock_after, sale_id, goods_receipt_id, note, created_by, created_at, sales ( receipt_number ), goods_receipts ( grn_number )",
    )
    .eq("tenant_id", tenantId)
    .eq("item_id", itemId)
    .order("created_at", { ascending: false })
    .limit(MOVEMENTS_MAX);

  return ((data ?? []) as unknown as Row[]).map((row) => ({
    id: row.id,
    reason: row.reason,
    quantity: Number(row.quantity) || 0,
    stockAfter: Number(row.stock_after) || 0,
    receiptNo: row.sales?.receipt_number ?? null,
    saleId: row.sale_id,
    grnNumber: row.goods_receipts?.grn_number ?? null,
    note: row.note ?? "",
    // A movement whose author has left keeps the movement. `created_by` is
    // `on delete set null`, so this is the honest answer and not a bug — the
    // same bargain `bills.ts` strikes with a former cashier's receipts.
    by:
      staff.find((person) => person.id === row.created_by)?.name ??
      (row.created_by ? "Former staff" : "—"),
    at: row.created_at,
  }));
}
