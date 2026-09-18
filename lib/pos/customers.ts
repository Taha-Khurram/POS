import "server-only";

import { cookies } from "next/headers";

import type { Customer, CustomerHistory } from "@/lib/pos/customer";
import { createClient } from "@/utils/supabase/server";

/**
 * The shop's customers, read as rows.
 *
 * Through the shop's own JWT, like `items.ts`, `tree.ts` and the readers in
 * `shop.ts`: `customers_read_own` scopes the rows to the `tenant_id` claim, so
 * RLS is the gate and the read doubles as a live check that the access-token
 * hook is stamping claims. A service-role read would happily return the list
 * with the hook switched off and hide the one failure that breaks everything
 * else.
 *
 * Writes go through `app/(app)/app/customers/actions.ts` on the service role,
 * because `0018` revoked insert/update/delete from `authenticated` outright —
 * rule 3 from `0001_init.sql`, so that there is one auditable write path rather
 * than a policy surface to get wrong.
 *
 * Deliberately NOT wrapped in React `cache()`, for the reason none of the
 * readers in `shop.ts` or `items.ts` are: `cache()` is scoped to the request,
 * and a Server Action plus the re-render its `revalidatePath` triggers are one
 * request — so a memoised read would hand that re-render the list as it stood
 * before the save, and the owner would watch the customer they just added fail
 * to appear.
 */

const COLUMNS =
  "id, name, phone, email, address, notes, is_active, created_at";

type Row = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
};

/** Nulls become empty strings once, here. The screens treat every one of these
 *  as a string they can search and render, and a null would have every caller
 *  writing `?? ""` instead. */
function toCustomer(row: Row): Customer {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone ?? "",
    email: row.email ?? "",
    address: row.address ?? "",
    notes: row.notes ?? "",
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

/** Everyone on the list, switched-off customers included — the editor's view. */
export async function listCustomers(tenantId: string): Promise<Customer[]> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("customers")
    .select(COLUMNS)
    .eq("tenant_id", tenantId)
    .order("name");

  return ((data ?? []) as Row[]).map(toCustomer);
}

/**
 * Who the till may put a bill against.
 *
 * The same rows minus the switched-off ones, because a customer who has moved
 * away is one the register must not offer — and `recordSale` re-reads with the
 * same filter, so a tab left open since they were switched off cannot attach
 * them either.
 */
export async function listActiveCustomers(tenantId: string): Promise<Customer[]> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("customers")
    .select(COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("name");

  return ((data ?? []) as Row[]).map(toCustomer);
}

/** One customer, by id, scoped to the shop that asked. */
export async function getCustomer(
  tenantId: string,
  customerId: string,
): Promise<Customer | null> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("customers")
    .select(COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", customerId)
    .maybeSingle();

  return data ? toCustomer(data as Row) : null;
}

/** A customer's record is their last hundred bills. Past that it is a report. */
const RECEIPT_LIMIT = 100;

/**
 * What one customer has bought.
 *
 * One query, straight down `sales_tenant_customer_idx`, and totalled here
 * rather than in SQL — the same call `takings.ts` makes, and for the same
 * reason: a hundred rows is well inside one round trip, and the shape of the
 * answer stays in the language of the screen that draws it.
 *
 * `bills` and `spent` are counted off the rows that came back, so they are the
 * totals *of the last hundred bills* and not of all time. That is stated on the
 * screen rather than papered over: a figure that silently stops counting is
 * worse than one that says where it stops.
 */
export async function getCustomerHistory(
  tenantId: string,
  customerId: string,
): Promise<CustomerHistory> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("sales")
    .select("id, receipt_number, business_day, total")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .eq("status", "completed")
    .order("business_day", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(RECEIPT_LIMIT);

  const rows = data ?? [];

  const receipts = rows.map((row) => ({
    id: row.id,
    receiptNo: row.receipt_number,
    businessDay: row.business_day,
    total: Number(row.total) || 0,
  }));

  return {
    bills: receipts.length,
    spent:
      Math.round(receipts.reduce((total, row) => total + row.total, 0) * 100) / 100,
    lastBillOn: receipts[0]?.businessDay ?? null,
    receipts,
  };
}
