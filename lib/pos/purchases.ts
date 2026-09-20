import "server-only";

import { cookies } from "next/headers";

import type {
  GoodsReceipt,
  GoodsReceiptDetail,
  OrderLine,
  PurchaseOrder,
  PurchaseOrderDetail,
} from "@/lib/pos/purchase";
import { PURCHASE_MAX, type OrderStatus } from "@/lib/pos/purchase";
import { createClient } from "@/utils/supabase/server";

/**
 * Orders and deliveries, read as rows.
 *
 * Through the shop's own JWT, like every other reader in `lib/pos/`: the four
 * `*_read_own` policies scope the rows to the `tenant_id` claim, so RLS is the
 * gate and the read doubles as a live check that the access-token hook is
 * stamping claims.
 *
 * Writes are `order-actions.ts` and `receipt-actions.ts` on the service role,
 * because `0028` revoked insert/update/delete from `authenticated` outright and
 * the two functions behind them are granted to `service_role` alone.
 *
 * Deliberately NOT wrapped in React `cache()`, for the reason none of the other
 * readers are: a Server Action plus the re-render its `revalidatePath` triggers
 * are one request, and a memoised read hands that re-render the list as it
 * stood before the save.
 */

const money = (value: number | string | null) => Number(value ?? 0) || 0;

/** The one row of a to-one embed, whichever shape supabase-js typed it as —
 *  the same normaliser `items.ts` carries, and for the same reason: with no
 *  generated database types the client infers an array for a many-to-one. */
const embedded = <T,>(value: T | T[] | null): T | null =>
  Array.isArray(value) ? (value[0] ?? null) : value;

/* ---------------- Orders ---------------- */

const ORDER_COLUMNS = `
  id, order_number, supplier_id, status, expected_on, note,
  subtotal, total, created_at,
  supplier:suppliers(name)
`;

type OrderRow = {
  id: string;
  order_number: string;
  supplier_id: string;
  status: string;
  expected_on: string | null;
  note: string | null;
  subtotal: number | string;
  total: number | string;
  created_at: string;
  supplier: { name: string } | { name: string }[] | null;
};

/**
 * Every order, newest first, with how much of each has landed.
 *
 * Two reads rather than one: the orders, and then every line of those orders
 * with the receipt quantities against them. That second read is what makes the
 * list able to say "12 of 30 arrived" without a stored counter — which is the
 * whole design decision `0028` made, and it has to be paid for somewhere.
 *
 * It is paid once for the page rather than once per row, which is the n+1 this
 * would otherwise be. A shop's four hundred orders have a few thousand lines
 * between them; that is one round trip of two numeric columns.
 */
export async function listPurchaseOrders(
  tenantId: string,
): Promise<PurchaseOrder[]> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("purchase_orders")
    .select(ORDER_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(PURCHASE_MAX);

  const rows = (data ?? []) as unknown as OrderRow[];
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);

  const { data: lines } = await supabase
    .from("purchase_order_lines")
    .select("id, purchase_order_id, quantity")
    .in("purchase_order_id", ids);

  const lineIds = (lines ?? []).map((line) => line.id as string);

  const { data: received } = lineIds.length
    ? await supabase
        .from("goods_receipt_lines")
        .select("purchase_order_line_id, quantity")
        .in("purchase_order_line_id", lineIds)
    : { data: [] };

  // How much has landed against each *line*, then rolled up to the order.
  const gotByLine = new Map<string, number>();
  for (const row of received ?? []) {
    const key = row.purchase_order_line_id as string;
    gotByLine.set(key, (gotByLine.get(key) ?? 0) + money(row.quantity));
  }

  const counts = new Map<string, { lines: number; receivedLines: number }>();

  for (const line of lines ?? []) {
    const orderId = line.purchase_order_id as string;
    const tally = counts.get(orderId) ?? { lines: 0, receivedLines: 0 };
    tally.lines += 1;
    // A line counts as received when the whole of it has arrived, not when any
    // of it has — "9 of 12 lines in" is the sentence a shop chases an order
    // with, and a line half delivered is still a line to chase.
    if ((gotByLine.get(line.id as string) ?? 0) >= money(line.quantity)) {
      tally.receivedLines += 1;
    }
    counts.set(orderId, tally);
  }

  return rows.map((row) => {
    const tally = counts.get(row.id) ?? { lines: 0, receivedLines: 0 };

    return {
      id: row.id,
      orderNumber: row.order_number,
      supplierId: row.supplier_id,
      supplierName: embedded(row.supplier)?.name ?? "",
      status: row.status as OrderStatus,
      expectedOn: row.expected_on,
      note: row.note ?? "",
      subtotal: money(row.subtotal),
      total: money(row.total),
      createdAt: row.created_at,
      lines: tally.lines,
      receivedLines: tally.receivedLines,
    };
  });
}

