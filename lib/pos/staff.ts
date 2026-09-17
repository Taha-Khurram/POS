import "server-only";

import { cookies } from "next/headers";

import type { TenantRole } from "@/lib/auth";
import { createClient } from "@/utils/supabase/server";

/**
 * The shop's people.
 *
 * Read through the shop's own JWT, like the rest of `lib/pos/shop.ts`:
 * `profiles_read_own_tenant` scopes the rows to the `tenant_id` claim, so RLS
 * is the gate and the read doubles as a live check that the access-token hook
 * is stamping claims. Writes go through `app/(app)/app/employees/actions.ts` on
 * the service role, because the schema has no update policy for a tenant JWT
 * anywhere.
 *
 * Deliberately NOT wrapped in React `cache()`, for the reason the four readers
 * in `shop.ts` are not: `cache()` is scoped to the request, and a Server Action
 * plus the re-render its `revalidatePath` triggers are one request — so a
 * memoised read would hand that re-render the roster as it stood before the
 * hire, and the owner would watch a staff member they just created fail to
 * appear.
 */

export type StaffMember = {
  id: string;
  name: string;
  /** The work email Flo minted. Null on a row that predates `0012`. */
  email: string | null;
  phone: string | null;
  role: TenantRole;
  isActive: boolean;
  /** The one account that hires, edits and removes. Never editable from here. */
  isOwner: boolean;
  createdAt: string;
};

export async function listStaff(tenantId: string): Promise<StaffMember[]> {
  const supabase = createClient(await cookies());

  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone, tenant_role, is_active, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at");

  return (data ?? [])
    .map((row) => ({
      id: row.id,
      // A profile created before this screen existed can have a null name. The
      // address is the next best handle on who it is, and "Unnamed" beats a
      // blank row the owner cannot tell apart from the one above it.
      name: row.full_name ?? row.email ?? "Unnamed",
      email: row.email,
      phone: row.phone,
      role: (row.tenant_role ?? "cashier") as TenantRole,
      isActive: row.is_active,
      isOwner: row.tenant_role === "owner",
      createdAt: row.created_at,
    }))
    // The owner first, then in the order they were hired. Sorted here rather
    // than in the query because it is a two-key sort on a list of at most a
    // dozen, and `.order()` cannot express "this value first".
    .sort((a, b) => Number(b.isOwner) - Number(a.isOwner));
}

/** One staff member, scoped to the shop that asked. */
export async function getStaffMember(
  tenantId: string,
  staffId: string,
): Promise<StaffMember | null> {
  const roster = await listStaff(tenantId);
  return roster.find((member) => member.id === staffId) ?? null;
}
