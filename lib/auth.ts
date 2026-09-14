import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { createClient } from "@/utils/supabase/server";

export type TenantRole = "owner" | "manager";

const TENANT_ROLES = ["owner", "manager"] as const;

export type SessionContext = {
  userId: string;
  email: string | null;
  tenantId: string | null;
  tenantRole: TenantRole | null;
  branchId: string | null;
};

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

function asMember<T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : null;
}

/**
 * The claims stamped by `public.custom_access_token_hook`, read from the signed
 * access token. `getClaims()` verifies the signature, so this is a trusted
 * identity check — and unlike `getUser()` it costs no round-trip to the Auth
 * server on every render.
 *
 * Note the claim is `tenant_role`, not `role`: Supabase already uses `role` for
 * the Postgres role the request runs as. `platform_role` is still stamped by
 * the hook but no longer read here — there is no platform console to gate.
 *
 * Wrapped in `cache()` so the app gate can call it without re-verifying the
 * token more than once per request.
 */
export const getSessionContext = cache(
  async (): Promise<SessionContext | null> => {
    const supabase = createClient(await cookies());
    const { data, error } = await supabase.auth.getClaims();

    const claims = data?.claims;
    if (error || !claims || typeof claims.sub !== "string") return null;

    return {
      userId: claims.sub,
      email: asString(claims.email),
      tenantId: asString(claims.tenant_id),
      tenantRole: asMember(claims.tenant_role, TENANT_ROLES),
      branchId: asString(claims.branch_id),
    };
  },
);

/**
 * Gate for `/app`. Signed out goes back to the login page, which has one
 * destination of its own — so there is no return path to carry.
 */
export async function requireSession(): Promise<SessionContext> {
  const session = await getSessionContext();
  if (!session) redirect("/login");
  return session;
}