/** One order and its lines, with what has arrived against each. */
export async function getPurchaseOrder(
  tenantId: string,
  orderId: string,
): Promise<PurchaseOrderDetail | null> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("purchase_orders")
    .select(ORDER_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", orderId)
    .maybeSingle();

  if (!data) return null;
  const row = data as unknown as OrderRow;

  const { data: lines } = await supabase
    .from("purchase_order_lines")
    .select("id, item_id, name_snapshot, unit, quantity, unit_cost")
    .eq("purchase_order_id", orderId)
    .order("created_at");

  const lineIds = (lines ?? []).map((line) => line.id as string);

  const { data: received } = lineIds.length
    ? await supabase
        .from("goods_receipt_lines")
        .select("purchase_order_line_id, quantity")
        .in("purchase_order_line_id", lineIds)
    : { data: [] };

  const gotByLine = new Map<string, number>();
  for (const entry of received ?? []) {
    const key = entry.purchase_order_line_id as string;
    gotByLine.set(key, (gotByLine.get(key) ?? 0) + money(entry.quantity));
  }

  const items: OrderLine[] = (lines ?? []).map((line) => ({
    // The database id, so the receiving sheet can point a delivery line at it.
    key: line.id as string,
    itemId: (line.item_id as string | null) ?? null,
    name: line.name_snapshot as string,
    unit: line.unit as string,
    quantity: money(line.quantity),
    unitCost: money(line.unit_cost),
    received: gotByLine.get(line.id as string) ?? 0,
  }));

  return {
    id: row.id,
    orderNumber: row.order_number,
    supplierId: row.supplier_id,
    supplierName: embedded(row.supplier)?.name ?? "",
    status: row.status as OrderStatus,
    expectedOn: row.expected_on,
    note: row.note ?? "",
    subtotal: money(row.subtotal),
    total: money(row.total),
    createdAt: row.created_at,
    items,
  };
}

/**
 * The orders still worth receiving against, for the delivery sheet's picker.
 *
 * Placed only, and never draft: a draft has not been sent to anybody, so a
 * delivery against one would mean the van arrived before the order did. Closed
 * and cancelled are out for the obvious reason.
 */
export async function listOpenOrders(
  tenantId: string,
  supplierId: string,
): Promise<PurchaseOrderDetail[]> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("purchase_orders")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("supplier_id", supplierId)
    .eq("status", "placed")
    .order("created_at", { ascending: false })
    .limit(20);

  const orders = await Promise.all(
    (data ?? []).map((row) => getPurchaseOrder(tenantId, row.id as string)),
  );

  // Fully delivered orders are dropped here rather than in SQL, because "is it
  // fully delivered" is derived from the receipt lines and there is no column
  // to filter on — which is the trade `0028` took on purpose.
  return orders.filter(
    (order): order is PurchaseOrderDetail =>
      order !== null && order.items.some((line) => line.received < line.quantity),
  );
}

/* ---------------- Deliveries ---------------- */

const RECEIPT_COLUMNS = `
  id, grn_number, supplier_id, purchase_order_id, received_on,
  supplier_invoice_no, note, subtotal, freight, other_cost, total, created_at,
  supplier:suppliers(name),
  order:purchase_orders(order_number)
`;

