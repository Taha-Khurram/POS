/**
 * Post-login destination rules. Pure functions with no Next or Supabase
 * imports, so they can be exercised directly with `node scripts/redirects.test.mjs`
 * — worth it because getting either of them wrong is an open redirect or an
 * admin who can never reach their own console.
 */

export type Home = "/admin" | "/app";

/**
 * Only same-origin absolute paths. Without this, `?next=https://evil.example`
 * turns the login page into an open redirect that arrives with a fresh session
 * cookie already set. Backslashes are rejected too: some browsers normalise
 * `/\evil.example` into a protocol-relative URL.
 */
export function safeNext(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (raw.includes("\\")) return null;
  return raw;
}

/**
 * Where this person actually belongs.
 *
 * `next` is honoured only when the signed-in role can reach it. It is almost
 * always set by a gate someone stumbled into rather than chosen, so an admin
 * who once typed `/app` must not be sent back there for the rest of time — and
 * a shop owner carrying `next=/admin` would land on a 404 rather than a screen.
 */
export function destination(next: string | null, isPlatformAdmin: boolean): string {
  const home: Home = isPlatformAdmin ? "/admin" : "/app";
  if (!next) return home;

  // Compare the path only, so `/app/register?held=3` still counts as `/app`.
  const path = next.split(/[?#]/)[0];
  const withinHome = path === home || path.startsWith(`${home}/`);

  return withinHome ? next : home;
}
