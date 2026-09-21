"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth";
import { round3, type Discount } from "@/lib/pos/counter";
import { HELD_LABEL_MAX, HELD_MAX } from "@/lib/pos/held";
import { createAdminClient } from "@/utils/supabase/admin";

/**
 * Putting a bill down, and dropping one nobody came back for.
 *
 * In its own module rather than beside `recordSale`, for the reason
 * `choose-counter.ts` is: a `"use server"` file exports an endpoint per
 * function, and the sale path has no business being pulled in by the parking
 * one.
 *
 * Nothing here decides money. A parked bill stores item ids, quantities, who it
 * was for and what was agreed off it — no prices at all. That is the whole
 * design: resuming re-prices from the catalog exactly as `recordSale` does, so
 * a bill parked before a rate change settles at the rate on the shelf, and the
 * discount is re-checked against the cashier's ceiling when it settles rather
 * than when it was put down. A stored price would be a quiet way to sell at
 * yesterday's cost.
 *
 * Nothing here moves stock either, and nothing should. A parked bill is
 * shopping on a counter; it has not been sold, and taking it off the shelf
 * would make every forgotten bill a hole in the stocktake.
 *
 * `id` is minted on the tablet, like a sale's, so holding the same bill twice
 * through a flaky connection is one row rather than two.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type HoldInput = {
  id: string;
  counterId: string;
  label: string;
  customerId: string | null;
  lines: { id: string; variantId: string | null; quantity: number }[];
  discount: Discount;
};

export type HoldResult = { ok: true } | { ok: false; error: string };

export async function holdBill(input: HoldInput): Promise<HoldResult> {
  const session = await requireSession();

  if (!session.tenantId) {
    return { ok: false, error: "This login is not linked to a shop." };
  }

  if (!UUID.test(input.id) || !UUID.test(input.counterId)) {
    return { ok: false, error: "That bill is malformed. Start it again." };
  }

  const lines = (input.lines ?? []).filter((line) => line.quantity > 0);

  if (lines.length === 0) {
    return { ok: false, error: "There is nothing on this bill to put down." };
  }

  if (lines.length > 200 || !lines.every((line) => UUID.test(line.id))) {
    return { ok: false, error: "That bill is malformed. Start it again." };
  }

  const supabase = createAdminClient();

  // The counter, re-read rather than taken on trust: this shop's, and open. A
  // bill parked at a till that is shut is a bill nobody can settle.
  const { data: counter } = await supabase
    .from("counters")
    .select("id, name, is_active")
    .eq("id", input.counterId)
    .eq("tenant_id", session.tenantId)
    .maybeSingle();

  if (!counter || !counter.is_active) {
    return {
      ok: false,
      error: "This counter has been shut in Settings, so there is nowhere to put this bill down.",
    };
  }

  // The cap, counted rather than assumed. A till with eleven parked bills is a
  // cashier who has stopped clearing them and a list nobody can find anything
  // in — and the refusal names the number and the way out, because a limit
  // that only says "no" is a limit that gets worked around.
  //
  // Counted excluding this bill's own id, so re-parking a bill that is already
  // down (the cashier who added one more item to it) is never refused by the
  // cap it is already inside.
  const { count } = await supabase
    .from("held_bills")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", session.tenantId)
    .eq("counter_id", counter.id)
    .neq("id", input.id);

  if ((count ?? 0) >= HELD_MAX) {
    return {
      ok: false,
      error: `${counter.name} already has ${HELD_MAX} bills on hold. Settle one, or drop one nobody came back for.`,
    };
  }

  // The customer, on the same terms `recordSale` reads one: this shop's, and
  // still on the list. Dropped to a walk-in rather than refused — a bill being
  // put down is not the moment to stop a cashier over a customer record, and
  // one can be attached again when it is settled.
  let customerId: string | null = null;

  if (input.customerId && UUID.test(input.customerId)) {
    const { data: customer } = await supabase
      .from("customers")
      .select("id")
      .eq("id", input.customerId)
      .eq("tenant_id", session.tenantId)
      .eq("is_active", true)
      .maybeSingle();

    customerId = customer?.id ?? null;
  }

  const discount: Discount =
    input.discount?.kind === "percent"
      ? { kind: "percent", value: clamp(input.discount.value, 100) }
      : { kind: "amount", value: clamp(input.discount?.value ?? 0, 9_999_999) };

  // Upsert, so the cashier who picks a bill up, adds the dahi to it and puts it
  // back down again gets one row. `id` is the tablet's, which is what makes
  // that identity hold across a dropped connection.
  const { error } = await supabase.from("held_bills").upsert(
    {
      id: input.id,
      tenant_id: session.tenantId,
      counter_id: counter.id,
      label: input.label.trim().slice(0, HELD_LABEL_MAX) || null,
      customer_id: customerId,
      lines: lines.map((line) => ({
        item_id: line.id,
        // Null for everything a shop does not sell by variant. Stored as the
        // id rather than as "Medium / Blue": resuming re-reads the row, so a
        // colour renamed while the bill was down comes back under its new name
        // — the same reason no price is stored here.
        variant_id: UUID.test(line.variantId ?? "") ? line.variantId : null,
        quantity: round3(Number(line.quantity)),
      })),
      discount_kind: discount.kind,
      discount_value: discount.value,
      created_by: session.userId,
    },
    { onConflict: "id" },
  );

  if (error) {
    console.error("[register] holdBill failed", error);
    return {
      ok: false,
      error: "We could not put this bill down. Check the connection and try again.",
    };
  }

  revalidatePath("/app/register");

  return { ok: true };
}

/**
 * Dropping a parked bill.
 *
 * Nothing is audited and nothing is kept. A held bill is shopping on a counter
 * that nobody paid for — there is no money, no receipt number and no stock
 * movement behind it, so there is nothing to account for afterwards. The one
 * thing that matters is that it is this shop's row, which is what the
 * `.eq("tenant_id", …)` is.
 */
export async function dropHeldBill(id: string): Promise<HoldResult> {
  const session = await requireSession();

  if (!session.tenantId) {
    return { ok: false, error: "This login is not linked to a shop." };
  }

  if (!UUID.test(id)) {
    return { ok: false, error: "That is not a bill we can find." };
  }

  const { error } = await createAdminClient()
    .from("held_bills")
    .delete()
    .eq("id", id)
    .eq("tenant_id", session.tenantId);

  if (error) {
    console.error("[register] dropHeldBill failed", error);
    return {
      ok: false,
      error: "We could not drop that bill. Check the connection and try again.",
    };
  }

  revalidatePath("/app/register");

  return { ok: true };
}

/** A figure off the browser, bounded. Never NaN, never negative. */
function clamp(value: unknown, max: number): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(Math.min(amount, max) * 100) / 100;
}
