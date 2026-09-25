import "server-only";

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import { createAdminClient } from "@/utils/supabase/admin";

/**
 * A team member's minted password, kept so the owner can press Reveal on
 * `/admin/team` (`0047`).
 *
 * AES-256-GCM, sealed here before it is written, so the database only ever
 * holds ciphertext and a leaked backup of `operator_credentials` is noise. The
 * key is derived from `SUPABASE_SERVICE_ROLE_KEY` with HKDF rather than read
 * from a new variable: whoever holds that key can already reset any password
 * in the project, so a second secret beside it would add a thing to set up and
 * no protection. Rotating the service-role key therefore makes every stored
 * password unreadable — Reveal then says so and offers a new password, which is
 * the right failure.
 *
 * `v1:` leads every value so a later key or cipher can sit beside this one.
 */

const VERSION = "v1";

function key(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");

  return Buffer.from(hkdfSync("sha256", secret, "flo", "operator-credentials", 32));
}

function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);

  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
}

function open(sealed: string): string | null {
  const [version, payload] = sealed.split(":");
  if (version !== VERSION || !payload) return null;

  try {
    const raw = Buffer.from(payload, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));

    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    // A tag that does not verify is a rotated key or a tampered row. Either
    // way there is no password to show.
    return null;
  }
}

/** Keep a password. Returns false if it could not be written — the caller
 *  still has it in hand and shows it once. */
export async function keepPassword(userId: string, password: string): Promise<boolean> {
  const { error } = await createAdminClient()
    .from("operator_credentials")
    .upsert({ user_id: userId, sealed: seal(password), updated_at: new Date().toISOString() });

  if (error) console.error("[admin] credential store failed", error);
  return !error;
}

/** Read one back, or null if there is none or it no longer opens. */
export async function readPassword(userId: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from("operator_credentials")
    .select("sealed")
    .eq("user_id", userId)
    .maybeSingle();

  return data?.sealed ? open(String(data.sealed)) : null;
}

/** Forget one — a login that stopped being ours to hold a password for. */
export async function forgetPassword(userId: string): Promise<void> {
  await createAdminClient().from("operator_credentials").delete().eq("user_id", userId);
}
