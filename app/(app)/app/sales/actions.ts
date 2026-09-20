"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { getBill } from "@/lib/pos/bills";
import { businessDayOf, isTender, round3, type TenderId } from "@/lib/pos/counter";
import { returnable, type BillDetail } from "@/lib/pos/history";
import { getModuleAccess, getTillAccess } from "@/lib/pos/access";
import { getShopSettings, listCounters } from "@/lib/pos/shop";
import { listStaff } from "@/lib/pos/staff";
import { createAdminClient } from "@/utils/supabase/admin";

/**
 * Opening one bill.
 *
 * A Server Action that reads rather than writes, which is unusual here and
 * deliberate. The history loads a whole window of bills in one round trip so
 * that searching and paging are instant on shop 3G, but the *lines* of a bill
 * are twenty times that payload and nobody opens more than a handful — so they
 * are fetched when a row is tapped, and this is the one call that does it.
 *
 * A route handler would do the same job; an action keeps the gate identical to
 * every other entry point in `/app` (`requireSession`, then the module), needs
 * no URL of its own that has to be protected separately, and types the answer
 * end to end.
 *
 * It is read-only in the strictest sense: `lib/pos/bills.ts` runs on the shop's
 * own JWT, so RLS refuses another shop's bill before this code sees it. The
 * checks below are what turn that refusal into a sentence rather than a blank
 * drawer.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BillResult =
  | { ok: true; bill: BillDetail }
  | { ok: false; error: string };

export async function loadBill(saleId: string): Promise<BillResult> {
  const session = await requireSession();

  if (!session.tenantId) {
    return { ok: false, error: "This login is not linked to a shop." };
  }

  const access = await getModuleAccess(session);

  // Re-checked here rather than trusted from the page that rendered the list.
  // An action is a public endpoint whatever component calls it.
  if (!access.sales) {
    return { ok: false, error: "That bill is not yours to open." };
  }

  if (!UUID.test(saleId)) {
    return { ok: false, error: "That is not a bill number we can look up." };
  }

  const [counters, staff] = await Promise.all([
    listCounters(session.tenantId),
    listStaff(session.tenantId),
  ]);

  const bill = await getBill(session.tenantId, saleId, { counters, staff });

  // Not this shop's bill and no such bill are one answer. Telling them apart
  // would confirm the bill exists, which is the whole of what an id-guessing
  // request is after.
  if (!bill) {
    return {
      ok: false,
      error: "We could not find that bill. It may have been rung up on another shop's till.",
    };
  }

  return { ok: true, bill };
}

/* -------------------------------------------------------------------------- */

/**
 * Taking a return.
 *
 * The one write on this screen, and the only place in the console where money
 * goes back out of the drawer — so it is the one to be most careful about.
 *
 * Nothing the browser sent about the bill is trusted. It names an original
 * sale, a set of that sale's own line ids and how many of each are coming
 * back; everything else — what each line was actually sold for after any
 * discount, how much of it has already been given back, what it cost the shop —
 * is read again inside `public.record_return`, in one transaction, with the
 * original bill and each of its lines locked. That lock is not decoration: two
 * tablets refunding the last unsold unit of the same line at the same moment
 * is exactly how a shop ends up refunding three of two.
 *
 * The checks here are the gate and the function is the floor. They exist so
 * that a cashier gets a sentence they can act on rather than a failed write,
 * and so that the permission is re-read on the server — `can_refund` hiding the
 * button is a courtesy, not a control.
 *
 * `returnId` is minted on the tablet, like a sale's. A retry after a dropped
 * connection replays rather than refunding twice, which matters more here than
 * it does on a sale: a second sale is at least a second lot of shopping, and a
 * second refund is money out of the drawer for nothing.
 */

export type ReturnInput = {
  /** The refund's own id, minted in the browser so a retry replays. */
  returnId: string;
  /** The bill being reversed. */
  saleId: string;
  /** Which counter is handing the money back — the till this device bills
   *  from, because the refund lands in that counter's drawer and its series. */
  counterId: string;
  /** The original bill's own line ids, and how many of each are coming back. */
  lines: { lineId: string; quantity: number }[];
  /** How the money goes back. */
  tender: TenderId;
  /** Whether what came back goes on the shelf again. A sealed packet does; a
   *  burst bag of atta does not. */
  restock: boolean;
  /** Why, in the shopkeeper's words. Optional and worth asking for. */
  note: string;
};

export type ReturnResult =
  | { ok: true; receiptNo: string; refunded: number }
  | { ok: false; error: string };

