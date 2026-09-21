import "server-only";

import { notFound } from "next/navigation";

import { requireSession, type SessionContext } from "@/lib/auth";
import { canBill, type PlatformRole } from "@/lib/platform/admin";

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

  return { ...session, platformRole: session.platformRole };
}

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
