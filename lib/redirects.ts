/**
 * Post-login destination validation. Pure functions with no Next or Supabase
 * imports, so they can be exercised directly with Node.
 */

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

