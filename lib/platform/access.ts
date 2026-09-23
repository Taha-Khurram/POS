import "server-only";

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { requireSession, type SessionContext } from "@/lib/auth";
import { canBill, type PlatformRole } from "@/lib/platform/admin";
import { createClient } from "@/utils/supabase/server";

export type PlatformSession = SessionContext & { platformRole: PlatformRole };

/**
 * The gate on every `/admin` route.
 *
 * **404, not 403.** A console that can activate paid accounts and read every
 * client's sales should not be discoverable by a shopkeeper who types a URL —
 * and "you are not allowed here" has already confirmed there is a here. The
 * same call `requireModule` makes for a module a cashier may not use, and for
 * the same reason.
 *
 * Signed out is the one case that is *not* a 404. It goes to the login page,
 * which is where somebody with a session to start belongs, and tells a stranger
 * nothing they could not learn by pressing Sign in anywhere else. The check
 * that matters is the one below it: a signed-in tenant user, poking about, gets
 * a page that does not exist.
 *
 * `requireSession` rather than `getSessionContext`, so an operator whose own
 * account was suspended is signed out here exactly as they would be at a till.
 * It costs one read and only for an account that also has a shop.
 *
 * This is presentation *and* control for the reads — every table the console
 * reads is read through the operator's own JWT, so RLS refuses a crafted
 * request even if this gate were wrong. The writes are service-role and
 * re-check for themselves.
 */
export async function requirePlatform(): Promise<PlatformSession> {
  const session = await requireSession();

  if (!session.platformRole) notFound();

  const standing = await operatorStanding(session.userId);

  if (standing !== "ok") {
    // An account that exists only to work this console has nowhere else to be,
    // so it is signed out and told why. One that also has a shop keeps its till
    // and simply stops finding a console here.
    if (!session.tenantId) redirect(`/logout?ended=${standing}`);
    notFound();
  }

  return { ...session, platformRole: session.platformRole };
}

type OperatorStanding = "ok" | "removed" | "suspended";

/**
 * Is this operator still on the roster, and switched on?
 *
 * The `platform_role` claim is stamped at sign-in and outlives whatever the
 * roster says for as long as the token lasts — an hour of somebody who was
 * switched off at noon still activating shops. `accountStanding` in
 * `lib/auth.ts` answers the same question for a till and this is its console
 * twin: one primary-key read of their own `platform_admins` row, through their
 * own JWT, which `platform_admins_read_self` allows.
 *
 * Fails open for the same reason that one does — an unreachable database is
 * not evidence anybody was removed — and is `cache()`d for the same reason:
 * the layout and the page both gate, and nothing an operator does in one
 * request changes their own standing, because `/admin/team` refuses their own
 * row.
 */
const operatorStanding = cache(async (userId: string): Promise<OperatorStanding> => {
  const supabase = createClient(await cookies());

  const { data, error } = await supabase
    .from("platform_admins")
    .select("is_active")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return "ok";
  if (!data) return "removed";

  return data.is_active ? "ok" : "suspended";
});

/** Only the roster of operators — who can hire and revoke support staff.
 *  `platform_admins_read_self` says the same thing in SQL. */
export async function requireSuperAdmin(): Promise<PlatformSession> {
  const session = await requirePlatform();

  if (session.platformRole !== "super_admin") notFound();

  return session;
}

type BillingCheck =
  | { ok: true; session: PlatformSession }
  | { ok: false; error: string };

/**
 * The write gate for anything that touches money or entitlement.
 *
 * Every Server Action in `/admin` that activates a shop, edits a plan, changes
 * a subscription or records a payment calls this for itself. A support account
 * is not shown those controls, but a control the browser does not draw is not
 * an endpoint nobody can call — the same reasoning that puts `getTillAccess`
 * behind every register action rather than only in front of the button.
 *
 * A sentence rather than a 404 here, because the caller is a form that has to
 * say something back to somebody who is already looking at the screen.
 */
export async function requireBilling(): Promise<BillingCheck> {
  const session = await requirePlatform();

  if (!canBill(session.platformRole)) {
    return {
      ok: false,
      error: "A support account cannot change billing. Ask whoever holds the full access account.",
    };
  }

  return { ok: true, session };
}
