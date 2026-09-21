import "server-only";

import { cookies } from "next/headers";

import { round2 } from "@/lib/pos/counter";
import { createClient } from "@/utils/supabase/server";

/**
 * What each counter took, and what the shop took.
 *
 * Read through the shop's own JWT rather than the service role, like the rest
 * of `lib/pos/`: `sales` and `sale_tenders` both carry a select policy scoped
 * to the `tenant_id` claim, so RLS is the gate and a bug in this file cannot
 * hand one shop another's day.
 *
 * Aggregated in TypeScript rather than in SQL on purpose. A busy kiryana rings
 * up a few hundred bills a day, so one day is a few hundred rows — well inside
 * what a single round trip should carry, and it keeps the shape of the answer
 * in the same language as the screen that draws it. A `group by` view would be
 * the right call at the point where a chain asks for a month across ten
 * branches, and this is not that point yet.
 *
 * The window is `sales.business_day`, not a timestamp range. The register
 * stamps it at the moment of sale from the shop's own `day_ends_at`, so a dhaba
 * that shuts at 1 am gets its last hour on the day it opened without this file
 * knowing anything about the setting.
 */

export type CounterTakings = {
  counterId: string | null;
  /** Null `counterId` is a sale from a counter that has since been deleted —
   *  the money was still taken, so it is counted rather than quietly dropped. */
  name: string;
  bills: number;
  /** How many of the day's receipts were money going back. Counted, never
   *  subtracted from `bills`: the shop served that customer too, and the
   *  refund shows up in the takings that fell. */
  refunds: number;
  /** What went back over the counter, as a positive figure. `cash` and `card`
   *  are already net of it — this is here so the day-end screen can say why
   *  the drawer is lighter than the receipts suggest. */
  refunded: number;
  /** Notes in the drawer. The only one a shift's expected figure counts, and
   *  the only one a cashier can be short of. */
  cash: number;
  card: number;
  /** Raast, the wallets, a bank transfer — everything the counter took that is
   *  neither cash nor card. Zero for most shops, and a column rather than a
   *  silence since `0032`: a JazzCash bill counted into neither of the two
   *  above would leave `cash + card` short of `total` with nothing on the
   *  screen to explain the gap. */
  other: number;
  total: number;
  /** The last receipt this counter issued that day, for the cashier checking
   *  their own drawer against the screen. */
  lastReceiptNo: string | null;
};

export type DayTakings = {
  businessDay: string;
  counters: CounterTakings[];
  bills: number;
  refunds: number;
  refunded: number;
  cash: number;
  card: number;
  other: number;
  total: number;
};

/**
 * The day's drawer count, and nothing else.
 *
 * This reader used to carry the day's receipts too, and the screen drew them
 * under the counter table. They belong to the Bills tab now — it searches,
 * pages, opens one and reprints it — and two lists of the same rows on one
 * screen is how they drift apart.
 */
export async function getDayTakings(
  tenantId: string,
  businessDay: string,
  counters: { id: string; name: string }[],
): Promise<DayTakings> {
  const supabase = createClient(await cookies());

  // One round trip. `sale_tenders` is embedded rather than fetched separately
  // because a second query would need the sale ids from the first, and two
  // sequential round trips on shop 3G is the difference between a day-end
  // screen that opens and one a shopkeeper stops using.
  const { data } = await supabase
    .from("sales")
    .select("counter_id, receipt_number, total, status, sale_tenders(method, amount)")
    .eq("tenant_id", tenantId)
    .eq("business_day", businessDay)
    // Sales and the refunds against them. A refund is a negative sale since
    // `0024`, so cash and card below net by arithmetic — which is the whole
    // point of the shape: the drawer at 11 pm holds the takings minus what
    // went back, and this screen is what it is counted against.
    .in("status", ["completed", "refund"])
    .order("created_at", { ascending: false })
    .limit(2000);

  const rows = data ?? [];

  // Seeded with every counter the shop has, so a till that took nothing all day
  // shows a row of zeroes. That is the answer to "did counter 2 sell anything?"
  // — an absent row is not, and reads as a screen that failed to load.
  const byCounter = new Map<string, CounterTakings>(
    counters.map((counter) => [
      counter.id,
      {
        counterId: counter.id,
        name: counter.name,
        bills: 0,
        refunds: 0,
        refunded: 0,
        cash: 0,
        card: 0,
        other: 0,
        total: 0,
        lastReceiptNo: null,
      },
    ]),
  );

  const ORPHAN = "__deleted__";

  for (const row of rows) {
    const key = row.counter_id ?? ORPHAN;

    let entry = byCounter.get(key);
    if (!entry) {
      entry = {
        counterId: row.counter_id,
        name: row.counter_id ? "Deleted counter" : "No counter recorded",
        bills: 0,
        refunds: 0,
        refunded: 0,
        cash: 0,
        card: 0,
        other: 0,
        total: 0,
        lastReceiptNo: null,
      };
      byCounter.set(key, entry);
    }

    const total = Number(row.total);

    // A refund is not minus one bill. The shop served that customer as well —
    // it counted them once on the way in and once on the way back — so the two
    // are counted apart and only the money nets.
    if (row.status === "refund") {
      entry.refunds += 1;
      entry.refunded = round2(entry.refunded + Math.abs(total));
    } else {
      entry.bills += 1;
    }

    entry.total = round2(entry.total + total);

    // Rows arrive newest first, so the first one seen per counter is the last
    // receipt it issued.
    entry.lastReceiptNo ??= row.receipt_number;

    // A bill can carry more than one tender since `0032`, and this has always
    // been written as a loop because `sale_tenders` was one-to-many by design.
    //
    // The `else` is what matters: every tender lands in exactly one of the
    // three buckets, so `cash + card + other` is `total` by construction. A
    // method that fell through to nothing — which is what a wallet used to do —
    // is a day where the columns do not add up to the figure beside them, and
    // nobody would know which bill did it.
    const tenders = row.sale_tenders ?? [];

    for (const tender of tenders) {
      const amount = round2(Number(tender.amount));
      if (tender.method === "cash") entry.cash = round2(entry.cash + amount);
      else if (tender.method === "card") entry.card = round2(entry.card + amount);
      else entry.other = round2(entry.other + amount);
    }
  }

  const all = [...byCounter.values()];

  return {
    businessDay,
    // The shop's own order first, then anything orphaned, which belongs at the
    // bottom because it is an exception and not a till.
    counters: all,
    bills: all.reduce((sum, entry) => sum + entry.bills, 0),
    refunds: all.reduce((sum, entry) => sum + entry.refunds, 0),
    refunded: round2(all.reduce((sum, entry) => sum + entry.refunded, 0)),
    cash: round2(all.reduce((sum, entry) => sum + entry.cash, 0)),
    card: round2(all.reduce((sum, entry) => sum + entry.card, 0)),
    other: round2(all.reduce((sum, entry) => sum + entry.other, 0)),
    total: round2(all.reduce((sum, entry) => sum + entry.total, 0)),
  };
}
