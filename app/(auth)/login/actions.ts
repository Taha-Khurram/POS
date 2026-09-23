"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

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
 * signed in yet — and it answers only yes or no, so it tells a stranger
 * nothing the single rejection message below does not already hide.
 */
async function isOperator(email: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("platform_admins")
    .select("user_id")
    .eq("email", email)
    .eq("is_active", true)
    .maybeSingle();

  return Boolean(data);
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

  const listed = ALLOWED_EMAILS.includes(email) || isWorkEmail(email);
  const operator = !listed && (await isOperator(email));

  if (!listed && !operator) return rejected;

  const supabase = createClient(await cookies());
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  // A suspended staff member is banned on the auth user itself, so GoTrue
  // refuses them here and this never has to ask `profiles` whether they are
  // still employed. That matters: a check made after the session cookie is set
  // is a check that already handed out a session.
  if (error || !data.session) return rejected;

  // The one fork: an account let in only because it works the console has no
  // shop, and `/app` would greet it with a dashboard of nothing.
  redirect(operator ? "/admin" : AFTER_SIGN_IN);
}
