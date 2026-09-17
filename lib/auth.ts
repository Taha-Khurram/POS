import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { createClient } from "@/utils/supabase/server";

export type TenantRole = "owner" | "manager" | "cashier";

const TENANT_ROLES = ["owner", "manager", "cashier"] as const;

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
 * the Postgres role the request runs as. Since `0012` a cashier is an auth user
 * too, so the claim has three values and every `=== "owner"` check in the app
 * closes against the two new ones by default. `platform_role` is still stamped by
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

type OwnerCheck =
  | { ok: true; session: SessionContext & { tenantId: string } }
  | { ok: false; reason: "detached" | "not_owner" };

/**
 * The write gate for the whole console: signed in, attached to a shop, and the
 * owner of it.
 *
 * It lives here rather than beside one screen's actions because Settings and
 * Staff both need it and there must be exactly one answer to "who may write" —
 * a manager who could edit staff could promote themselves, and a manager who
 * could raise a ceiling would be setting their own limit.
 *
 * Carries the session out on success, so the caller has the actor to audit with
 * and a narrowed `tenantId` to scope the write by. It returns a reason rather
 * than a sentence: the wording belongs to the screen that is about to render it.
 */
export async function requireOwner(): Promise<OwnerCheck> {
  const session = await requireSession();

  if (!session.tenantId) return { ok: false, reason: "detached" };
  if (session.tenantRole !== "owner") return { ok: false, reason: "not_owner" };

  return { ok: true, session: { ...session, tenantId: session.tenantId } };
}
