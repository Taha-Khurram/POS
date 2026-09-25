import "server-only";

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { requireSession, type SessionContext } from "@/lib/auth";
import {
  isOwner,
  screensOf,
  type PlatformRole,
  type PlatformScreen,
} from "@/lib/platform/admin";
import { createClient } from "@/utils/supabase/server";

export type PlatformSession = SessionContext & {
  platformRole: PlatformRole;
  /** The screens this operator may open and work, read fresh off their own
   *  `platform_admins` row on every request — never from the token. */
  screens: PlatformScreen[];
  /** Marks an actor as acting from the console, so `recordAudit` files the row
   *  as `platform_admin` rather than as a shop's user. */
  console: true;
};

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

  const { standing, screens } = await operatorStanding(session.userId, session.platformRole);

  if (standing !== "ok") {
    // An account that exists only to work this console has nowhere else to be,
    // so it is signed out and told why. One that also has a shop keeps its till
    // and simply stops finding a console here.
    if (!session.tenantId) redirect(`/logout?ended=${standing}`);
    notFound();
  }

  return { ...session, platformRole: session.platformRole, screens, console: true };
}

type OperatorStanding = "ok" | "removed" | "suspended";

/**
 * Is this operator still on the roster, switched on, and which screens are
 * theirs?
 *
 * The `platform_role` claim is stamped at sign-in and outlives whatever the
 * roster says for as long as the token lasts — an hour of somebody who was
 * switched off at noon still activating shops. `accountStanding` in
 * `lib/auth.ts` answers the same question for a till and this is its console
 * twin: one primary-key read of their own `platform_admins` row, through their
 * own JWT, which `platform_admins_read_self` allows. The screens ride on the
 * same read, which is what makes un-ticking a tab take effect on the member's
 * next click rather than at their next sign-in.
 *
 * Fails open for the same reason that one does — an unreachable database is
 * not evidence anybody was removed — but fails open to the *owner's* screens
 * only for the owner: a member whose row cannot be read gets none. `cache()`d
 * because the layout and the page both gate, and nothing an operator does in
 * one request changes their own row, because `/admin/team` refuses it.
 */
const operatorStanding = cache(
  async (
    userId: string,
    role: PlatformRole,
  ): Promise<{ standing: OperatorStanding; screens: PlatformScreen[] }> => {
    const supabase = createClient(await cookies());

    const { data, error } = await supabase
      .from("platform_admins")
      .select("is_active, platform_role, screens")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) return { standing: "ok", screens: screensOf(role, []) };
    if (!data) return { standing: "removed", screens: [] };

    // The row, not the claim, says which level this is — a member promoted or
    // demoted since sign-in is what the roster says now.
    const current = data.platform_role === "super_admin" ? "super_admin" : "support";
    const screens = screensOf(current, (data.screens as string[] | null) ?? []);

    return { standing: data.is_active ? "ok" : "suspended", screens };
  },
);

/**
 * The gate on one shared screen's page. 404 rather than refusal, for
 * `requirePlatform`'s reason — except the console's own front door, which
 * sends a member to the first screen they were given rather than to a page
 * that does not exist.
 */
export async function requireScreen(screen: PlatformScreen): Promise<PlatformSession> {
  const session = await requirePlatform();

  if (!session.screens.includes(screen)) notFound();

  return session;
}

/**
 * The Flo owner's own screens — Team, the audit trail, Plans, Payment
 * accounts. `platform_admins_read_self` and `audit_log_read_owner` say the
 * same thing in SQL.
 */
export async function requireSuperAdmin(): Promise<PlatformSession> {
  const session = await requirePlatform();

  if (!isOwner(session.platformRole)) notFound();

  return session;
}

type WriteCheck =
  | { ok: true; session: PlatformSession }
  | { ok: false; error: string };

/**
 * The write gate every console Server Action calls for itself.
 *
 * A member is not drawn a screen they were not given, but a control the
 * browser does not draw is not an endpoint nobody can call — the same reasoning
 * that puts `getTillAccess` behind every register action rather than only in
 * front of the button. `screens` is every screen the action is reachable from:
 * recording a payment lives on Payments *and* on a client's record.
 *
 * A sentence rather than a 404, because the caller is a form that has to say
 * something back to somebody who is already looking at the screen.
 */
export async function requireWrite(
  screens: readonly PlatformScreen[],
): Promise<WriteCheck> {
  const session = await requirePlatform();

  if (!screens.some((screen) => session.screens.includes(screen))) {
    return {
      ok: false,
      error: "Your account was not given this screen. Ask the Flo owner to tick it on Team.",
    };
  }

  return { ok: true, session };
}

/** The same, for the screens only the owner has. */
export async function requireOwnerWrite(): Promise<WriteCheck> {
  const session = await requirePlatform();

  if (!isOwner(session.platformRole)) {
    return { ok: false, error: "Only the Flo owner can change this." };
  }

  return { ok: true, session };
}
