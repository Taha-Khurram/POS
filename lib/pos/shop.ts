import "server-only";

import { cookies } from "next/headers";

import { createClient } from "@/utils/supabase/server";

/**
 * The shop as Settings needs it: the tenant row and its counters.
 *
 * Read through the shop's own JWT rather than the service role. Both tables
 * carry a `select` policy scoped to the `tenant_id` claim, so RLS is the gate
 * here and the read doubles as a live check that the access-token hook is
 * stamping claims — a service-role read would happily return the row with the
 * hook switched off and hide the one failure that breaks everything else.
 *
 * Writes are a different matter: when Part 7 wires the forms up, they go
 * through a Server Action on the service role like every other write, because
 * there is no update policy anywhere in the schema.
 */

export type ShopBranch = {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  isPrimary: boolean;
};

export type ShopProfile = {
  id: string;
  shopName: string;
  ownerName: string;
  phone: string;
  email: string | null;
  city: string;
  shopType: string;
  /** FBR registration. Most kiryana shops have neither. */
  ntn: string | null;
  strn: string | null;
  branches: ShopBranch[];
};

export async function getShopProfile(
  tenantId: string,
): Promise<ShopProfile | null> {
  const supabase = createClient(await cookies());

  const [tenant, branches] = await Promise.all([
    supabase
      .from("tenants")
      .select("id, shop_name, owner_name, phone, email, city, shop_type, ntn, strn")
      .eq("id", tenantId)
      .maybeSingle(),
    supabase
      .from("branches")
      .select("id, name, city, address, phone, is_primary")
      .eq("tenant_id", tenantId)
      // The main counter first; the rest alphabetically, which is the order
      // an owner reads their own branch list in.
      .order("is_primary", { ascending: false })
      .order("name", { ascending: true }),
  ]);

  if (tenant.error || !tenant.data) return null;

  return {
    id: tenant.data.id,
    shopName: tenant.data.shop_name,
    ownerName: tenant.data.owner_name,
    phone: tenant.data.phone,
    email: tenant.data.email,
    city: tenant.data.city,
    shopType: tenant.data.shop_type,
    ntn: tenant.data.ntn,
    strn: tenant.data.strn,
    branches: (branches.data ?? []).map((branch) => ({
      id: branch.id,
      name: branch.name,
      city: branch.city,
      address: branch.address,
      phone: branch.phone,
      isPrimary: branch.is_primary,
    })),
  };
}
