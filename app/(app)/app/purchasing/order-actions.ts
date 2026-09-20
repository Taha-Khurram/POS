"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { requireSession, type SessionContext } from "@/lib/auth";
import { getModuleAccess } from "@/lib/pos/access";
import {
  checkOrder,
  isOrderStatus,
  lineTotalOf,
  LINE_NAME_MAX,
  type OrderStatus,
} from "@/lib/pos/purchase";
import { createAdminClient } from "@/utils/supabase/admin";

/**
 * Raising, correcting and closing a purchase order.
 *
 * The write itself is `public.save_purchase_order` — one security-definer
 * function, one transaction — for the reason the register's write is
 * `record_sale`: an order is a header and its lines, and a header written
 * without its lines is a document that says the shop asked for nothing.
 *
 * **The browser never decides what a line costs.** It sends item ids,
 * quantities and the cost off the supplier's rate list; the action re-prices
 * every line against the shop's own catalog where the item is a real one, and
 * the function recomputes the subtotal inside the transaction. That is the same
 * bargain the till strikes, one direction over.
 *
 * Who may write is `can_manage_purchasing` — deliberately not
 * `can_edit_items`, because what is typed here becomes `items.cost_price` the
 * moment a delivery lands against it, and a cost price is what every margin on
 * Reports is worked out from.
 */

export type OrderResult =
  | { ok: true; orderId: string; orderNumber: string; total: number }
  | { ok: false; error: string };

export type OrderInput = {
  /** Minted in the browser so a retry over shop 3G replays rather than raising
   *  a second order with a second number — the same trick `newSaleId` plays for
   *  a bill. `save_purchase_order` hands back the number the first attempt
   *  claimed when it sees an id it already has. */
  orderId: string;
  supplierId: string;
  /** `YYYY-MM-DD`, or "" for "when he comes". */
  expectedOn: string;
  note: string;
  status: "draft" | "placed";
  lines: {
    /** Null for a line typed against nothing in the catalog — which is how a
     *  shop orders something it does not stock yet. */
    itemId: string | null;
    name: string;
    unit: string;
    quantity: number;
    unitCost: number;
  }[];
};

/** Owner, or somebody the owner switched `can_manage_purchasing` on for. */
async function requirePurchasing() {
  const session = await requireSession();

  if (!session.tenantId) {
    return { ok: false as const, error: "This login is not linked to a shop yet." };
  }

  const access = await getModuleAccess(session);

  if (!access.purchasing) {
    return {
      ok: false as const,
      error: "You are not allowed to raise orders. Ask the owner.",
    };
  }

  return {
    ok: true as const,
    session: { ...session, tenantId: session.tenantId } as SessionContext & {
      tenantId: string;
    },
  };
}

/** Both buying screens, and the catalog — a delivery against an order moves
 *  stock and cost, and the item list is where a shopkeeper looks for it. */
function revalidateBuying() {
  revalidatePath("/app/purchasing");
  revalidatePath("/app/inventory");
}

/**
 * The lines, re-read against the shop's own catalog.
 *
 * An `item_id` the browser sent is checked against this shop's items and
 * dropped to null if it is not one — a crafted body must not be able to point
 * an order line at another shop's row, and a line whose item was deleted while
 * somebody was typing is still a line worth ordering.
 *
 * The *name* is taken from the catalog where the item is real, so the order
 * prints what the shop calls the thing rather than what a stale tab called it.
 * A free-text line keeps the name as typed, because there is nothing else.
 */
async function priceLines(
  tenantId: string,
  lines: OrderInput["lines"],
): Promise<OrderInput["lines"]> {
  const ids = [...new Set(lines.map((line) => line.itemId).filter(Boolean))] as string[];

  const known = new Map<string, { name: string; unit: string }>();

  if (ids.length > 0) {
    const { data } = await createAdminClient()
      .from("items")
      .select("id, name, unit")
      .eq("tenant_id", tenantId)
      .in("id", ids);

    for (const row of data ?? []) {
      known.set(row.id as string, {
        name: row.name as string,
        unit: row.unit as string,
      });
    }
  }

  return lines.map((line) => {
    const item = line.itemId ? known.get(line.itemId) : undefined;

    return {
      itemId: item ? line.itemId : null,
      name: (item?.name ?? line.name).trim().slice(0, LINE_NAME_MAX),
      unit: item?.unit ?? line.unit,
      quantity: line.quantity,
      unitCost: line.unitCost,
    };
  });
}

