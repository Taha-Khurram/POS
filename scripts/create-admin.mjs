/**
 * Create a platform admin — the only supported way to get into `/admin`.
 *
 * There is deliberately no route, form, or Server Action that can do this. A
 * platform admin can activate paid subscriptions and read every client's sales,
 * so it takes the service-role key and a deliberate command on your machine.
 *
 *   npm run create-admin -- you@example.com 'your-password'
 *
 * or, to keep the password out of your shell history:
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... npm run create-admin
 *
 * Idempotent: run it again to re-assert the role or reset the password.
 *
 * Requires `supabase/migrations` to have been applied — the `platform_admins`
 * table has to exist. Uses the Admin API, so it works even with public signup
 * disabled, which is the point.
 */
import { createClient } from "@supabase/supabase-js";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Fine if it is absent — the values may come from the real environment.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const email = process.env.ADMIN_EMAIL ?? process.argv[2];
const password = process.env.ADMIN_PASSWORD ?? process.argv[3];
const fullName = process.env.ADMIN_NAME ?? process.argv[4] ?? null;
const role = process.env.ADMIN_ROLE ?? "super_admin";

const die = (message) => {
  console.error(`\n  ${message}\n`);
  process.exit(1);
};

if (!url) die("NEXT_PUBLIC_SUPABASE_URL is not set. See .env.example.");
if (!serviceRoleKey) {
  die(
    "SUPABASE_SERVICE_ROLE_KEY is not set.\n" +
      "  Supabase → Project Settings → API keys → service_role. Put it in\n" +
      "  .env.local (never NEXT_PUBLIC_, never in git).",
  );
}
if (!email || !password) {
  die("Usage: npm run create-admin -- <email> <password> [full name]");
}
if (role !== "super_admin" && role !== "support") {
  die(`ADMIN_ROLE must be super_admin or support, got "${role}".`);
}

// A weak password here is not the same as a weak password anywhere else, so say
// so out loud rather than failing — it is your account and your call.
if (password.length < 12 || /^\d+$/.test(password)) {
  console.warn(
    "\n  ! This password is short or all digits. This account can activate paid\n" +
      "    subscriptions and read every client's sales. Enrol a TOTP factor\n" +
      "    (Authentication → MFA) before you activate a real client.",
  );
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** The Admin API has no get-by-email, so page until we find them. */
async function findUserByEmail(target) {
  const needle = target.toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw new Error(`listUsers failed: ${error.message}`);

    const match = data.users.find((user) => user.email?.toLowerCase() === needle);
    if (match) return match;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function main() {
  let user = await findUserByEmail(email);

  if (user) {
    const { data, error } = await supabase.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
    });
    if (error) die(`Could not update the existing user: ${error.message}`);
    user = data.user;
    console.log(`  Updated existing auth user ${user.id}`);
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      // No inbox round-trip for your own account; invites are for clients.
      email_confirm: true,
    });
    if (error) die(`Could not create the auth user: ${error.message}`);
    user = data.user;
    console.log(`  Created auth user ${user.id}`);
  }

  const { error: roleError } = await supabase
    .from("platform_admins")
    .upsert(
      { user_id: user.id, platform_role: role, full_name: fullName },
      { onConflict: "user_id" },
    );

  if (roleError) {
    die(
      `Auth user is ready but the platform_admins row failed: ${roleError.message}\n` +
        "  If this says the relation does not exist, apply supabase/migrations first.",
    );
  }

  await supabase.from("audit_log").insert({
    actor_kind: "system",
    action: "platform_admin.granted",
    subject_type: "auth.users",
    subject_id: user.id,
    after: { email, platform_role: role },
  });

  console.log(`  Granted ${role} to ${email}`);
  console.log(
    "\n  Next: enable the access-token hook (Authentication → Hooks →\n" +
      "  public.custom_access_token_hook), then sign in at /login. The\n" +
      "  platform_role claim is stamped at token issue, so any existing\n" +
      "  session will still 404 on /admin until you sign in again.\n",
  );
}

main().catch((cause) => die(cause.message ?? String(cause)));
