/**
 * One place that turns a missing credential into a message you can act on.
 *
 * Without this you get Supabase's generic "Your project's URL and Key are
 * required", which does not say *which* variable, *where* to put it, or the
 * part that actually catches people out: `NEXT_PUBLIC_*` values are inlined
 * into the bundle at build time, so adding them to a host after a deploy does
 * nothing until you redeploy.
 *
 * No `server-only` here — the browser client imports this too.
 */
const missing = (name: string) =>
  new Error(
    `${name} is not set. Locally: add it to .env.local (see .env.example). ` +
      `In production: add it to the host's environment variables AND redeploy — ` +
      `NEXT_PUBLIC_* values are baked into the build, so setting them without a ` +
      `rebuild changes nothing.`,
  );

export function publicSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url) throw missing("NEXT_PUBLIC_SUPABASE_URL");
  if (!key) throw missing("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

  return { url, key };
}
