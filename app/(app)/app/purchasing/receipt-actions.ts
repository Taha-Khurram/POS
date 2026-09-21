"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { requireSession, type SessionContext } from "@/lib/auth";
import { getModuleAccess } from "@/lib/pos/access";
import {
  checkReceipt,
  lineTotalOf,
  receiptTotals,
  LINE_NAME_MAX,
} from "@/lib/pos/purchase";
import { createAdminClient } from "@/utils/supabase/admin";

/**
 * Taking a delivery in.
 *
 * The write is `public.record_receipt` — one security-definer function, one
 * transaction — which claims the GRN number, writes the lines, apportions the
 * freight into a landed unit cost, puts the stock on the shelf through
 * `private.move_stock` and sets `items.cost_price`. All of it or none of it: a
 * delivery recorded against a shelf that does not know is the hole `0022`
 * closed for sales, and a cost price moved without the invoice that justifies
 * it is a margin nobody can explain.
 *
 * **This is the action that changes what the shop believes its stock costs**,
 * which is why it is gated by `can_manage_purchasing` and not by
 * `can_edit_items`: every margin on Reports and every future
 * `sale_lines.cost_snapshot` is worked out from the number this writes.
 *
 * Past sales are untouched. `cost_snapshot` stamped what each one cost at the
 * time, which is the whole reason that column exists — last month's margins do
 * not move because this month's freight was dearer.
 */

export type ReceiptResult =
  | { ok: true; receiptId: string; grnNumber: string; total: number; replayed: boolean }
  | { ok: false; error: string };

export type ReceiptInput = {
  /** Minted in the browser so a retry replays instead of putting the delivery
   *  on the shelf twice — the same trick `newSaleId` plays for a bill, and here
   *  it matters more: a double-counted delivery is a shelf count nobody can
   *  reconcile without reading the ledger. */
  receiptId: string;
  supplierId: string;
  /** The order this satisfies, or "" for a van that turned up — which is most
   *  kiryana buying, and is why the column is nullable. */
  orderId: string;
  /** `YYYY-MM-DD`. The day the goods arrived, which is not always the day
   *  somebody typed them in. */
  receivedOn: string;
  supplierInvoiceNo: string;
  note: string;
  freight: number;
  otherCost: number;
  lines: {
    itemId: string | null;
    /** The order line this satisfies, when receiving against an order. */
    orderLineId: string | null;
    name: string;
    unit: string;
    quantity: number;
    unitCost: number;
    /** Off the carton, for a batch-tracked item. Blank for everything else, and
     *  blank is allowed even for a tracked one — the person at the door has a
     *  queue behind them, and a delivery recorded without a batch is worth more
     *  than a delivery not recorded. `record_receipt` puts it in the item's
     *  plain stock and the Products screen says so. */
    batchNo?: string;
    expiresOn?: string;
  }[];
};

async function requirePurchasing() {
  const session = await requireSession();

  if (!session.tenantId) {
    return { ok: false as const, error: "This login is not linked to a shop yet." };
  }

  const access = await getModuleAccess(session);

  if (!access.purchasing) {
    return {
      ok: false as const,
      error: "You are not allowed to take a delivery in. Ask the owner.",
    };
  }

  return {
    ok: true as const,
    session: { ...session, tenantId: session.tenantId } as SessionContext & {
      tenantId: string;
    },
  };
}