export async function saveOrder(input: OrderInput): Promise<OrderResult> {
  const gate = await requirePurchasing();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { session } = gate;

  if (input.status !== "draft" && input.status !== "placed") {
    return { ok: false, error: "An order is saved as a draft or as placed." };
  }

  const lines = await priceLines(session.tenantId, input.lines ?? []);

  // The same function the sheet greys its save button out with, so the refusal
  // read here is the sentence the form was already showing.
  const complaint = checkOrder({
    supplierId: input.supplierId,
    expectedOn: input.expectedOn,
    note: input.note ?? "",
    lines,
  });

  if (complaint) return { ok: false, error: complaint };

  const { data, error } = await createAdminClient().rpc("save_purchase_order", {
    p_tenant: session.tenantId,
    p_order_id: input.orderId,
    p_supplier: input.supplierId,
    p_expected_on: input.expectedOn || null,
    p_note: input.note ?? "",
    p_status: input.status,
    p_lines: lines.map((line) => ({
      item_id: line.itemId,
      name: line.name,
      unit: line.unit,
      quantity: line.quantity,
      unit_cost: line.unitCost,
      line_total: lineTotalOf(line),
    })),
    p_by: session.userId,
  });

  const orderNumber =
    data && typeof data === "object" && "order_number" in data
      ? String((data as { order_number: unknown }).order_number)
      : null;

  if (error || !orderNumber) {
    console.error("[purchasing] save_purchase_order failed", error);

    // The function's own refusals are sentences somebody can act on — an order
    // frozen by a delivery against it, a supplier that is not this shop's — so
    // they are passed through rather than flattened into "could not save".
    return {
      ok: false,
      error:
        error?.message?.replace(/^.*?:\s*/, "") ??
        "We could not save that order. Check the connection and try again.",
    };
  }

  await recordAudit(session, {
    action: input.status === "placed" ? "purchase_order.placed" : "purchase_order.saved",
    subjectType: "purchase_order",
    subjectId: input.orderId,
    after: {
      order_number: orderNumber,
      supplier_id: input.supplierId,
      status: input.status,
      lines: lines.length,
      total:
        data && typeof data === "object" && "total" in data
          ? Number((data as { total: unknown }).total)
          : null,
    },
  });

  revalidateBuying();

  return {
    ok: true,
    orderId: input.orderId,
    orderNumber,
    total:
      data && typeof data === "object" && "total" in data
        ? Number((data as { total: unknown }).total)
        : 0,
  };
}

/**
 * Moving an order along without touching its lines.
 *
 * Separate from the save because closing or cancelling is something you do to
 * an order that is already part-delivered — and `save_purchase_order` refuses
 * to touch one of those, correctly: deleting a line a delivery points at would
 * leave goods that physically arrived against an order that no longer asks for
 * them.
 */
export async function setOrderStatus(
  orderId: string,
  status: OrderStatus,
): Promise<OrderResult> {
  const gate = await requirePurchasing();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { session } = gate;

  if (!isOrderStatus(status)) {
    return { ok: false, error: "That is not a status an order can be in." };
  }

  const { data, error } = await createAdminClient().rpc("set_purchase_order_status", {
    p_tenant: session.tenantId,
    p_order: orderId,
    p_status: status,
  });

  const orderNumber =
    data && typeof data === "object" && "order_number" in data
      ? String((data as { order_number: unknown }).order_number)
      : null;

  if (error || !orderNumber) {
    console.error("[purchasing] set_purchase_order_status failed", error);
    return { ok: false, error: "We could not change that order. Please try again." };
  }

  await recordAudit(session, {
    action: "purchase_order.status",
    subjectType: "purchase_order",
    subjectId: orderId,
    after: { order_number: orderNumber, status },
  });

  revalidateBuying();

  return { ok: true, orderId, orderNumber, total: 0 };
}
