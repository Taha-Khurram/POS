/**
 * A failed Supabase read, as a line somebody can act on.
 *
 * No `server-only` and no imports, because it is a pure string function — but
 * everything that calls it is server-side, and deliberately so.
 *
 * It exists because of one sharp edge. `dashboard.ts` and `reports.ts` both
 * swallow a failed aggregate and return zeroes rather than throwing: a console
 * an owner cannot get into is worse than a console showing an obviously wrong
 * figure, and the zeroes are visible on the screen where a crash is visible
 * only in the log. That bargain only holds **if the log actually says
 * something** — and `console.error("…", error)` on a PostgrestError prints
 * `{}`, because its fields are not where `console` goes looking. A silent
 * fallback whose only evidence is an empty pair of braces is a silent
 * fallback nobody can debug, which is how this function came to be written.
 *
 * The codes worth recognising on sight:
 *
 * - `PGRST202` — the function is not in the schema cache. Nearly always a
 *   migration that has not been applied yet, which is the first thing to check
 *   when a brand-new screen reads all zeroes.
 * - `42501` — insufficient privilege. Either the grant is missing or RLS
 *   refused every row; rule 3 in `0001_init.sql` means a write reaching this
 *   is a write that should have gone through a Server Action.
 * - `PGRST301` / `42P17` — a JWT that did not verify, or the access-token hook
 *   misbehaving. `npm run doctor` before reading any more code.
 */

/** What PostgREST hands back on a failed request. Structural rather than the
 *  imported `PostgrestError`, so this stays a pure module with no dependency
 *  on the client library's version. */
type ReadError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

export function writeReadError(error: unknown): string {
  if (!error || typeof error !== "object") return String(error ?? "no error given");

  const { code, message, details, hint } = error as ReadError;

  const parts = [
    code ? `[${code}]` : null,
    message || null,
    details ? `(${details})` : null,
    hint ? `Hint: ${hint}` : null,
  ].filter(Boolean);

  // Nothing recognisable is still worth printing whole — an error shape this
  // does not know about is exactly the case where guessing would lose the only
  // copy of what went wrong.
  return parts.length > 0 ? parts.join(" ") : JSON.stringify(error);
}
