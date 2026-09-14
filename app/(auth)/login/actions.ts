"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/utils/supabase/server";

export type LoginState = { error: string | null };

/**
 * The only account that may sign in while the product is in private preview.
 *
 * This is a gate in front of Supabase, not a replacement for it: the password
 * is still verified against `auth.users` on every attempt, so the list decides
 * *who* may try, never whether they got it right. Lift the restriction by
 * deleting this constant and the check below — nothing else depends on it.
 */
const ALLOWED_EMAILS = ["tahakhurramofficial@gmail.com"];

/** Where a successful sign-in lands. There is exactly one destination. */
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

  if (!ALLOWED_EMAILS.includes(email)) return rejected;

  const supabase = createClient(await cookies());
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) return rejected;

  redirect(AFTER_SIGN_IN);
}