export async function recordGoodsReceipt(
  input: ReceiptInput,
): Promise<ReceiptResult> {
  const gate = await requirePurchasing();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { session } = gate;

  const supabase = createAdminClient();

  // Item ids re-read against the shop's own catalog. A crafted body must not be
  // able to stock another shop's shelf or move its cost price, and a line whose
  // item was deleted while the delivery was being typed is still a delivery
  // that arrived and a supplier who is still owed.
  const ids = [
    ...new Set((input.lines ?? []).map((line) => line.itemId).filter(Boolean)),
  ] as string[];

  const known = new Map<string, { name: string; unit: string }>();

  if (ids.length > 0) {
    const { data } = await supabase
      .from("items")
      .select("id, name, unit")
      .eq("tenant_id", session.tenantId)
      .in("id", ids);

    for (const row of data ?? []) {
      known.set(row.id as string, {
        name: row.name as string,
        unit: row.unit as string,
      });
    }
  }

  const lines = (input.lines ?? []).map((line) => {
    const item = line.itemId ? known.get(line.itemId) : undefined;

    return {
      itemId: item ? line.itemId : null,
      orderLineId: line.orderLineId,
      name: (item?.name ?? line.name).trim().slice(0, LINE_NAME_MAX),
      unit: item?.unit ?? line.unit,
      quantity: line.quantity,
      unitCost: line.unitCost,
      // Kept as typed and validated by the function, which is the side that
      // knows whether the item is tracked at all — a flag the browser sent
      // about somebody else's item is not a flag worth reading.
      batchNo: (line.batchNo ?? "").trim().slice(0, 60),
      expiresOn: /^\d{4}-\d{2}-\d{2}$/.test(line.expiresOn ?? "")
        ? (line.expiresOn as string)
        : "",
    };
  });

  // The same function the sheet greys its save button out with.
  const complaint = checkReceipt({
    supplierId: input.supplierId,
    receivedOn: input.receivedOn,
    supplierInvoiceNo: input.supplierInvoiceNo ?? "",
    note: input.note ?? "",
    freight: input.freight,
    otherCost: input.otherCost,
    lines,
  });

  if (complaint) return { ok: false, error: complaint };

  // Worked out here too, and only so the audit entry and the toast can quote a
  // figure. The one that lands is the function's own — it re-does every bit of
  // this inside the transaction, which is what makes the stored landed cost
  // something the shop can be held to.
  const totals = receiptTotals(lines, input.freight, input.otherCost);

  const { data, error } = await supabase.rpc("record_receipt", {
    p_tenant: session.tenantId,
    p_grn_id: input.receiptId,
    p_supplier: input.supplierId,
    p_order: input.orderId || null,
    p_received_on: input.receivedOn,
    p_invoice_no: input.supplierInvoiceNo ?? "",
    p_note: input.note ?? "",
    p_freight: Math.max(0, input.freight),
    p_other: Math.max(0, input.otherCost),
    p_lines: lines.map((line) => ({
      item_id: line.itemId,
      po_line_id: line.orderLineId,
      name: line.name,
      unit: line.unit,
      quantity: line.quantity,
      unit_cost: line.unitCost,
      line_total: lineTotalOf(line),
      batch_no: line.batchNo || null,
      expires_on: line.expiresOn || null,
    })),
    p_by: session.userId,
  });

  const grnNumber =
    data && typeof data === "object" && "grn_number" in data
      ? String((data as { grn_number: unknown }).grn_number)
      : null;

  if (error || !grnNumber) {
    console.error("[purchasing] record_receipt failed", error);

    return {
      ok: false,
      error:
        error?.message?.replace(/^.*?:\s*/, "") ??
        "We could not record that delivery. Nothing went onto the shelf — check the connection and try again.",
    };
  }

  const replayed =
    data && typeof data === "object" && "replayed" in data
      ? Boolean((data as { replayed: unknown }).replayed)
      : false;

  // A replay is one delivery arriving twice, not two deliveries. Auditing it
  // again would put two entries against one GRN and make the log overstate what
  // the shop bought — the same call `recordSale` makes.
  if (!replayed) {
    await recordAudit(session, {
      action: "goods_receipt.recorded",
      subjectType: "goods_receipt",
      subjectId: input.receiptId,
      after: {
        grn_number: grnNumber,
        supplier_id: input.supplierId,
        purchase_order_id: input.orderId || null,
        received_on: input.receivedOn,
        supplier_invoice_no: input.supplierInvoiceNo || null,
        subtotal: totals.subtotal,
        freight: input.freight,
        other_cost: input.otherCost,
        total: totals.total,
        lines: lines.length,
        // Named because a wrong expiry date is the one field on a delivery
        // nobody catches until stock is refused at the till months later.
        batches: lines
          .filter((line) => line.batchNo || line.expiresOn)
          .map((line) => ({
            item_id: line.itemId,
            batch_no: line.batchNo || null,
            expires_on: line.expiresOn || null,
          })),
        // Audited by name because this is the write that moves what the shop
        // believes its stock costs. "Why did the margin on the atta drop in
        // March" has to be answerable, and this is the entry that answers it.
        cost_changes: lines
          .map((line, index) =>
            line.itemId
              ? { item_id: line.itemId, landed: totals.landed[index].landedUnitCost }
              : null,
          )
          .filter(Boolean),
      },
    });
  }

  // Buying, the item list (stock and cost both moved) and the register, which
  // reads the catalog it sells from.
  revalidatePath("/app/purchasing");
  revalidatePath("/app/inventory");
  revalidatePath("/app/register");

  return {
    ok: true,
    receiptId: input.receiptId,
    grnNumber,
    total:
      data && typeof data === "object" && "total" in data
        ? Number((data as { total: unknown }).total)
        : totals.total,
    replayed,
  };
}
