import "server-only";

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { createClient } from "@/utils/supabase/server";

export type PlatformRole = "super_admin" | "support";
export type TenantRole = "owner" | "manager";

const PLATFORM_ROLES = ["super_admin", "support"] as const;
const TENANT_ROLES = ["owner", "manager"] as const;

export type SessionContext = {
  userId: string;
  email: string | null;
  /** Null for a signed-up-but-not-yet-activated account. It sees nothing. */
  tenantId: string | null;
  tenantRole: TenantRole | null;
  branchId: string | null;
  platformRole: PlatformRole | null;
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
 * the Postgres role the request runs as.
 *
 * Wrapped in `cache()` so the gates below can be called from a layout, a page,
 * and a `generateMetadata()` in the same request without re-verifying the token
 * three times.
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
      platformRole: asMember(claims.platform_role, PLATFORM_ROLES),
    };
  },
);

/**
 * Gate for `/app`. Signed out goes to the login page with a return path; a
 * session with no tenant is allowed through so the layout can explain itself
 * rather than bouncing the owner in a loop.
 */
export async function requireSession(returnTo: string): Promise<SessionContext> {
  const session = await getSessionContext();
  if (!session) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  return session;
}

/**
 * Gate for `/admin`. `notFound()` rather than a 403 — the console should not be
 * discoverable by a tenant who guesses the URL (§3.7).
 *
 * Call this in the layout AND in every page and `generateMetadata()` beneath
 * it. A layout gate alone is not enough: Next renders the page concurrently
 * with the layout, so a page that does not gate itself still serialises its
 * markup and its title into the 404 response — which tells the prober exactly
 * what they were looking for. Layouts also do not re-render on client
 * navigation, so they cannot be the only check.
 */
export async function requirePlatformAdmin(): Promise<
  SessionContext & { platformRole: PlatformRole }
> {
  const session = await getSessionContext();
  if (!session?.platformRole) notFound();
  return session as SessionContext & { platformRole: PlatformRole };
}

/** Billing rights are the super_admin's; support staff read and answer calls. */
export const canTakePayments = (session: SessionContext) =>
  session.platformRole === "super_admin";
