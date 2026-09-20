import "server-only";

import { cookies } from "next/headers";

import type { Shift } from "@/lib/pos/shift";
import { createClient } from "@/utils/supabase/server";

/**
 * The shop's shifts, read as rows.
 *
 * Through the shop's own JWT rather than the service role, like `bills.ts` and
 * the readers in `shop.ts`: `shifts_read_own` scopes to the `tenant_id` claim,
 * so RLS is the gate and a bug in this file cannot hand one shop another's
 * drawer. Writes go through `public.open_shift` and `public.close_shift` on the
 * service role, because 0008 revoked insert/update/delete on `shifts` from
 * `authenticated` outright — rule 3 from `0001_init.sql`.
 *
 * Deliberately NOT wrapped in React `cache()`, for the reason none of the
 * readers in `lib/pos/` are: a Server Action plus the re-render its
 * `revalidatePath` triggers are one request, and a memoised read would hand
 * that re-render the drawer as it stood before it was opened — so a cashier
 * would put the float in and watch the strip go on saying no shift is open.
 */

const COLUMNS = `
  id,
  counter_id,
  opening_float,
  opened_by,
  opened_at,
  status,
  closed_by,
  closed_at,
  closing_cash,
  expected_cash,
  over_short,
  card_total,
  bills,
  note
`;

type Row = {
  id: string;
  counter_id: string | null;
  opening_float: number | string;
  opened_by: string | null;
  opened_at: string;
  status: string;
  closed_by: string | null;
  closed_at: string | null;
  closing_cash: number | string | null;
  expected_cash: number | string | null;
  over_short: number | string | null;
  card_total: number | string;
  bills: number | null;
  note: string | null;
};

/** The counters and people a shift's ids are written out with — both already in
 *  hand wherever this is called from, so they are handed in rather than
 *  re-read, and the roster never crosses the wire. */
type Books = {
  counters: { id: string; name: string }[];
  staff: { id: string; name: string }[];
};

const money = (value: number | string | null) =>
  value === null ? null : Number(value) || 0;

function toShift(row: Row, books: Books): Shift {
  const counter = books.counters.find((entry) => entry.id === row.counter_id);
  const opened = books.staff.find((entry) => entry.id === row.opened_by);
  const closed = books.staff.find((entry) => entry.id === row.closed_by);

  return {
    id: row.id,
    counterId: row.counter_id,
    // A counter since deleted keeps its shift and loses its name — the money
    // was still counted, and dropping the row would be dropping a drawer
    // count on the floor. The same bargain `bills.ts` strikes.
    counterName: counter?.name ?? (row.counter_id ? "Deleted counter" : "No counter"),
    openingFloat: Number(row.opening_float) || 0,
    openedBy: opened?.name ?? (row.opened_by ? "Former staff" : "—"),
    openedAt: row.opened_at,
    status: row.status === "closed" ? "closed" : "open",
    closedBy: closed?.name ?? (row.closed_by ? "Former staff" : "—"),
    closedAt: row.closed_at,
    countedCash: money(row.closing_cash),
    expectedCash: money(row.expected_cash),
    overShort: money(row.over_short),
    cardTotal: Number(row.card_total) || 0,
    bills: row.bills ?? 0,
    note: row.note ?? "",
  };
}

/**
 * Whichever shift this counter is in, or null.
 *
 * Null is the register's shut state: nothing can be charged on that counter
 * until a drawer is opened. One row at most —
 * `shifts_one_open_per_counter_idx` guarantees it, because two open at once on
 * one drawer is two people each counting the other's takings.
 */
export async function getOpenShift(
  tenantId: string,
  counterId: string,
  books: Books,
): Promise<Shift | null> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("shifts")
    .select(COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("counter_id", counterId)
    .eq("status", "open")
    .maybeSingle();

  return data ? toShift(data as unknown as Row, books) : null;
}

/**
 * The shop's recent shifts, newest first.
 *
 * Capped, and the cap is a screen's worth rather than a window: unlike the
 * sales history nobody searches shifts by date, they look at the last few and
 * ask about the ones that were short. A shop with four counters running two
 * shifts a day fills fifty rows in a week, which is the right amount of
 * scrollback for that question.
 */
export async function listShifts(
  tenantId: string,
  books: Books,
  limit = 50,
): Promise<Shift[]> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("shifts")
    .select(COLUMNS)
    .eq("tenant_id", tenantId)
    .order("opened_at", { ascending: false })
    .limit(limit);

  return ((data ?? []) as unknown as Row[]).map((row) => toShift(row, books));
}
