"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit";
import { requireSession, type SessionContext } from "@/lib/auth";
import { getModuleAccess, getTillAccess } from "@/lib/pos/access";
import { businessDayOf, isTender, round2, type TenderPart } from "@/lib/pos/counter";
import {
  checkOrderOpen,
  isCourse,
  LINE_NOTE_MAX,
  type CourseId,
  type ServiceId,
} from "@/lib/pos/restaurant";
import { getShopSettings } from "@/lib/pos/shop";
import { createAdminClient } from "@/utils/supabase/admin";

/**
 * The floor: seating a party, taking the order, firing the kitchen, settling.
 *
 * Every write is a security-definer function, and each one exists because the
 * thing it does is more than one statement that has to be true together — a
 * ticket and the lines it fired, a sale and the order it came from.
 *
 * **Nothing here prices anything.** The browser sends item ids and quantities;
 * the action re-reads the menu and stamps the price onto the line, and
 * `settle_table_order` folds the modifiers in and hands `record_sale` the
 * result. That is the same trust boundary the till keeps, one screen over.
 *
 * Gated by the `tables` module, which is on for everybody a shop lets near the
 * register — taking an order is the floor's whole job. Settling additionally
 * needs an open drawer and re-checks the discount ceiling against this
 * session's own permissions, exactly as the register does.
 */

export type FloorResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireFloor() {
  const session = await requireSession();

  if (!session.tenantId) {
    return { ok: false as const, error: "This login is not linked to a shop yet." };
  }

  const access = await getModuleAccess(session);

  if (!access.tables) {
    return {
      ok: false as const,
      error: "Tables are not switched on for this shop.",
    };
  }

  return {
    ok: true as const,
    session: { ...session, tenantId: session.tenantId } as SessionContext & {
      tenantId: string;
    },
  };
}

/** The floor map, and the register — a settled order becomes a sale there. */
function revalidateFloor() {
  revalidatePath("/app/tables");
  revalidatePath("/app/sales");
}

/** The sentence a function raised, without Postgres' own prefix. The functions
 *  here refuse in words a waiter can act on — "that table already has a bill
 *  open on it" — so the message is passed through rather than flattened. */
const said = (message: string | undefined, fallback: string) =>
  message?.replace(/^.*?:\s*/, "") ?? fallback;

// -----------------------------------------------------------------------------
// Seating
// -----------------------------------------------------------------------------

export async function openOrder(input: {
  /** Minted in the browser so a waiter's retry on shop Wi-Fi replays rather
   *  than opening a second bill for one party. */
  orderId: string;
  tableId: string;
  service: ServiceId;
  covers: number | null;
  customerId: string | null;
}): Promise<FloorResult<{ orderId: string; orderNumber: string }>> {
  const gate = await requireFloor();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { session } = gate;

  if (!UUID.test(input.orderId)) {
    return { ok: false, error: "That order is malformed. Start it again." };
  }

  const complaint = checkOrderOpen({
    service: input.service,
    tableId: input.tableId,
    covers: input.covers,
  });

  if (complaint) return { ok: false, error: complaint };

  const { data, error } = await createAdminClient().rpc("open_table_order", {
    p_tenant: session.tenantId,
    p_order_id: input.orderId,
    p_table: input.tableId || null,
    p_service: input.service,
    p_covers: input.covers,
    p_customer: input.customerId || null,
    p_by: session.userId,
  });

  const orderNumber =
    data && typeof data === "object" && "order_number" in data
      ? String((data as { order_number: unknown }).order_number)
      : null;

  if (error || !orderNumber) {
    console.error("[tables] open_table_order failed", error);
    return {
      ok: false,
      error: said(error?.message, "We could not open that table. Please try again."),
    };
  }

  revalidateFloor();

  return { ok: true, orderId: input.orderId, orderNumber };
}

// -----------------------------------------------------------------------------
// Taking the order
// -----------------------------------------------------------------------------

