"use server";

import { requireSession } from "@/lib/auth";
import { getBill } from "@/lib/pos/bills";
import type { BillDetail } from "@/lib/pos/history";
import { getModuleAccess } from "@/lib/pos/access";
import { listCounters } from "@/lib/pos/shop";
import { listStaff } from "@/lib/pos/staff";

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
