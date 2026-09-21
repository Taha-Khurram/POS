import "server-only";

import { cookies } from "next/headers";

import type { Discount } from "@/lib/pos/counter";
import type { HeldBill } from "@/lib/pos/held";
import { createClient } from "@/utils/supabase/server";

/**
 * The bills parked at one counter, read as rows.
 *
 * Through the shop's own JWT rather than the service role, like `items.ts`,
 * `bills.ts` and the readers in `shop.ts`: `held_bills_read_own` scopes to the
 * `tenant_id` claim, so RLS is the gate and a bug in this file cannot hand one
 * shop another's counter. Writes go through
 * `app/(app)/app/register/hold-actions.ts` on the service role, because 0025
 * revoked insert/update/delete from `authenticated` outright — rule 3 from
 * `0001_init.sql`.
 *
 * Deliberately NOT wrapped in React `cache()`, for the reason none of the
 * readers in `lib/pos/` are: a Server Action plus the re-render its
 * `revalidatePath` triggers are one request, and a memoised read would hand
 * that re-render the list as it stood before the bill was parked — so the
 * cashier would put a bill down and watch it fail to appear.
 */

type Row = {
  id: string;
  counter_id: string;
  label: string | null;
  customer_id: string | null;
  lines: unknown;
  discount_kind: string;
  discount_value: number | string;
  created_by: string | null;
  created_at: string;
  customers: { name: string } | null;
};

/**
 * Everything parked at one till, oldest first.
 *
 * Oldest first because the bill that has been waiting longest is the one
 * somebody is about to ask about — and because a list that reorders as bills
 * are added is a list a cashier has to re-read every time.
 *
 * Scoped to the counter, which is where a parked bill belongs: the shopping is
 * sitting beside that till, and offering it at the one by the door would be
 * offering to settle a bill whose goods are across the shop.
 *
 * The roster is handed in rather than re-read — it is already in hand on the
 * register page — so the name is resolved here and the list of everybody who
 * could have parked a bill never crosses the wire.
 */
export async function listHeldBills(
  tenantId: string,
  counterId: string,
  staff: { id: string; name: string }[],
): Promise<HeldBill[]> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("held_bills")
    .select(
      "id, counter_id, label, customer_id, lines, discount_kind, discount_value, created_by, created_at, customers ( name )",
    )
    .eq("tenant_id", tenantId)
    .eq("counter_id", counterId)
    .order("created_at");

  return ((data ?? []) as unknown as Row[]).map((row) => ({
    id: row.id,
    counterId: row.counter_id,
    label: row.label ?? "",
    customerId: row.customer_id,
    // Null for a walk-in and also for a customer since deleted — `customer_id`
    // is `on delete set null`, the same bargain a receipt strikes. The bill is
    // still settleable either way.
    customerName: row.customers?.name ?? "",
    lines: readLines(row.lines),
    discount: {
      kind: row.discount_kind === "percent" ? "percent" : "amount",
      value: Number(row.discount_value) || 0,
    } satisfies Discount,
    by:
      staff.find((person) => person.id === row.created_by)?.name ??
      (row.created_by ? "Former staff" : "—"),
    at: row.created_at,
  }));
}

/**
 * The stored jsonb into the pairs the till resumes from.
 *
 * Defensive because it is jsonb: the column is written by one Server Action
 * that validates every row, and a reader that assumes its own writer is the
 * only one that ever ran is a reader that throws on the day somebody fixes a
 * row by hand. A line that does not read cleanly is dropped rather than
 * crashing the register — the cashier gets a bill with an item missing, which
 * they can see and correct, instead of a screen that will not open.
 */
function readLines(
  raw: unknown,
): { itemId: string; variantId: string | null; quantity: number }[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];

    const itemId = (entry as { item_id?: unknown }).item_id;
    const variantId = (entry as { variant_id?: unknown }).variant_id;
    const quantity = Number((entry as { quantity?: unknown }).quantity);

    if (typeof itemId !== "string" || !Number.isFinite(quantity) || quantity <= 0) {
      return [];
    }

    return [
      {
        itemId,
        // Absent on every bill parked before `0031`, which is the honest
        // reading: those bills were for items that had no sizes.
        variantId: typeof variantId === "string" && variantId ? variantId : null,
        quantity,
      },
    ];
  });
}