export async function addLines(input: {
  orderId: string;
  lines: {
    itemId: string;
    variantId: string | null;
    quantity: number;
    course: CourseId;
    note: string;
    /** Which modifiers were ticked. Ids only — the price comes off the shop's
     *  own rows on this side, never from the browser. */
    modifierIds: string[];
  }[];
}): Promise<FloorResult<{ added: number }>> {
  const gate = await requireFloor();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { session } = gate;

  const wanted = (input.lines ?? []).filter((line) => line.quantity > 0);

  if (wanted.length === 0) return { ok: true, added: 0 };

  if (!wanted.every((line) => UUID.test(line.itemId))) {
    return { ok: false, error: "That order is malformed. Start it again." };
  }

  const supabase = createAdminClient();

  // The menu, re-read. This is the whole of the trust boundary: the tablet
  // chooses what and how many, this side decides what it costs.
  const { data: menu } = await supabase
    .from("items")
    .select("id, name, unit, selling_price")
    .eq("tenant_id", session.tenantId)
    .eq("is_active", true)
    .in("id", [...new Set(wanted.map((line) => line.itemId))]);

  const priced = new Map((menu ?? []).map((row) => [row.id as string, row]));

  // The modifiers too, by id, so a ticked "extra cheese" is charged what the
  // shop says it costs rather than what a crafted body claims.
  const modifierIds = [...new Set(wanted.flatMap((line) => line.modifierIds ?? []))];

  const mods = new Map<string, { id: string; item_id: string; name: string; price_delta: number }>();

  if (modifierIds.length > 0) {
    const { data } = await supabase
      .from("item_modifiers")
      .select("id, item_id, name, price_delta")
      .eq("tenant_id", session.tenantId)
      .eq("is_active", true)
      .in("id", modifierIds);

    for (const row of data ?? []) mods.set(row.id as string, row as never);
  }

  const lines = wanted.map((line) => {
    const item = priced.get(line.itemId);
    if (!item) return null;

    return {
      item_id: item.id,
      variant_id: line.variantId && UUID.test(line.variantId) ? line.variantId : null,
      name: item.name,
      unit: item.unit,
      quantity: line.quantity,
      unit_price: Number(item.selling_price) || 0,
      course: isCourse(line.course) ? line.course : "main",
      note: (line.note ?? "").trim().slice(0, LINE_NOTE_MAX),
      // Only the modifiers that belong to *this* item. A body pairing a cheap
      // dish with another dish's expensive add-on is the one way this endpoint
      // could be made to mis-price a bill.
      modifiers: (line.modifierIds ?? [])
        .map((id) => mods.get(id))
        .filter((mod) => mod && mod.item_id === item.id)
        .map((mod) => ({
          id: mod!.id,
          name: mod!.name,
          price_delta: Number(mod!.price_delta) || 0,
        })),
    };
  });

  if (lines.some((line) => line === null)) {
    return { ok: false, error: "One of those dishes is no longer on the menu." };
  }

  const { data, error } = await supabase.rpc("add_order_lines", {
    p_tenant: session.tenantId,
    p_order: input.orderId,
    p_lines: lines,
    p_by: session.userId,
  });

  if (error) {
    console.error("[tables] add_order_lines failed", error);
    return {
      ok: false,
      error: said(error.message, "We could not add that to the bill. Please try again."),
    };
  }

  revalidateFloor();

  return {
    ok: true,
    added:
      data && typeof data === "object" && "added" in data
        ? Number((data as { added: unknown }).added)
        : lines.length,
  };
}

// -----------------------------------------------------------------------------
// The kitchen
// -----------------------------------------------------------------------------

