import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const missing = (name: string) =>
  new Error(
    `${name} is not set — the admin client cannot be created. Locally: add it ` +
      `to .env.local (see .env.example). On the host: check that it is set for ` +
      `the environment being deployed, and that the value is not blank. ` +
      `NEXT_PUBLIC_* values are baked into the build, so setting one without a ` +
      `rebuild changes nothing.`,
  );

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
  // Named one at a time, because "one of these two" is a message you cannot act
  // on from a host's dashboard — a sensitive variable's value is write-only
  // there, so a blank or mistyped one looks exactly like a correct one, and the
  // combined sentence sent you to check the variable that was already fine.
  if (!supabaseUrl) throw missing("NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceRoleKey) throw missing("SUPABASE_SERVICE_ROLE_KEY");

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      // No cookies, no refresh loop: every call is a one-shot server request.
      autoRefreshToken: false,
      persistSession: false,
    },
  });
};
