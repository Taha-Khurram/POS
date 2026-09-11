import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const updateSession = async (request: NextRequest) => {
  const passThrough = () =>
    NextResponse.next({
      request: {
        headers: request.headers,
      },
    });

  // Nothing to refresh without credentials. Log it once, loudly, and still
  // serve the page: this runs on every non-static path, so a misconfigured
  // environment must not be able to turn the whole site into a 500.
  if (!supabaseUrl || !supabaseKey) {
    console.error(
      "[proxy] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing — skipping session refresh. Set both in the host's environment settings.",
    );
    return passThrough();
  }

  // Create an unmodified response
  let supabaseResponse = passThrough();

  try {
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    });

    // IMPORTANT: this call is what refreshes an expired session and writes the
    // rotated cookies back through `setAll` above. Do not remove it, and do not
    // run any logic between creating the client and calling it.
    await supabase.auth.getUser();
  } catch (cause) {
    // Refreshing the cookie is best-effort. Every gated route re-checks the
    // session itself, so a failure here should cost a stale token — never the
    // request. Without this, one unreachable Auth server 500s the marketing
    // site too.
    console.error("[proxy] session refresh failed", cause);
    return passThrough();
  }

  return supabaseResponse;
};