export async function sendToKitchen(
  orderId: string,
  note = "",
): Promise<FloorResult<{ sent: number; kotNumber: string | null }>> {
  const gate = await requireFloor();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { session } = gate;

  const { data, error } = await createAdminClient().rpc("send_to_kitchen", {
    p_tenant: session.tenantId,
    p_order: orderId,
    p_by: session.userId,
    p_note: note.trim().slice(0, LINE_NOTE_MAX) || null,
  });

  if (error) {
    console.error("[tables] send_to_kitchen failed", error);
    return {
      ok: false,
      error: said(error.message, "We could not send that to the kitchen."),
    };
  }

  const sent =
    data && typeof data === "object" && "sent" in data
      ? Number((data as { sent: unknown }).sent)
      : 0;

  const kotNumber =
    data && typeof data === "object" && "kot_number" in data
      ? ((data as { kot_number: unknown }).kot_number as string | null)
      : null;

  // Nothing to send is not an event. A double tap gets `sent: 0` back and the
  // screen says so rather than announcing a ticket nobody printed.
  if (sent > 0) {
    await recordAudit(session, {
      action: "kot.sent",
      subjectType: "table_order",
      subjectId: orderId,
      after: { kot_number: kotNumber, lines: sent },
    });

    revalidateFloor();
  }

  return { ok: true, sent, kotNumber };
}

export async function voidLine(
  lineId: string,
  reason: string,
): Promise<FloorResult<{ voided: boolean; deleted: boolean }>> {
  const gate = await requireFloor();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { session } = gate;

  const { data, error } = await createAdminClient().rpc("void_order_line", {
    p_tenant: session.tenantId,
    p_line: lineId,
    p_reason: reason.trim().slice(0, LINE_NOTE_MAX) || null,
    p_by: session.userId,
  });

  if (error) {
    console.error("[tables] void_order_line failed", error);
    return { ok: false, error: said(error.message, "We could not take that off.") };
  }

  const voided =
    data && typeof data === "object" && "voided" in data
      ? Boolean((data as { voided: unknown }).voided)
      : false;

  // Only a line that reached the kitchen is worth an entry. Deleting something
  // that was never fired is a mistype being corrected, and a log full of those
  // is a log nobody reads for the one that matters.
  if (voided) {
    await recordAudit(session, {
      action: "order_line.voided",
      subjectType: "table_order_line",
      subjectId: lineId,
      after: { reason },
    });
  }

  revalidateFloor();

  return {
    ok: true,
    voided,
    deleted:
      data && typeof data === "object" && "deleted" in data
        ? Boolean((data as { deleted: unknown }).deleted)
        : false,
  };
}

export async function moveOrder(
  orderId: string,
  tableId: string,
): Promise<FloorResult<object>> {
  const gate = await requireFloor();
  if (!gate.ok) return { ok: false, error: gate.error };

  const { error } = await createAdminClient().rpc("move_table_order", {
    p_tenant: gate.session.tenantId,
    p_order: orderId,
    p_table: tableId,
  });

  if (error) {
    return { ok: false, error: said(error.message, "We could not move that bill.") };
  }

  revalidateFloor();
  return { ok: true };
}

export async function cancelOrder(
  orderId: string,
  reason: string,
): Promise<FloorResult<object>> {
  const gate = await requireFloor();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { session } = gate;

  const { error } = await createAdminClient().rpc("cancel_table_order", {
    p_tenant: session.tenantId,
    p_order: orderId,
    p_reason: reason.trim().slice(0, 500) || null,
    p_by: session.userId,
  });

  if (error) {
    return {
      ok: false,
      error: said(error.message, "We could not close that bill."),
    };
  }

  await recordAudit(session, {
    action: "table_order.cancelled",
    subjectType: "table_order",
    subjectId: orderId,
    after: { reason },
  });

  revalidateFloor();
  return { ok: true };
}

// -----------------------------------------------------------------------------
// Settling
// -----------------------------------------------------------------------------

/**
 * The moment a table order becomes a sale.
 *
 * Everything the register checks before a charge is checked here too, because
 * this is the same act through a different door: the counter has to be open,
 * a drawer has to be open on it, and the discount is resolved against *this*
 * session's ceiling rather than one the browser sent.
 */