type ReceiptRow = {
  id: string;
  grn_number: string;
  supplier_id: string;
  purchase_order_id: string | null;
  received_on: string;
  supplier_invoice_no: string | null;
  note: string | null;
  subtotal: number | string;
  freight: number | string;
  other_cost: number | string;
  total: number | string;
  created_at: string;
  supplier: { name: string } | { name: string }[] | null;
  order: { order_number: string } | { order_number: string }[] | null;
};

const toReceipt = (row: ReceiptRow, lines: number): GoodsReceipt => ({
  id: row.id,
  grnNumber: row.grn_number,
  supplierId: row.supplier_id,
  supplierName: embedded(row.supplier)?.name ?? "",
  orderId: row.purchase_order_id,
  orderNumber: embedded(row.order)?.order_number ?? "",
  receivedOn: row.received_on,
  supplierInvoiceNo: row.supplier_invoice_no ?? "",
  note: row.note ?? "",
  subtotal: money(row.subtotal),
  freight: money(row.freight),
  otherCost: money(row.other_cost),
  total: money(row.total),
  createdAt: row.created_at,
  lines,
});

/** Every delivery, newest arrival first. */
export async function listGoodsReceipts(
  tenantId: string,
): Promise<GoodsReceipt[]> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("goods_receipts")
    .select(RECEIPT_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("received_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(PURCHASE_MAX);

  const rows = (data ?? []) as unknown as ReceiptRow[];
  if (rows.length === 0) return [];

  const { data: lines } = await supabase
    .from("goods_receipt_lines")
    .select("goods_receipt_id")
    .in(
      "goods_receipt_id",
      rows.map((row) => row.id),
    );

  const counts = new Map<string, number>();
  for (const line of lines ?? []) {
    const key = line.goods_receipt_id as string;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return rows.map((row) => toReceipt(row, counts.get(row.id) ?? 0));
}

/** One delivery and everything that came on it, landed cost included. */
export async function getGoodsReceipt(
  tenantId: string,
  receiptId: string,
): Promise<GoodsReceiptDetail | null> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("goods_receipts")
    .select(RECEIPT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", receiptId)
    .maybeSingle();

  if (!data) return null;
  const row = data as unknown as ReceiptRow;

  const { data: lines } = await supabase
    .from("goods_receipt_lines")
    .select(
      "id, item_id, purchase_order_line_id, name_snapshot, unit, quantity, unit_cost, line_total, landed_unit_cost",
    )
    .eq("goods_receipt_id", receiptId)
    .order("created_at");

  const base = toReceipt(row, (lines ?? []).length);

  return {
    ...base,
    items: (lines ?? []).map((line) => ({
      key: line.id as string,
      itemId: (line.item_id as string | null) ?? null,
      orderLineId: (line.purchase_order_line_id as string | null) ?? null,
      name: line.name_snapshot as string,
      unit: line.unit as string,
      quantity: money(line.quantity),
      unitCost: money(line.unit_cost),
      lineTotal: money(line.line_total),
      // Read back off the stored column, never re-derived. That is the whole
      // reason `0028` stores it: correcting the freight next week must not
      // rewrite what this delivery cost.
      landedUnitCost: money(line.landed_unit_cost),
    })),
  };
}

/**
 * What the shop has bought lately, totalled.
 *
 * Off the receipts already read rather than a second query — the Buying screen
 * needs both and a `sum()` round trip for three tiles is a round trip too many.
 */
export function purchaseTotals(receipts: GoodsReceipt[]) {
  const spent = receipts.reduce((total, receipt) => total + receipt.total, 0);
  const freight = receipts.reduce(
    (total, receipt) => total + receipt.freight + receipt.otherCost,
    0,
  );

  return {
    deliveries: receipts.length,
    spent: Math.round(spent * 100) / 100,
    freight: Math.round(freight * 100) / 100,
  };
}
