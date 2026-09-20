import "server-only";

import { cookies } from "next/headers";

import { stockState, type Product, type TrackingMode, type UnitId } from "@/lib/pos/catalog";
import { createClient } from "@/utils/supabase/server";

/**
 * The shop's catalog, read as rows.
 *
 * Through the shop's own JWT, like `lib/pos/shop.ts` and `lib/pos/staff.ts`:
 * `items_read_own` scopes the rows to the `tenant_id` claim, so RLS is the gate
 * and the read doubles as a live check that the access-token hook is stamping
 * claims. A service-role read would happily return the list with the hook
 * switched off and hide the one failure that breaks everything else.
 *
 * Writes go through `app/(app)/app/inventory/actions.ts` on the service role,
 * because 0008 revoked insert/update/delete on `items` from `authenticated`
 * outright — rule 3 from `0001_init.sql`, so that there is one auditable write
 * path rather than a policy surface to get wrong.
 *
 * Deliberately NOT wrapped in React `cache()`, for the reason the readers in
 * `shop.ts` and `staff.ts` are not: `cache()` is scoped to the request, and a
 * Server Action plus the re-render its `revalidatePath` triggers are one
 * request — so a memoised read would hand that re-render the catalog as it
 * stood before the save, and the owner would watch the product they just added
 * fail to appear.
 */

/**
 * `supplier:suppliers(name)` is an embedded read, not a second round trip.
 *
 * `0027` dropped `items.supplier` — the text column that held four hundred
 * spellings of six distributors — and put a foreign key in its place. The
 * screens only ever wanted the word, so the word is what `toProduct` hands
 * them; PostgREST resolves the embed through the foreign key in the same
 * request, and RLS on `suppliers` scopes it to this shop exactly as it scopes
 * `items`.
 *
 * One gotcha, and it is why `embedded()` below exists: with no generated
 * database types in this project, supabase-js cannot tell a many-to-one embed
 * from a one-to-many one and infers an array for both. PostgREST returns a
 * single object here, because the foreign key is on `items`. So the row type
 * admits either shape and the reader normalises once — an `as unknown as Row[]`
 * would compile just as well and would be a lie about what comes back.
 */
const COLUMNS =
  "id, name, name_urdu, sku, barcode, department, category, unit, tracking, cost_price, selling_price, stock, low_at, supplier_id, supplier:suppliers(name), tax_rate, variant_count, is_active";

type Row = {
  id: string;
  name: string;
  name_urdu: string | null;
  sku: string | null;
  barcode: string | null;
  department: string | null;
  category: string | null;
  unit: string;
  tracking: string;
  cost_price: number | string;
  selling_price: number | string;
  stock: number | string;
  low_at: number | string;
  supplier_id: string | null;
  /** The embed. Null for an item nobody has said where they buy from, which is
   *  most of a shop's list before it ever opens Purchasing. */
  supplier: { name: string } | { name: string }[] | null;
  tax_rate: number | string;
  variant_count: number | null;
  is_active: boolean;
};

/** `numeric` comes back as a string from PostgREST on some column widths. */
const money = (value: number | string | null) => Number(value ?? 0) || 0;

/** The one row of a to-one embed, whichever shape the client typed it as. */
const embedded = <T,>(value: T | T[] | null): T | null =>
  Array.isArray(value) ? (value[0] ?? null) : value;

function toProduct(row: Row): Product {
  return {
    id: row.id,
    name: row.name,
    // The screens treat the Urdu name as a string they can search and render
    // right-to-left; a null would have every caller writing `?? ""` instead.
    urdu: row.name_urdu ?? "",
    sku: row.sku ?? "",
    barcode: row.barcode,
    department: row.department ?? "",
    category: row.category ?? "",
    // 'kilo' is the spelling 0008's constraint shipped with, kept valid by 0011
    // so nothing written under it became an invalid row. The app has one name
    // for a kilogram, and this is where the old one is folded into it.
    unit: (row.unit === "kilo" ? "kg" : row.unit) as UnitId,
    tracking: row.tracking as TrackingMode,
    variants: row.variant_count ?? undefined,
    cost: money(row.cost_price),
    price: money(row.selling_price),
    stock: money(row.stock),
    lowAt: money(row.low_at),
    supplierId: row.supplier_id,
    supplier: embedded(row.supplier)?.name ?? "",
    taxRate: money(row.tax_rate),
    isActive: row.is_active,
  };
}

/** Everything in the list, hidden items included — this is the editor's view. */
export async function listProducts(tenantId: string): Promise<Product[]> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("items")
    .select(COLUMNS)
    .eq("tenant_id", tenantId)
    .order("name");

  return ((data ?? []) as Row[]).map(toProduct);
}

/**
 * What the register may ring up.
 *
 * The same rows minus the hidden ones, because an item switched off is an item
 * the till must not offer — and the Server Action that records a sale re-reads
 * it with the same filter, so a stale tab cannot sell one either.
 */
export async function listSellableProducts(tenantId: string): Promise<Product[]> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("items")
    .select(COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("name");

  return ((data ?? []) as Row[]).map(toProduct);
}

/**
 * What the bell needs, and nothing else.
 *
 * Two numeric columns for the whole catalog, counted here. `stock <= low_at` is
 * a comparison between two columns, which PostgREST cannot express as a filter
 * — and the alternative, a view or an RPC for a tally the console draws on
 * every page, is more moving parts than a shop's worth of two-number rows.
 *
 * It uses the same `stockState` the items table paints its badges with, so the
 * bell and that screen cannot disagree about what is on the shelf.
 */
export async function stockCounts(
  tenantId: string,
): Promise<{ out: number; low: number }> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("items")
    .select("stock, low_at")
    .eq("tenant_id", tenantId)
    .eq("is_active", true);

  let out = 0;
  let low = 0;

  for (const row of data ?? []) {
    const state = stockState({ stock: money(row.stock), lowAt: money(row.low_at) });
    if (state === "out") out += 1;
    else if (state === "low") low += 1;
  }

  return { out, low };
}