export async function settleOrder(input: {
  orderId: string;
  counterId: string;
  /** Minted in the browser, so a retry replays and the customer is not charged
   *  twice — `settle_table_order` hands back the receipt the first attempt
   *  issued. */
  saleId: string;
  tenders: TenderPart[];
  discountAmount: number;
}): Promise<FloorResult<{ receiptNo: string; total: number; replayed: boolean }>> {
  const gate = await requireFloor();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { session } = gate;

  if (!UUID.test(input.saleId) || !UUID.test(input.counterId)) {
    return { ok: false, error: "That bill is malformed. Start it again." };
  }

  const tenders = (input.tenders ?? []).filter((part) => Number(part.amount) > 0);

  if (tenders.length === 0 || !tenders.every((part) => isTender(part.method))) {
    return { ok: false, error: "That is not a payment method this counter takes." };
  }

  const supabase = createAdminClient();

  const { data: counter } = await supabase
    .from("counters")
    .select("id, name, is_active, accepted_tenders")
    .eq("id", input.counterId)
    .eq("tenant_id", session.tenantId)
    .maybeSingle();

  if (!counter || !counter.is_active) {
    return {
      ok: false,
      error: "That counter is shut. Open it in Settings, or settle on one that is open.",
    };
  }

  const accepted = (counter.accepted_tenders ?? []) as string[];
  const refused = tenders.find((part) => !accepted.includes(part.method));

  if (refused) {
    return {
      ok: false,
      error: `${counter.name} is not set up to take ${refused.method}.`,
    };
  }

  // No drawer, no sale — the same rule the register enforces, and for the same
  // reason: money has to land in a till somebody has counted into.
  const { data: shift } = await supabase
    .from("shifts")
    .select("id")
    .eq("tenant_id", session.tenantId)
    .eq("counter_id", counter.id)
    .eq("status", "open")
    .maybeSingle();

  if (!shift) {
    return {
      ok: false,
      error: `No drawer is open on ${counter.name}. Open it at the top of the Register — a sale has to land in a till somebody has counted into.`,
    };
  }

  const till = await getTillAccess(session);
  const settings = await getShopSettings(session.tenantId);

  const discount = till.canDiscount ? Math.max(0, round2(input.discountAmount)) : 0;

  const { data, error } = await supabase.rpc("settle_table_order", {
    p_tenant: session.tenantId,
    p_order: input.orderId,
    p_counter: counter.id,
    p_sale_id: input.saleId,
    p_business_day: businessDayOf(
      new Date(),
      settings.timezone,
      settings.dayEndsAt,
    ),
    p_tenders: tenders.map((part) => ({
      method: part.method,
      amount: round2(Number(part.amount)),
      reference: (part.reference ?? "").trim().slice(0, 60) || null,
    })),
    p_discount: discount,
    // The floor under the check above. `record_sale` raises rather than clamps,
    // so this being wrong is a failed settle and not a silent giveaway.
    p_ceiling_pct: till.discountCeilingPct,
    p_by: session.userId,
  });

  const receiptNo =
    data && typeof data === "object" && "receipt_number" in data
      ? String((data as { receipt_number: unknown }).receipt_number)
      : null;

  if (error || !receiptNo) {
    console.error("[tables] settle_table_order failed", error);
    return {
      ok: false,
      error: said(
        error?.message,
        "We could not settle that bill. Nothing has been charged — check the connection and try again.",
      ),
    };
  }

  const replayed =
    data && typeof data === "object" && "replayed" in data
      ? Boolean((data as { replayed: unknown }).replayed)
      : false;

  if (!replayed) {
    await recordAudit(session, {
      action: "table_order.settled",
      subjectType: "table_order",
      subjectId: input.orderId,
      after: {
        sale_id: input.saleId,
        receipt_number: receiptNo,
        counter_id: counter.id,
        discount,
        tenders: tenders.map((part) => ({
          method: part.method,
          amount: round2(Number(part.amount)),
        })),
      },
    });
  }

  revalidateFloor();
  revalidatePath("/app/register");

  return {
    ok: true,
    receiptNo,
    replayed,
    total:
      data && typeof data === "object" && "total" in data
        ? Number((data as { total: unknown }).total)
        : 0,
  };
}
