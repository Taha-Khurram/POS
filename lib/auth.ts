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
 * Is this account still standing?
 *
 * The access token is signed and self-contained, which is what makes
 * `getSessionContext()` free — and is also why removing somebody does not, on
 * its own, get them off the till. Deleting the auth user takes their refresh
 * token with it and suspending them bans it, so neither can start a new
 * session; but the token already in the tablet's cookie stays valid until it
 * expires, and it goes on satisfying every RLS policy in the database, because
 * those read its claims. A cashier sacked at noon would keep billing until the
 * hour was up.
 *
 * So the gate asks. One read of their own row, by primary key, through their
 * own JWT:
 *
 *   - **No row** — the account was deleted. `profiles.id` cascades from
 *     `auth.users`, so the row goes when the account does.
 *   - **`is_active` false** — suspended. GoTrue bans the user at the same time,
 *     which stops the next sign-in; this is what stops the current one.
 *
 * Only asked of a token that claims a shop. An account with no `tenant_id` has
 * no `profiles` row to find, and is the one case that must go on reaching the
 * dashboard to be told it is not attached yet.
 *
 * It fails open. An unreachable database is not evidence that anybody was
 * sacked, and a shop mid-queue must not be signed out by a network blip.
 *
 * `cache()` is safe here where it is not in `lib/pos/shop.ts`: this is the
 * reader's own standing, and nothing an actor does in one request changes it
 * for themselves — the staff editor refuses the owner's own row for exactly
 * that reason. Without it, the layout and the page it wraps would ask twice.
 */
type Standing = "ok" | "removed" | "suspended";

const accountStanding = cache(
  async (userId: string, tenantId: string | null): Promise<Standing> => {
    if (!tenantId) return "ok";

    const supabase = createClient(await cookies());

    const { data, error } = await supabase
      .from("profiles")
      .select("is_active")
      .eq("id", userId)
      .maybeSingle();

    if (error) return "ok";
    if (!data) return "removed";

    return data.is_active ? "ok" : "suspended";
  },
);

/**
 * Gate for `/app`. Signed out goes back to the login page, which has one
 * destination of its own — so there is no return path to carry.
 *
 * Every page, the layout and every Server Action come through here, so the
 * standing check below covers the register's writes as well as its screens: a
 * cashier removed while the payment sheet was open does not get to record the
 * sale in it.
 */
export async function requireSession(): Promise<SessionContext> {
  const session = await getSessionContext();
  if (!session) redirect("/login");

  const standing = await accountStanding(session.userId, session.tenantId);

  // Not `/login` directly: the cookie has to come off the device, and only a
  // route handler can write one.
  if (standing !== "ok") redirect(`/logout?ended=${standing}`);

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
