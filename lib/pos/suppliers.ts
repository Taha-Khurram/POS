import "server-only";

import { cookies } from "next/headers";

import type { Supplier } from "@/lib/pos/supplier";
import { createClient } from "@/utils/supabase/server";

/**
 * The shop's suppliers, read as rows.
 *
 * Through the shop's own JWT, like `items.ts`, `customers.ts` and the readers
 * in `shop.ts`: `suppliers_read_own` scopes the rows to the `tenant_id` claim,
 * so RLS is the gate and the read doubles as a live check that the access-token
 * hook is stamping claims. A service-role read would happily return the list
 * with the hook switched off and hide the one failure that breaks everything
 * else.
 *
 * Writes go through `app/(app)/app/purchasing/supplier-actions.ts` on the
 * service role, because `0027` revoked insert/update/delete from
 * `authenticated` outright — rule 3 from `0001_init.sql`.
 *
 * Deliberately NOT wrapped in React `cache()`, for the reason none of the other
 * readers in `lib/pos/` are: a Server Action plus the re-render its
 * `revalidatePath` triggers are one request, and a memoised read would hand
 * that re-render the list as it stood before the save.
 */

const COLUMNS =
  "id, name, contact_name, phone, email, address, tax_number, payment_terms_days, notes, is_active, created_at";

type Row = {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  tax_number: string | null;
  payment_terms_days: number | string;
  notes: string | null;
  is_active: boolean;
  created_at: string;
};

/** Nulls become empty strings once, here — the screens all treat these as
 *  strings they can search and render, and a null would have every caller
 *  writing `?? ""` instead. */
const toSupplier = (row: Row, items: number): Supplier => ({
  id: row.id,
  name: row.name,
  contactName: row.contact_name ?? "",
  phone: row.phone ?? "",
  email: row.email ?? "",
  address: row.address ?? "",
  taxNumber: row.tax_number ?? "",
  paymentTermsDays: Number(row.payment_terms_days) || 0,
  notes: row.notes ?? "",
  isActive: row.is_active,
  createdAt: row.created_at,
  items,
});

/**
 * How many catalog items name each supplier.
 *
 * One read of two columns for the whole catalog, counted here. The alternative
 * — a `count` aggregate per supplier through PostgREST — is one round trip per
 * row, which is the n+1 the Suppliers panel would pay on every paint.
 *
 * It matters more than a decoration: the count is what the delete confirmation
 * quotes, and "eleven items name this supplier" is the sentence that stops an
 * owner clearing a distributor off a list they are still buying from.
 */
async function itemCounts(tenantId: string): Promise<Map<string, number>> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("items")
    .select("supplier_id")
    .eq("tenant_id", tenantId)
    .not("supplier_id", "is", null);

  const counts = new Map<string, number>();

  for (const row of data ?? []) {
    const id = row.supplier_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return counts;
}

/** Everyone on the list, switched-off suppliers included — the editor's view. */
export async function listSuppliers(tenantId: string): Promise<Supplier[]> {
  const supabase = createClient(await cookies());

  const [{ data }, counts] = await Promise.all([
    supabase.from("suppliers").select(COLUMNS).eq("tenant_id", tenantId).order("name"),
    itemCounts(tenantId),
  ]);

  return ((data ?? []) as Row[]).map((row) => toSupplier(row, counts.get(row.id) ?? 0));
}

/**
 * Who an order or a delivery may be put against.
 *
 * The same rows minus the switched-off ones, and without the item counts: a
 * picker does not draw them, and reading the whole catalog to fill a dropdown
 * is a round trip the receiving screen should not pay.
 */
export async function listActiveSuppliers(tenantId: string): Promise<Supplier[]> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("suppliers")
    .select(COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("name");

  return ((data ?? []) as Row[]).map((row) => toSupplier(row, 0));
}

/** One supplier, by id, scoped to the shop that asked. */
export async function getSupplier(
  tenantId: string,
  supplierId: string,
): Promise<Supplier | null> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("suppliers")
    .select(COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", supplierId)
    .maybeSingle();

  if (!data) return null;

  const counts = await itemCounts(tenantId);
  return toSupplier(data as Row, counts.get(data.id) ?? 0);
}
