import "server-only";

import { cookies } from "next/headers";

import type { Department, Product } from "@/lib/pos/catalog";
import { createClient } from "@/utils/supabase/server";

/**
 * The shop's own departments and categories.
 *
 * Through the shop's own JWT, like `items.ts` and the readers in `shop.ts`:
 * `departments_read_own` and `categories_read_own` scope the rows to the
 * `tenant_id` claim, so RLS is the gate and the read doubles as a live check
 * that the access-token hook is stamping claims.
 *
 * Writes go through `app/(app)/app/inventory/tree-actions.ts` on the service
 * role — rule 3 from `0001_init.sql`.
 *
 * Deliberately NOT wrapped in React `cache()`, for the reason `listProducts` is
 * not: `cache()` is scoped to the request, and a Server Action plus the
 * re-render its `revalidatePath` triggers are one request — so a memoised read
 * would redraw the tree as it stood before the department was added.
 */

type DepartmentRow = { id: string; name: string; sort_order: number };
type CategoryRow = {
  id: string;
  name: string;
  department_id: string;
  sort_order: number;
};

/**
 * The whole tree in two queries, with the item counts folded in.
 *
 * Two, and not one nested select: PostgREST would return the categories under
 * their department, but the counts come off `items` by *name* rather than by
 * foreign key — the tree is the vocabulary and the item carries the words —
 * so the join could not be expressed there anyway. A shop's tree is tens of
 * rows; this is two index scans.
 *
 * The counts are handed in rather than queried, because every caller already
 * holds the item list for the table beside it, and a second trip to count rows
 * it is already holding is a trip for nothing.
 */
export async function listTree(
  tenantId: string,
  items: Pick<Product, "department" | "category">[] = [],
): Promise<Department[]> {
  const supabase = createClient(await cookies());

  const [departments, categories] = await Promise.all([
    supabase
      .from("departments")
      .select("id, name, sort_order")
      .eq("tenant_id", tenantId)
      .order("sort_order")
      .order("name"),
    supabase
      .from("categories")
      .select("id, name, department_id, sort_order")
      .eq("tenant_id", tenantId)
      .order("sort_order")
      .order("name"),
  ]);

  const tally = items.reduce<Record<string, number>>((counts, item) => {
    counts[item.department] = (counts[item.department] ?? 0) + 1;
    counts[`${item.department}/${item.category}`] =
      (counts[`${item.department}/${item.category}`] ?? 0) + 1;
    return counts;
  }, {});

  const rows = (categories.data ?? []) as CategoryRow[];

  return ((departments.data ?? []) as DepartmentRow[]).map((department) => ({
    id: department.id,
    name: department.name,
    items: tally[department.name] ?? 0,
    categories: rows
      .filter((row) => row.department_id === department.id)
      .map((row) => ({
        id: row.id,
        name: row.name,
        items: tally[`${department.name}/${row.name}`] ?? 0,
      })),
  }));
}
