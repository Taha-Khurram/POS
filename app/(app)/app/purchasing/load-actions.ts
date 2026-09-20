"use server";

import { requireSession } from "@/lib/auth";
import { getModuleAccess } from "@/lib/pos/access";
import type {
  GoodsReceiptDetail,
  PurchaseOrderDetail,
} from "@/lib/pos/purchase";
import { getGoodsReceipt, getPurchaseOrder } from "@/lib/pos/purchases";

/**
 * Reading one order or one delivery, lines and all.
 *
 * Reads through a Server Action rather than data shipped with the page, the
 * same call `loadBill` makes on `/app/sales` and `loadMovements` on the product
 * sheet: a shop's four hundred orders have thousands of lines between them, and
 * nobody opens more than one at a time.
 *
 * The gate is the same `requireSession` plus module check every write here
 * carries, because a screen that does not draw a button is not a screen that
 * stops anybody calling the action behind it. Null for anything that is not
 * this shop's — the caller closes the sheet, which is the honest answer and
 * says nothing about whether the row exists.
 */

async function reader() {
  const session = await requireSession();
  if (!session.tenantId) return null;

  const access = await getModuleAccess(session);
  if (!access.purchasing) return null;

  return session.tenantId;
}

export async function loadOrder(
  orderId: string,
): Promise<PurchaseOrderDetail | null> {
  const tenantId = await reader();
  if (!tenantId || typeof orderId !== "string" || !orderId) return null;

  return getPurchaseOrder(tenantId, orderId);
}

export async function loadReceipt(
  receiptId: string,
): Promise<GoodsReceiptDetail | null> {
  const tenantId = await reader();
  if (!tenantId || typeof receiptId !== "string" || !receiptId) return null;

  return getGoodsReceipt(tenantId, receiptId);
}
