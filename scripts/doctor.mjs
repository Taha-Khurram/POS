/**
 * Preflight for the Supabase side of Flo.
 *
 *   npm run doctor
 *   npm run doctor -- you@example.com 'password'      # also checks JWT claims
 *
 * Written because the failure that costs the most time is silent: if the custom
 * access token hook is not enabled, sign-in succeeds, every RLS policy sees a
 * null tenant_id, and the signed-in app reads nothing. Nothing in the
 * app can tell you that — this can.
 */
import { createClient } from "@supabase/supabase-js";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Values may come from the real environment instead.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const email = process.env.ADMIN_EMAIL ?? process.argv[2];
const password = process.env.ADMIN_PASSWORD ?? process.argv[3];

const TABLES = [
  "tenants",
  "branches",
  "profiles",
  "platform_admins",
  "plans",
  "subscriptions",
  "orders",
  "payments",
  "invites",
  "leads",
  "audit_log",
  "tenant_notes",
  "tenant_health",
  "request_rate_limits",
  "renewal_reminders",
  "items",
  "register_devices",
  "shifts",
  "sales",
  "sale_lines",
  "sale_tenders",
  "sync_outbox",
  "tenant_settings",
  "role_permissions",
];

const CLAIMS = ["tenant_id", "tenant_role", "branch_id", "platform_role"];

let failures = 0;
const pass = (label, detail = "") => console.log(`  ok    ${label}${detail ? ` — ${detail}` : ""}`);
const fail = (label, detail) => {
  failures += 1;
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
};

const check = (ok, label, detail) => {
  if (ok) pass(label);
  else fail(label, detail);
};

console.log("\nEnvironment");
if (url) pass("NEXT_PUBLIC_SUPABASE_URL", url);
else fail("NEXT_PUBLIC_SUPABASE_URL", "not set");
check(!!publishableKey, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "not set");
check(!!serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY", "not set — see .env.example");

if (!url || !publishableKey || !serviceRoleKey) {
  console.log("\nCannot continue without all three.\n");
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

console.log("\nSchema");
const missing = [];
for (const table of TABLES) {
  const { error } = await admin.from(table).select("*", { count: "exact", head: true });
  if (error) missing.push(table);
}
if (missing.length === 0) {
  pass(`all ${TABLES.length} platform tables present`);
} else {
  fail("missing tables", `${missing.join(", ")} — apply supabase/migrations`);
}

const { count: planCount } = await admin
  .from("plans")
  .select("*", { count: "exact", head: true });
if (planCount >= 2) pass("plans seeded", `${planCount} rows`);
else fail("plans not seeded", "apply 0002_seed_plans.sql");

console.log("\nStorage");
const { data: buckets, error: bucketError } = await admin.storage.listBuckets();
const proofs = buckets?.find((bucket) => bucket.id === "payment-proofs");
if (bucketError) fail("listBuckets", bucketError.message);
else if (!proofs) fail("payment-proofs bucket", "missing — apply 0003_storage.sql");
else if (proofs.public) fail("payment-proofs bucket", "is PUBLIC; it holds bank statements");
else pass("payment-proofs bucket", "private");

console.log("\nPlatform admins");
const { data: admins, error: adminError } = await admin
  .from("platform_admins")
  .select("user_id, platform_role, full_name");
if (adminError) fail("platform_admins", adminError.message);
else if (!admins.length) fail("platform_admins", "empty");
else
  for (const row of admins) {
    pass(row.platform_role, row.full_name ?? row.user_id);
  }

if (!email || !password) {
  console.log(
    "\nAccess token hook\n" +
      "  skipped — pass an email and password to check the JWT claims:\n" +
      "            npm run doctor -- you@example.com 'password'",
  );
} else {
  console.log("\nAccess token hook");
  const anon = createClient(url, publishableKey, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    fail("sign in", error?.message ?? "no session returned");
  } else {
    pass("sign in", email);
    const [, body] = data.session.access_token.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    const stamped = CLAIMS.filter((claim) => claim in payload);

    if (stamped.length === 0) {
      fail(
        "custom claims",
        "NONE stamped. Enable it in the Dashboard: Authentication → Hooks →\n" +
          "        Customize Access Token (JWT) Claims → public.custom_access_token_hook.\n" +
          "        Until then every RLS policy sees null and /admin 404s for you too.",
      );
    } else {
      pass("custom claims", stamped.map((c) => `${c}=${JSON.stringify(payload[c])}`).join(" "));

      const isAdmin = admins?.some((row) => row.user_id === payload.sub);
      if (isAdmin && !payload.platform_role) {
        fail("platform_role", "this user is in platform_admins but the claim is null");
      } else if (isAdmin) {
        pass("this account reaches /admin", payload.platform_role);
      }
    }

    // `role` must stay "authenticated" — stamping over it breaks every query.
    if (payload.role === "authenticated") pass("role claim intact", payload.role);
    else fail("role claim", `is "${payload.role}", expected "authenticated"`);

    await anon.auth.signOut();
  }
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
