import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { publicSupabaseEnv } from "@/utils/supabase/env";

/**
 * Ends a session that the console has decided is over.
 *
 * The sign-out button on the rail is a Server Action and stays one. This exists
 * for the other case: `requireSession()` finding that the account behind a
 * still-valid token has been removed from the shop or suspended. A Server
 * Component cannot clear a cookie — its `setAll` is a no-op — so the gate has
 * nowhere to send somebody except here.
 *
 * The cookies are written onto this response rather than through `cookies()`,
 * the same way `utils/supabase/middleware.ts` does it: the sign-out has to
 * produce `Set-Cookie` headers on the redirect that carries it, and binding the
 * client to the response is the version of that which cannot depend on when the
 * framework decides to flush.
 *
 * Being a GET, this can be triggered by any page that links or points an image
 * at it. That is worth knowing and is not worth defending against: the whole
 * effect is to sign somebody out of their own session, and the fix for a token
 * that is still accepted elsewhere is a shorter JWT lifetime, not a POST.
 */

/** Why the session ended, passed on to the login screen. Anything else is
 *  dropped rather than reflected back into the page. */
const ENDINGS = new Set(["removed", "suspended"]);

export async function GET(request: NextRequest) {
  const ended = request.nextUrl.searchParams.get("ended");

  const destination = new URL("/login", request.nextUrl.origin);
  if (ended && ENDINGS.has(ended)) destination.searchParams.set("ended", ended);

  const response = NextResponse.redirect(destination);

  const { url, key } = publicSupabaseEnv();

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        cookies.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Best effort on the server's side of it. Whether or not Auth answers, the
  // cookies come off this device — which is the half that matters to the person
  // holding the tablet.
  await supabase.auth.signOut().catch(() => {});

  return response;
}
