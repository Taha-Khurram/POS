import "server-only";

import { cookies } from "next/headers";

import { summariseVariants, type Variant, type VariantSummary } from "@/lib/pos/variant";
import { createClient } from "@/utils/supabase/server";

/**
 * An item's variants, read as rows.
 *
 * Through the shop's own JWT, like every other reader in `lib/pos/`:
 * `item_variants_read_own` scopes to the `tenant_id` claim. Nothing here writes
 * — `private.move_stock` is the only writer of `item_variants.quantity` and
 * `public.save_variants` the only writer of the grid, both revoked from
 * everybody but the service role.
 *
 * Deliberately NOT wrapped in React `cache()`, for the reason none of the other
 * readers are.
 */

const money = (value: number | string | null) =>
  value === null ? null : Number(value) || 0;

const COLUMNS =
  "id, item_id, option_a, option_b, sku, barcode, selling_price, cost_price, quantity, is_active, sort_order";

type Row = {
  id: string;
  item_id: string;
  option_a: string;
  option_b: string | null;
  sku: string | null;
  barcode: string | null;
  selling_price: number | string | null;
  cost_price: number | string | null;
  quantity: number | string;
  is_active: boolean;
  sort_order: number;
};

const toVariant = (row: Row): Variant => ({
  id: row.id,
  itemId: row.item_id,
  optionA: row.option_a,
  optionB: row.option_b ?? "",
  sku: row.sku ?? "",
  barcode: row.barcode ?? "",
  // Null is meaningful here and is *not* flattened to zero the way the other
  // readers flatten nulls to "": it means "the item's own price", and a zero
  // would mean this row is free.
  price: money(row.selling_price),
  cost: money(row.cost_price),
  quantity: Number(row.quantity) || 0,
  isActive: row.is_active,
  sortOrder: row.sort_order,
});

/** One item's grid, switched-off rows included — the editor's view. */
export async function listVariants(
  tenantId: string,
  itemId: string,
): Promise<Variant[]> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("item_variants")
    .select(COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("item_id", itemId)
    .order("sort_order")
    .order("option_a");

  return ((data ?? []) as Row[]).map(toVariant);
}

/**
 * Every live variant in the shop, by item id.
 *
 * One read for the whole catalog rather than one per item — the n+1 the till
 * and the item list would otherwise pay on every paint. A shop that sells
 * nothing by variant reads nothing: the filter is on `is_active` over a table
 * that is empty for them.
 *
 * The till needs this in full, because a cloth house's cashier picks a size
 * from a grid and a round trip per tap is a grid nobody uses.
 */
export async function variantsByItem(
  tenantId: string,
): Promise<Map<string, Variant[]>> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("item_variants")
    .select(COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("sort_order")
    .order("option_a");

  const byItem = new Map<string, Variant[]>();

  for (const row of (data ?? []) as Row[]) {
    const variant = toVariant(row);
    const list = byItem.get(variant.itemId);
    if (list) list.push(variant);
    else byItem.set(variant.itemId, [variant]);
  }

  return byItem;
}

/** What each variant-tracked item's grid comes to, for the item list's badge. */
export async function variantSummaries(
  tenantId: string,
): Promise<Map<string, VariantSummary>> {
  const grids = await variantsByItem(tenantId);
  const summaries = new Map<string, VariantSummary>();

  for (const [itemId, variants] of grids) {
    summaries.set(itemId, summariseVariants(variants));
  }

  return summaries;
}

/**
 * One variant by its barcode, for the till's scanner.
 *
 * Scanning is how a cloth house rings up a size — the label on the garment
 * carries the variant's own code, not the item's. `0031`'s trigger guarantees
 * the code is not also an item's, so a scan resolves to exactly one thing and
 * the till can try items first and variants second without ambiguity.
 */
export async function variantByBarcode(
  tenantId: string,
  barcode: string,
): Promise<Variant | null> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("item_variants")
    .select(COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("barcode", barcode)
    .eq("is_active", true)
    .maybeSingle();

  return data ? toVariant(data as Row) : null;
}
