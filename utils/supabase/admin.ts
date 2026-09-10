import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * The service-role client. It bypasses RLS, so it is the only thing that can
 * create a tenant, mint an invite, or create an auth user — and it must never
 * reach the browser. Two guards keep it honest:
 *
 *   1. `import "server-only"` makes a client-component import a build error.
 *   2. The key is read from `SUPABASE_SERVICE_ROLE_KEY`, never `NEXT_PUBLIC_*`.
 *
 * Anything reachable by a shop's own JWT should use `utils/supabase/server.ts`
 * instead and let RLS do the gating.
 */
export const createAdminClient = () => {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — the admin client cannot be created.",
    );
  }

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      // No cookies, no refresh loop: every call is a one-shot server request.
      autoRefreshToken: false,
      persistSession: false,
    },
  });
};
