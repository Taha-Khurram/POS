"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { safeNext } from "@/lib/redirects";
import { createClient } from "@/utils/supabase/server";

export type LoginState = { error: string | null };

/**
 * Sign in and land the person where they belong. A Server Action rather than a
 * browser-side call because `utils/supabase/server.ts` can only write the
 * session cookies from somewhere that is allowed to set them — a Server
 * Component's `setAll` is a no-op.
 */
export async function signIn(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = createClient(await cookies());
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    // One message for both cases on purpose: never confirm to a stranger that
    // an email is registered.
    return { error: "That email and password do not match an account." };
  }

  redirect(next ?? "/app");
}
