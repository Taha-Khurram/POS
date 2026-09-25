"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { recordAudit } from "@/lib/audit";
import type { SessionContext } from "@/lib/auth";
import { isWorkEmail } from "@/lib/pos/staff-options";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";

export type LoginState = { error: string | null };

/**
 * The human accounts that may sign in while the product is in private preview.
 *
 * This is a gate in front of Supabase, not a replacement for it: the password
 * is still verified against `auth.users` on every attempt, so the list decides
 * *who* may try, never whether they got it right. Lift the restriction by
 * deleting this constant and the check below — nothing else depends on it.
 *
 * Staff are not on it and never will be. Every account the owner hires on
 * `/app/employees` gets a minted work address, which `isWorkEmail` recognises
 * by its domain — a list that had to grow a line per cashier would be a list
 * somebody forgets to grow at 9 am on a Saturday.
 */
const ALLOWED_EMAILS = ["tahakhurramofficial@gmail.com"];

/**
 * Somebody `/admin/team` made, and has not switched off.
 *
 * The operators are the other list that grows without an edit here, for the
 * reason staff are: the console creates the account and hands over the
 * password, and a person who then cannot get past this screen was handed a
 * password to nothing. Read on the service role because the caller is not
 * signed in yet — and nothing it finds reaches the caller, so it tells a
 * stranger nothing the single rejection message below does not already hide.
 */
async function operatorId(email: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from("platform_admins")
    .select("user_id")
    .eq("email", email)
    .eq("is_active", true)
    .maybeSingle();

  return data ? String(data.user_id) : null;
}

/**
 * The audit trail records every console account's sign-ins, and the attempts
 * that failed — the one row a person trying somebody else's password leaves.
 * Written as a console actor (`console: true`) so the trail files it beside
 * everything else they do there.
 */
async function recordSignIn(userId: string, email: string, ok: boolean) {
  const actor: SessionContext & { console: true } = {
    userId,
    email,
    tenantId: null,
    tenantRole: null,
    branchId: null,
    platformRole: null,
    console: true,
  };

  await recordAudit(actor, {
    action: ok ? "platform_admin.signed_in" : "platform_admin.sign_in_failed",
    subjectType: "platform_admin",
    subjectId: userId,
  });
}

/** Where a successful sign-in lands, for everybody but a console-only operator. */
const AFTER_SIGN_IN = "/app";

/**
 * Sign in and go to the dashboard. A Server Action rather than a browser-side
 * call because `utils/supabase/server.ts` can only write the session cookies
 * from somewhere that is allowed to set them — a Server Component's `setAll` is
 * a no-op.
 */
export async function signIn(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  // One message for every failure below on purpose: never confirm to a stranger
  // which email is registered, and never let the preview allow-list be probed
  // for the address that is on it.
  const rejected: LoginState = {
    error: "That email and password do not match an account.",
  };

  const owner = ALLOWED_EMAILS.includes(email);
  // Asked of every address, not only unlisted ones: a team member's username
  // is `ali@team.flopos.pk`, which `isWorkEmail` already lets through as if it
  // were a cashier's — and a cashier lands on `/app`.
  const operator = await operatorId(email);

  if (!owner && !isWorkEmail(email) && !operator) return rejected;

  const supabase = createClient(await cookies());
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  // A suspended staff member is banned on the auth user itself, so GoTrue
  // refuses them here and this never has to ask `profiles` whether they are
  // still employed. That matters: a check made after the session cookie is set
  // is a check that already handed out a session.
  if (error || !data.session) {
    if (operator) await recordSignIn(operator, email, false);
    return rejected;
  }

  if (operator) await recordSignIn(operator, email, true);

  // The one fork: an account let in only because it works the console has no
  // shop, and `/app` would greet it with a dashboard of nothing.
  redirect(operator && !owner ? "/admin" : AFTER_SIGN_IN);
}