export async function recordReturn(input: ReturnInput): Promise<ReturnResult> {
  const session = await requireSession();

  if (!session.tenantId) {
    return { ok: false, error: "This login is not linked to a shop." };
  }

  // The control. `can_refund` not drawing the button is the courtesy.
  const till = await getTillAccess(session);

  if (!till.canRefund) {
    return {
      ok: false,
      error: "You are not allowed to take returns. Ask the owner, or call them over.",
    };
  }

  if (
    !UUID.test(input.returnId) ||
    !UUID.test(input.saleId) ||
    !UUID.test(input.counterId)
  ) {
    return { ok: false, error: "That return is malformed. Start it again." };
  }

  if (!isTender(input.tender)) {
    return { ok: false, error: "That is not a way this counter can give money back." };
  }

  const wanted = (input.lines ?? []).filter((line) => line.quantity > 0);

  if (wanted.length === 0) {
    return { ok: false, error: "Nothing is coming back. Choose what the customer is returning." };
  }

  if (!wanted.every((line) => UUID.test(line.lineId))) {
    return { ok: false, error: "That return is malformed. Start it again." };
  }

  const [counters, staff, settings] = await Promise.all([
    listCounters(session.tenantId),
    listStaff(session.tenantId),
    getShopSettings(session.tenantId),
  ]);

  // The bill, re-read through the shop's own JWT. RLS refuses another shop's
  // before this code sees it, so a crafted id gets the same "no such bill" a
  // typo does.
  const bill = await getBill(session.tenantId, input.saleId, { counters, staff });

  if (!bill) {
    return {
      ok: false,
      error: "We could not find that bill. It may have been rung up on another shop's till.",
    };
  }

  if (bill.status !== "completed") {
    return {
      ok: false,
      error:
        "That receipt is itself a refund, so there is nothing on it to give back. Open the sale it came off.",
    };
  }

  // What is still returnable, worked out from the bill as just read. The
  // function works it out again under a lock and refuses if they disagree —
  // this pass is here so the cashier is told which line and by how much rather
  // than being handed a failed write.
  const byId = new Map(bill.lines.map((line) => [line.id, line]));

  for (const line of wanted) {
    const original = byId.get(line.lineId);

    if (!original) {
      return { ok: false, error: "One of those lines is not on this bill." };
    }

    const quantity = round3(Number(line.quantity));
    const left = returnable(original);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { ok: false, error: `The quantity on ${original.name} is not one we can take back.` };
    }

    if (quantity > left) {
      return {
        ok: false,
        error:
          left === 0
            ? `${original.name} has already been returned in full.`
            : `Only ${left} of ${original.name} is still returnable — the rest has already come back.`,
      };
    }
  }

  // The counter the money leaves from: this shop's, and open. The refund takes
  // a number out of its series and lands in its drawer, so a shut till cannot
  // be the one handing cash back.
  const counter = counters.find((entry) => entry.id === input.counterId);

  if (!counter || !counter.isActive) {
    return {
      ok: false,
      error: "That counter is shut. Open it in Settings, or take the return on a counter that is open.",
    };
  }

  const gives = input.tender === "cash" ? counter.acceptsCash : counter.acceptsCard;

  if (!gives) {
    return { ok: false, error: `${counter.name} is not set up for ${input.tender}.` };
  }

  const supabase = createAdminClient();

  // No drawer, no refund — the same rule the register charges under, and for a
  // stronger reason: a refund is notes leaving a till, and a till nobody has
  // counted into has no count for them to leave.
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
      error: `No drawer is open on ${counter.name}. Open it at the top of the Register before giving money back.`,
    };
  }

  const { data, error } = await supabase.rpc("record_return", {
    p_tenant: session.tenantId,
    p_counter: counter.id,
    p_return_id: input.returnId,
    // The trading day the money went back on, stamped from the shop's own
    // `day_ends_at` exactly as a sale's is — never the day of the original
    // bill. A refund belongs to the day the drawer was actually lighter, or
    // the day-end count of a week-old return would never balance.
    p_business_day: businessDayOf(new Date(), settings.timezone, settings.dayEndsAt),
    p_created_by: session.userId,
    p_sale_id: bill.id,
    p_lines: wanted.map((line) => ({
      line_id: line.lineId,
      quantity: round3(Number(line.quantity)),
    })),
    p_tender: input.tender,
    p_restock: Boolean(input.restock),
    p_note: (input.note ?? "").slice(0, 200),
  });

  const receiptNo =
    data && typeof data === "object" && "receipt_number" in data
      ? String((data as { receipt_number: unknown }).receipt_number)
      : null;

  if (error || !receiptNo) {
    console.error("[sales] record_return failed", error);
    return {
      ok: false,
      error:
        "We could not record this return. Check the connection and try again — do not hand the money back until it saves, or the drawer and the books will disagree.",
    };
  }

  const refunded =
    data && typeof data === "object" && "total" in data
      ? Number((data as { total: unknown }).total) || 0
      : 0;

  const replayed =
    data && typeof data === "object" && "replayed" in data
      ? Boolean((data as { replayed: unknown }).replayed)
      : false;

  // A replay is the same return arriving twice, not a second one. Auditing it
  // again would put two entries against one refund and make the log say the
  // shop gave the money back twice.
  if (!replayed) {
    await recordAudit(session, {
      action: "sale.refunded",
      subjectType: "sale",
      subjectId: input.returnId,
      after: {
        refunds_sale_id: bill.id,
        refunds_receipt: bill.receiptNo,
        receipt_number: receiptNo,
        counter_id: counter.id,
        tender: input.tender,
        restocked: Boolean(input.restock),
        refunded,
        lines: wanted.length,
      },
    });
  }

  // Both figures on this screen move: the history's totals and the day close.
  revalidatePath("/app/sales");
  // And the shelf, when the goods went back on it.
  if (input.restock) revalidatePath("/app/inventory");

  return { ok: true, receiptNo, refunded };
}
